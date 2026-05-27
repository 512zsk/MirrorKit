const fs = require('fs');
const path = require('path');
const { DEFAULT_ASSET_EXTS } = require('../lib/constants');
const { isValidDownload } = require('../lib/validation');
const { walk, readTextIfExists } = require('../lib/files');
const { extractAssetPathsFromText, extractAssetPathsFromJson } = require('../lib/extraction');
const { argValue, loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { localPathForAsset: resolveLocalPathForAsset, remoteUrlForAsset: resolveRemoteUrlForAsset } = require('../lib/asset-paths');
const { fetchWithRetries } = require('../lib/retry-fetch');
const { createCliLogger } = require('../lib/cli-logger');
const { createFileLogger } = require('../lib/file-logger');
const { runMirrorWorkflow } = require('../lib/mirror-runner');
const { createFileInventory, createMirrorManifest, writeMirrorManifest } = require('../lib/manifest');
const { generateLauncher } = require('../lib/generate-launcher');
const { CookieJar, parseCookies, getSetCookieValues } = require('../lib/cookie-jar');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);

// ====== 站点配置区：换网站时主要改 mirror.config.json ======
const TARGET_HOST = CONFIG.targetHost;
const MIRROR_NAME = CONFIG.mirrorName;
const START_PATH = CONFIG.startPath;
const TIMEOUT_MS = CONFIG.requestTimeoutMs;
const MAX_DOWNLOAD_BYTES = CONFIG.maxDownloadBytes;
const CONCURRENCY = CONFIG.concurrency;
const MAX_PASSES = CONFIG.maxPasses;
const DOWNLOAD_RETRIES = CONFIG.downloadRetries;

const SEED_URLS = [
    START_PATH
];

const REMOTE_ASSET_PREFIXES = CONFIG.remoteAssetPrefixes;

const BUILTIN_REMOTE_ASSET_PREFIXES = [
    'https://storage.googleapis.com/'
];

const ASSET_EXTS = DEFAULT_ASSET_EXTS;

const args = new Set(process.argv.slice(2));
const SHOULD_RETRY_BAD = args.has('--retry-bad');
const SHOULD_RESUME = args.has('--resume');
const SHOULD_DRY_RUN = args.has('--dry-run');
const SHOULD_QUIET = args.has('--quiet');
const SHOULD_JSON_LOG = args.has('--json-log') || args.has('--json');
const ALLOW_EXTERNAL = CONFIG.allowExternalAssets;
const fileLogger = createFileLogger({
    rootDir: ROOT,
    filename: 'mirrorkit-tools.log',
    logFile: argValue(process.argv.slice(2), '--log-file') || undefined
});
const logger = createCliLogger({ quiet: SHOULD_QUIET, json: SHOULD_JSON_LOG, fileLogger });
const LOG_FILE_LABEL = fileLogger.logFile ? path.relative(ROOT, fileLogger.logFile) : 'disabled';

const COOKIE_JAR_PATH = path.join(ROOT, MIRROR_NAME, '.cookies.json');
let cookieHeader = '';
let cookieJar = null;
if (CONFIG.forwardCookies) {
    fileLogger.clear();
    cookieJar = new CookieJar();
    cookieJar.loadFromFile(COOKIE_JAR_PATH);
    cookieHeader = cookieJar.getCookiesForUrl(TARGET_HOST);
    if (cookieHeader) {
        logger.status(`Cookie forwarding enabled — loaded cookies from ${COOKIE_JAR_PATH}`);
        logger.status(`Crawler will use your login session. Cookies refresh automatically each pass.`);
    } else {
        logger.status(`Cookie forwarding enabled but no cookies found.`);
        logger.status(`Please start the server first (node server.js), log in through the browser, then re-run this tool.`);
    }
}

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit batch asset downloader

Usage:
  node tools\\mirror-assets.js [--config <file>] [--retry-bad] [--resume] [--dry-run] [--quiet] [--json-log] [--log-file <file>]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --retry-bad     Re-check and retry invalid cached files.
  --resume        Continue from .mirror-progress.json after Ctrl+C.
  --dry-run       Print planned resources without downloading anything.
  --quiet         Hide per-resource logs and print only summaries.
  --json-log      Print newline-delimited JSON events.
  --log-file <file>
                  Append structured logs to this file. Default: logs/mirrorkit-tools.log.
  File log: ${LOG_FILE_LABEL}
  -h, --help      Show this help.

Configuration:
  Edit mirror.config.json, pass --config <file>, or override with TARGET_HOST,
  MIRROR_NAME, START_PATH, MIRROR_TIMEOUT_MS, MIRROR_CONCURRENCY,
  MIRROR_MAX_PASSES, MIRROR_RETRIES, MIRROR_MAX_DOWNLOAD_BYTES,
  MIRRORKIT_LOG_DIR, and MIRRORKIT_LOG_FILE.
`);
    process.exit(0);
}

const PROGRESS_FILE = path.join(ROOT, MIRROR_NAME, '.mirror-progress.json');
const MANIFEST_FILE = path.join(ROOT, MIRROR_NAME, '.mirror-manifest.json');

function saveProgress(pass, pending, seen, stats) {
    try {
        const tmp = PROGRESS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({
            pass, pending: [...pending], seen: [...seen], stats,
            savedAt: new Date().toISOString()
        }));
        try {
            fs.renameSync(tmp, PROGRESS_FILE);
        } catch {
            fs.copyFileSync(tmp, PROGRESS_FILE);
            try { fs.unlinkSync(tmp); } catch {}
        }
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

process.on('SIGTERM', () => {
    if (!shouldStop) {
        shouldStop = true;
        logger.status('\nReceived SIGTERM, stopping after current batch...');
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason && reason.stack || reason}`);
});

function getActiveRemoteAssetPrefixes() {
    return new Set([...REMOTE_ASSET_PREFIXES, ...BUILTIN_REMOTE_ASSET_PREFIXES]);
}

function isAllowedExternalUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('http')) return true;
    // Check if URL matches the target host
    try {
        const parsed = new URL(url);
        const targetParsed = new URL(TARGET_HOST);
        if (parsed.hostname === targetParsed.hostname) return true;
    } catch { return true; }
    // Check if URL matches any configured remote asset prefix
    for (const prefix of getActiveRemoteAssetPrefixes()) {
        if (url.startsWith(prefix)) return true;
    }
    return false;
}

function filterExternalAssets(assets) {
    if (ALLOW_EXTERNAL) return assets;
    const filtered = new Set();
    let blocked = 0;
    for (const asset of assets) {
        if (isAllowedExternalUrl(asset)) {
            filtered.add(asset);
        } else {
            blocked++;
        }
    }
    if (blocked > 0) {
        logger.warn(`Blocked ${blocked} external asset(s) not in allowed prefixes. Set allowExternalAssets: true to permit.`);
    }
    return filtered;
}

function localPathForAsset(assetPath) {
    return resolveLocalPathForAsset(assetPath, {
        rootDir: ROOT,
        mirrorName: MIRROR_NAME,
        targetHost: TARGET_HOST,
        routeToIndex: true
    });
}

function remoteUrlForAsset(assetPath) {
    return resolveRemoteUrlForAsset(assetPath, TARGET_HOST);
}

function responseTooLarge(response) {
    const contentLength = Number(response.headers.get('content-length'));
    return Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES;
}

function collectLocalSources() {
    const sources = [];
    const mirrorRoot = path.join(ROOT, MIRROR_NAME);
    const startLocalPath = localPathForAsset(START_PATH);

    for (const filePath of [
        path.join(mirrorRoot, 'index.html'),
        startLocalPath,
        path.join(ROOT, 'unsupported.html')
    ]) {
        if (fs.existsSync(filePath)) sources.push(filePath);
    }

    return sources;
}

function collectBadCachedAssets() {
    const bad = new Set();
    const mirrorRoot = path.join(ROOT, MIRROR_NAME);

    for (const filePath of walk(mirrorRoot)) {
        const relativePath = path.relative(mirrorRoot, filePath).replace(/\\/g, '/');
        const buffer = fs.readFileSync(filePath);
        const fakeResponse = { headers: { get: () => '' } };
        if (!isValidDownload(filePath, fakeResponse, buffer)) bad.add(relativePath);
    }

    return bad;
}

function collectInitialAssets() {
    const assets = new Set(SEED_URLS);
    const mirrorRoot = path.join(ROOT, MIRROR_NAME);
    const baseExtractOpts = { assetExts: ASSET_EXTS, loosePrefixes: [...getActiveRemoteAssetPrefixes()] };

    for (const filePath of collectLocalSources()) {
        const relPath = '/' + path.relative(mirrorRoot, filePath).replace(/\\/g, '/');
        const extractOpts = { ...baseExtractOpts, sourcePath: relPath };
        const text = readTextIfExists(filePath);
        for (const item of extractAssetPathsFromText(text, extractOpts)) assets.add(item);

        if (path.extname(filePath).toLowerCase() === '.json') {
            try {
                const json = JSON.parse(text);
                for (const item of extractAssetPathsFromJson(json, extractOpts)) assets.add(item);
            } catch {
                // JSON 解析失败时，不从它提取二级资源。
            }
        }
    }

    if (SHOULD_RETRY_BAD) {
        for (const item of collectBadCachedAssets()) assets.add(item);
    }

    return filterExternalAssets(assets);
}

async function downloadAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!localPath) {
        return { status: 'reject', assetPath, message: 'unsafe local path' };
    }
    const url = remoteUrlForAsset(assetPath);

    if (!ALLOW_EXTERNAL && !isAllowedExternalUrl(url)) {
        return { status: 'reject', assetPath, message: 'external asset not allowed' };
    }

    if (fs.existsSync(localPath) && !SHOULD_RETRY_BAD) {
        return { status: 'skip', assetPath };
    }

    const response = await fetchWithRetries(url, {
        timeoutMs: TIMEOUT_MS,
        referer: TARGET_HOST,
        retries: DOWNLOAD_RETRIES,
        cookie: cookieHeader || undefined
    });

    if (cookieJar) {
        const setCookieValues = getSetCookieValues(response);
        for (const headerValue of setCookieValues) {
            for (const cookie of parseCookies(headerValue, url)) {
                cookieJar.addCookie(cookie);
            }
        }
        if (setCookieValues.length) cookieHeader = cookieJar.getCookiesForUrl(TARGET_HOST);
    }

    if (!response.ok) {
        return { status: 'fail', assetPath, message: `HTTP ${response.status}` };
    }

    if (responseTooLarge(response)) {
        return { status: 'reject', assetPath, message: `too large: exceeds ${MAX_DOWNLOAD_BYTES} bytes` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
        return { status: 'reject', assetPath, message: `too large: exceeds ${MAX_DOWNLOAD_BYTES} bytes` };
    }

    if (!isValidDownload(localPath, response, buffer)) {
        return { status: 'reject', assetPath, message: response.headers.get('content-type') || 'unknown content-type' };
    }

    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return { status: 'save', assetPath, bytes: buffer.length };
}

async function loadJsonAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!localPath || !fs.existsSync(localPath) || path.extname(localPath).toLowerCase() !== '.json') return null;
    try {
        return JSON.parse(readTextIfExists(localPath));
    } catch {
        return null;
    }
}

async function loadTextAsset(assetPath) {
    const localPath = localPathForAsset(assetPath);
    if (!localPath) return null;
    const ext = path.extname(localPath).toLowerCase();
    if (!fs.existsSync(localPath) || !['.html', '.js', '.mjs', '.css', '.json', '.txt', ''].includes(ext)) return null;

    try {
        const buffer = fs.readFileSync(localPath);
        if (buffer.includes(0)) return null;
        return buffer.toString('utf8');
    } catch {
        return null;
    }
}

async function discoverAssetsFromDownloadedItem(item, extractOpts) {
    const output = new Set();
    const json = await loadJsonAsset(item);
    if (json) {
        for (const assetPath of extractAssetPathsFromJson(json, extractOpts)) {
            output.add(assetPath);
        }
        return output;
    }

    const text = await loadTextAsset(item);
    if (!text) return output;
    for (const assetPath of extractAssetPathsFromText(text, extractOpts)) {
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
            startPath: START_PATH
        });
        logger.status(`Launcher generated: ${path.relative(ROOT, launcherPath)}`);
    } catch (err) {
        logger.error(`Could not generate launcher: ${err.message}`);
    }

    const extractOpts = { assetExts: ASSET_EXTS, loosePrefixes: [...getActiveRemoteAssetPrefixes()] };

    const result = await runMirrorWorkflow({
        collectInitialAssets,
        concurrency: CONCURRENCY,
        discoverAssets: item => discoverAssetsFromDownloadedItem(item, { ...extractOpts, sourcePath: item }),
        downloadAsset,
        dryRunLabel: 'initial resources',
        logger,
        loadProgress,
        maxPasses: MAX_PASSES,
        mirrorFolder: path.join(ROOT, MIRROR_NAME),
        onPassStart: cookieJar ? () => {
            cookieJar.loadFromFile(COOKIE_JAR_PATH);
            cookieHeader = cookieJar.getCookiesForUrl(TARGET_HOST);
        } : undefined,
        saveProgress,
        clearProgress: () => {
            try { fs.unlinkSync(PROGRESS_FILE); } catch {}
        },
        shouldDryRun: SHOULD_DRY_RUN,
        shouldResume: SHOULD_RESUME,
        shouldStop: () => shouldStop
    });

    const completed = result.completed === true;
    try {
        writeMirrorManifest(MANIFEST_FILE, createMirrorManifest({
            tool: 'mirror-assets',
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            completed,
            stats: result.stats,
            resources: result.seen,
            pending: [...result.pending].filter(item => !result.seen.has(item)),
            files: createFileInventory(path.join(ROOT, MIRROR_NAME)),
            scannedUniqueResources: result.seen.size
        }));
    } catch (err) {
        logger.error(`Could not write manifest: ${err.message}`);
    }

    if (result.stopped) process.exit(0);

    if (result.incomplete) {
        process.exitCode = 2;
        return;
    }
}

main().catch(err => {
    logger.error(err.stack || err.message || err);
    process.exit(1);
});
