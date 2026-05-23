const fs = require('fs');
const path = require('path');
const { CMS_ASSET_EXTS } = require('../lib/constants');
const { isValidDownload } = require('../lib/validation');
const { walk, readTextIfExists } = require('../lib/files');
const { extractAssetPathsFromText, extractAssetPathsFromJson } = require('../lib/extraction');
const { argValue, loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { mirrorRoot: getMirrorRoot } = require('../lib/paths');
const { localPathForAsset: resolveLocalPathForAsset, remoteUrlForAsset: resolveRemoteUrlForAsset } = require('../lib/asset-paths');
const { fetchWithRetries } = require('../lib/retry-fetch');
const { createCliLogger } = require('../lib/cli-logger');
const { createFileLogger } = require('../lib/file-logger');
const { runMirrorWorkflow } = require('../lib/mirror-runner');
const { createFileInventory, createMirrorManifest, writeMirrorManifest } = require('../lib/manifest');
const { generateLauncher } = require('../lib/generate-launcher');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);

// ====== CMS 媒体补充下载配置 ======
const TARGET_HOST = CONFIG.targetHost;
const MIRROR_NAME = CONFIG.mirrorName;
const CMS_HOST = CONFIG.cmsMediaHost;

const TIMEOUT_MS = CONFIG.requestTimeoutMs;
const CONCURRENCY = CONFIG.concurrency;
const MAX_PASSES = CONFIG.maxPasses;
const DOWNLOAD_RETRIES = CONFIG.downloadRetries;

const CACHE_PATTERNS = [
    /window\._CACHE_\s*=\s*["']([^"']+)["']/,
    /_CACHE_\s*=\s*["']([^"']+)["']/
];

const CMS_PAGES = [
    'metadata',
    'contact',
    'projects'
];

const ASSET_EXTS = CMS_ASSET_EXTS;

const TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.txt', '.m3u8']);

const args = new Set(process.argv.slice(2));
const SHOULD_RETRY_BAD = args.has('--retry-bad');
const SHOULD_RESUME = args.has('--resume');
const SHOULD_DRY_RUN = args.has('--dry-run');
const SHOULD_QUIET = args.has('--quiet');
const SHOULD_JSON_LOG = args.has('--json-log') || args.has('--json');
const fileLogger = createFileLogger({
    rootDir: ROOT,
    filename: 'mirrorkit-tools.log',
    logFile: argValue(process.argv.slice(2), '--log-file') || undefined
});
const logger = createCliLogger({ quiet: SHOULD_QUIET, json: SHOULD_JSON_LOG, fileLogger });
const LOG_FILE_LABEL = fileLogger.logFile ? path.relative(ROOT, fileLogger.logFile) : 'disabled';

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit CMS media downloader

Usage:
  node tools\\mirror-cms-media.js [--config <file>] [--retry-bad] [--resume] [--dry-run] [--quiet] [--json-log] [--log-file <file>]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --retry-bad     Re-check and retry invalid cached files.
  --resume        Continue from .mirror-progress-cms.json after Ctrl+C.
  --dry-run       Print planned resources without downloading anything.
  --quiet         Hide per-resource logs and print only summaries.
  --json-log      Print newline-delimited JSON events.
  --log-file <file>
                  Append structured logs to this file. Default: logs/mirrorkit-tools.log.
  File log: ${LOG_FILE_LABEL}
  -h, --help      Show this help.

Configuration:
  Edit mirror.config.json, pass --config <file>, or override with TARGET_HOST,
  MIRROR_NAME, CMS_MEDIA_HOST, MIRROR_TIMEOUT_MS, MIRROR_CONCURRENCY,
  MIRROR_MAX_PASSES, MIRROR_RETRIES, MIRRORKIT_LOG_DIR, and MIRRORKIT_LOG_FILE.
`);
    process.exit(0);
}

const PROGRESS_FILE = path.join(ROOT, MIRROR_NAME, '.mirror-progress-cms.json');
const MANIFEST_FILE = path.join(ROOT, MIRROR_NAME, '.mirror-manifest-cms.json');

function saveProgress(pass, pending, seen, stats) {
    try {
        const tmp = PROGRESS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({
            pass, pending: [...pending], seen: [...seen], stats,
            savedAt: new Date().toISOString()
        }));
        fs.renameSync(tmp, PROGRESS_FILE);
    } catch { /* 保存进度失败不阻塞主流程 */ }
}

function loadProgress() {
    if (!fs.existsSync(PROGRESS_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    } catch { return null; }
}

let shouldStop = false;
process.on('SIGINT', () => {
    if (!shouldStop) {
        shouldStop = true;
        logger.status('\nStopping after current batch... (Ctrl+C again to force quit)');
    } else {
        process.exit(1);
    }
});

function mirrorRoot() {
    return getMirrorRoot(ROOT, MIRROR_NAME);
}

function cmsPrefix() {
    return `${CMS_HOST.replace(/\/+$/, '')}/`;
}

function findCacheId() {
    const indexHtml = readTextIfExists(path.join(mirrorRoot(), 'index.html'));
    for (const pattern of CACHE_PATTERNS) {
        const match = indexHtml.match(pattern);
        if (match) return match[1];
    }

    const appFile = findExistingAppBundle();
    if (appFile) {
        const match = path.basename(appFile).match(/app\.([^.]+)\.js$/);
        if (match) return match[1];
    }

    return 'latest';
}

function findExistingAppBundle() {
    const jsDir = path.join(mirrorRoot(), 'assets', 'js');
    if (!fs.existsSync(jsDir)) return null;

    return fs.readdirSync(jsDir)
        .filter(name => /^app\..+\.js$/.test(name))
        .map(name => path.join(jsDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

function findExistingUilFiles() {
    const dataDir = path.join(mirrorRoot(), 'assets', 'data');
    if (!fs.existsSync(dataDir)) return [];

    return fs.readdirSync(dataDir)
        .filter(name => /^uil\..+\.json$/.test(name))
        .map(name => path.join(dataDir, name));
}

function localPathForAsset(assetPath) {
    return resolveLocalPathForAsset(assetPath, {
        rootDir: ROOT,
        mirrorName: MIRROR_NAME,
        targetHost: TARGET_HOST,
        routeToIndex: false
    });
}

function remoteUrlForAsset(assetPath) {
    return resolveRemoteUrlForAsset(assetPath, TARGET_HOST);
}

function collectLocalSources() {
    const sources = [];
    const cacheId = findCacheId();

    for (const filePath of [
        path.join(mirrorRoot(), 'index.html'),
        path.join(ROOT, 'unsupported.html'),
        path.join(mirrorRoot(), 'assets', 'js', `app.${cacheId}.js`),
        path.join(mirrorRoot(), 'assets', 'js', `modules.${cacheId}.js`),
        path.join(mirrorRoot(), 'assets', 'data', `uil.${cacheId}.json`),
        findExistingAppBundle(),
        ...findExistingUilFiles()
    ]) {
        if (filePath && fs.existsSync(filePath)) sources.push(filePath);
    }

    return [...new Set(sources)];
}

function collectBadCachedAssets() {
    const bad = new Set();

    for (const filePath of walk(mirrorRoot())) {
        const ext = path.extname(filePath).toLowerCase();
        if (!ASSET_EXTS.includes(ext.slice(1))) continue;

        const relativePath = path.relative(mirrorRoot(), filePath).replace(/\\/g, '/');
        const buffer = fs.readFileSync(filePath);
        const fakeResponse = { headers: { get: () => '' } };
        if (!isValidDownload(filePath, fakeResponse, buffer, { strictTextHtmlFallback: true })) bad.add(relativePath);
    }

    return bad;
}

function collectInitialAssets() {
    const assets = new Set();
    const cacheId = findCacheId();
    const extractOpts = { assetExts: ASSET_EXTS, loosePrefixes: [cmsPrefix()] };

    assets.add(`assets/js/app.${cacheId}.js`);
    assets.add(`assets/js/modules.${cacheId}.js`);
    assets.add(`assets/data/uil.${cacheId}.json`);

    for (const page of CMS_PAGES) {
        assets.add(`${CMS_HOST}/cms/${page}-latest.json`);
        assets.add(`${CMS_HOST}/cms/${page}-dev.json`);
    }

    for (const filePath of collectLocalSources()) {
        const text = readTextIfExists(filePath);
        for (const item of extractAssetPathsFromText(text, extractOpts)) assets.add(item);

        if (path.extname(filePath).toLowerCase() === '.json') {
            try {
                const json = JSON.parse(text);
                for (const item of extractAssetPathsFromJson(json, extractOpts)) assets.add(item);
            } catch {
                // JSON 已损坏时不继续提取资源，交给下载阶段重试。
            }
        }
    }

    if (SHOULD_RETRY_BAD) {
        for (const item of collectBadCachedAssets()) assets.add(item);
    }

    return assets;
}

async function downloadAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!localPath) {
        return { status: 'reject', assetPath, message: 'unsafe local path' };
    }
    const url = remoteUrlForAsset(assetPath);

    if (fs.existsSync(localPath) && !SHOULD_RETRY_BAD) {
        return { status: 'skip', assetPath };
    }

    const response = await fetchWithRetries(url, {
        timeoutMs: TIMEOUT_MS,
        referer: TARGET_HOST,
        retries: DOWNLOAD_RETRIES
    });
    if (!response.ok) {
        return { status: 'fail', assetPath, message: `HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isValidDownload(localPath, response, buffer, { strictTextHtmlFallback: true })) {
        return { status: 'reject', assetPath, message: response.headers.get('content-type') || 'unknown content-type' };
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return { status: 'save', assetPath, bytes: buffer.length };
}

async function loadDownloadedAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!localPath || !fs.existsSync(localPath)) return null;

    const ext = path.extname(localPath).toLowerCase();
    if (!TEXT_EXTS.has(ext)) return null;

    try {
        const buffer = fs.readFileSync(localPath);
        if (buffer.includes(0)) return null;
        const text = buffer.toString('utf8');

        if (ext === '.json') {
            try {
                return { type: 'json', value: JSON.parse(text) };
            } catch {
                return { type: 'text', value: text };
            }
        }

        return { type: 'text', value: text };
    } catch {
        return null;
    }
}

async function discoverAssetsFromDownloadedItem(item, extractOpts) {
    const output = new Set();
    const loaded = await loadDownloadedAsset(item);
    if (!loaded) return output;

    if (loaded.type === 'json') {
        for (const assetPath of extractAssetPathsFromJson(loaded.value, extractOpts)) {
            output.add(assetPath);
        }
        return output;
    }

    for (const assetPath of extractAssetPathsFromText(loaded.value, extractOpts)) {
        output.add(assetPath);
    }
    return output;
}

async function main() {
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    try {
        const launcherPath = generateLauncher(ROOT, {
            mirrorName: MIRROR_NAME,
            targetHost: TARGET_HOST,
            startPath: CONFIG.startPath
        });
        logger.status(`Launcher generated: ${path.relative(ROOT, launcherPath)}`);
    } catch (err) {
        logger.error(`Could not generate launcher: ${err.message}`);
    }

    const extractOpts = { assetExts: ASSET_EXTS, loosePrefixes: [cmsPrefix()] };

    const result = await runMirrorWorkflow({
        collectInitialAssets,
        concurrency: CONCURRENCY,
        discoverAssets: item => discoverAssetsFromDownloadedItem(item, extractOpts),
        downloadAsset,
        dryRunLabel: 'initial CMS resources',
        logger,
        loadProgress,
        maxPasses: MAX_PASSES,
        mirrorFolder: mirrorRoot(),
        passLabel: pass => `CMS media pass ${pass}`,
        saveProgress,
        clearProgress: () => {
            try { fs.unlinkSync(PROGRESS_FILE); } catch {}
        },
        shouldDryRun: SHOULD_DRY_RUN,
        shouldResume: SHOULD_RESUME,
        shouldStop: () => shouldStop
    });

    if (result.stopped) process.exit(0);

    if (result.completed) {
        try {
            writeMirrorManifest(MANIFEST_FILE, createMirrorManifest({
                tool: 'mirror-cms-media',
                targetHost: TARGET_HOST,
                mirrorName: MIRROR_NAME,
                cmsMediaHost: CMS_HOST,
                stats: result.stats,
                resources: result.seen,
                pending: [...result.pending].filter(item => !result.seen.has(item)),
                files: createFileInventory(mirrorRoot()),
                scannedUniqueResources: result.seen.size
            }));
        } catch (err) {
            logger.error(`Could not write manifest: ${err.message}`);
        }
    }

    if (result.incomplete) {
        process.exitCode = 2;
        return;
    }
}

main().catch(err => {
    logger.error(err.stack || err.message || err);
    process.exit(1);
});
