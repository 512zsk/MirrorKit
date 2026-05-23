const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const { DEFAULT_ASSET_EXTS, MIME_TYPES } = require('./lib/constants');
const { isHtmlLike, isValidDownload } = require('./lib/validation');
const { fetchWithTimeout } = require('./lib/fetch');
const { ensureDirExists } = require('./lib/files');
const { argValue, loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('./lib/config');
const { safeDecodeURIComponent, safeJoin } = require('./lib/paths');
const { createFileLogger } = require('./lib/file-logger');
const { generateLauncher } = require('./lib/generate-launcher');

const serverFileLogger = createFileLogger({
    rootDir: __dirname,
    filename: 'mirrorkit-server.log',
    logFile: argValue(process.argv.slice(2), '--log-file') || undefined
});

// 结构化日志。
function logger(level, message, details = {}) {
    const timestamp = new Date().toISOString();
    const extra = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    const colors = { info: '\x1b[0m', warn: '\x1b[33m', error: '\x1b[31m', success: '\x1b[32m', cache: '\x1b[33m' };
    const prefix = `${colors[level] || ''}[${timestamp}] [${level.toUpperCase()}]`;
    serverFileLogger.write({ level, message, details });
    console.log(`${prefix} ${message}${extra}\x1b[0m`);
}

// ====== 站点配置区：换网站时主要改这里 ======
const CONFIG = loadMirrorConfig(__dirname);
const STARTED_AT = new Date();
const PORT = CONFIG.port;
const AUTO_PORT = CONFIG.autoPort;
const TARGET_HOST = CONFIG.targetHost;
const MIRROR_NAME = CONFIG.mirrorName;
const START_PATH = CONFIG.startPath;
const REQUEST_TIMEOUT_MS = CONFIG.requestTimeoutMs;

const REMOTE_MIRRORS = CONFIG.remoteMirrors;
const BUILTIN_REMOTE_MIRRORS = [];

const IGNORED_PATH_PREFIXES = CONFIG.ignoredPathPrefixes;

// ====== 通用规则区：不是某个网站专用，不要随便删 ======
const SITE_PATH_PREFIXES = new Set(CONFIG.sitePathPrefixes);

function looksLikeMirroredRemoteHost(segment) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(segment);
}

const REWRITE_TEXT_EXTS = new Set(['.html', '.css']);
const EXTERNAL_URL_REWRITE_TEXT_EXTS = new Set(['.js', '.mjs', '.json']);
const REWRITE_ASSET_EXTS = DEFAULT_ASSET_EXTS;
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';

function isMirrorRequest(reqPath) {
    return reqPath === `/${MIRROR_NAME}` || reqPath.startsWith(`/${MIRROR_NAME}/`);
}

function stripMirrorPrefix(reqPath) {
    if (reqPath === `/${MIRROR_NAME}`) return '/';
    return reqPath.slice(MIRROR_NAME.length + 1) || '/';
}

function isRoutePath(reqPath) {
    return path.extname(reqPath) === '';
}

function hasTraversal(value) {
    return value.replace(/\\/g, '/').split('/').includes('..');
}

function getLocalPath(reqPath) {
    const baseDir = __dirname;
    let safePath = safeDecodeURIComponent(reqPath);
    if (!safePath || hasTraversal(safePath)) return null;

    if (!isMirrorRequest(safePath)) {
        safePath = path.posix.join('/', MIRROR_NAME, safePath);
    }

    const targetPath = stripMirrorPrefix(safePath);
    if (isRoutePath(targetPath)) {
        safePath = path.posix.join(safePath, 'index.html');
    }

    return safeJoin(baseDir, safePath);
}

function getContentType(filePath, data) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext && data && isHtmlLike(data)) return MIME_TYPES['.html'];
    return MIME_TYPES[ext] || 'application/octet-stream';
}

const COMPRESSIBLE_CT = new Set([
    'text/html', 'text/css', 'text/plain', 'application/javascript',
    'application/json', 'image/svg+xml', 'application/wasm'
]);

function acceptEncoding(req) {
    const ae = (req.headers['accept-encoding'] || '').toLowerCase();
    if (ae.includes('gzip')) return 'gzip';
    if (ae.includes('deflate')) return 'deflate';
    return null;
}

function compressBody(encoding, data) {
    if (encoding === 'gzip') return zlib.gzipSync(data);
    if (encoding === 'deflate') return zlib.deflateSync(data);
    return data;
}

function isCompressible(contentType) {
    const baseType = (contentType || '').split(';')[0].trim().toLowerCase();
    return COMPRESSIBLE_CT.has(baseType);
}

function parseRangeHeader(rangeHeader, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader || '').trim());
    if (!match) return null;

    const [, startText, endText] = match;
    if (!startText && !endText) return null;

    let start;
    let end;

    if (!startText) {
        const suffixLength = Number(endText);
        if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
        start = Math.max(size - suffixLength, 0);
        end = size - 1;
    } else {
        start = Number(startText);
        end = endText ? Number(endText) : size - 1;
        if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
        if (start < 0 || end < start || start >= size) return null;
        end = Math.min(end, size - 1);
    }

    return { start, end, length: end - start + 1 };
}

function canServeRange(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return !REWRITE_TEXT_EXTS.has(ext) && !EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext);
}

function sendRangeNotSatisfiable(res, size) {
    res.writeHead(416, {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
    });
    res.end();
}

function serveFileRange(filePath, req, res, stat, etag) {
    const range = parseRangeHeader(req.headers.range, stat.size);
    if (!range) {
        sendRangeNotSatisfiable(res, stat.size);
        return;
    }

    res.writeHead(206, {
        'Content-Type': getContentType(filePath),
        'Cache-Control': 'public, max-age=31536000',
        'ETag': etag,
        'Last-Modified': stat.mtime.toUTCString(),
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Content-Length': range.length,
        'Access-Control-Allow-Origin': '*'
    });

    if (req.method === 'HEAD') {
        res.end();
        return;
    }

    fs.createReadStream(filePath, { start: range.start, end: range.end })
        .on('error', err => {
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code || err.message}`);
        })
        .pipe(res);
}

function sendResponse(req, res, status, headers, data) {
    const contentType = headers['Content-Type'] || '';
    const encoding = acceptEncoding(req);

    if (encoding && isCompressible(contentType) && data && data.length > 1024) {
        data = compressBody(encoding, data);
        headers['Content-Encoding'] = encoding;
    }

    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
}

function sendOptions(res) {
    res.writeHead(204, {
        'Allow': ALLOWED_METHODS,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match',
        'Access-Control-Max-Age': '86400'
    });
    res.end();
}

function sendMethodNotAllowed(req, res) {
    res.writeHead(405, {
        'Allow': ALLOWED_METHODS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(req.method === 'HEAD' ? undefined : `Method not allowed: ${req.method}`);
}

function serveLocalFile(filePath, req, res) {
    try {
        const stat = fs.statSync(filePath);
        const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;

        if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, {
                'Cache-Control': 'public, max-age=31536000',
                'ETag': etag,
                'Accept-Ranges': 'bytes'
            });
            res.end();
            return;
        }

        if (req.headers.range && canServeRange(filePath)) {
            serveFileRange(filePath, req, res, stat, etag);
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Error reading file: ${err.code}`);
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            if (REWRITE_TEXT_EXTS.has(ext) || ext === '') {
                data = Buffer.from(rewriteTextForLocalMirror(data.toString('utf8')));
            } else if (EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext)) {
                data = Buffer.from(rewriteExternalUrlsForLocalMirror(data.toString('utf8')));
            }

            sendResponse(req, res, 200, {
                'Content-Type': getContentType(filePath, data),
                'Cache-Control': 'public, max-age=31536000',
                'ETag': etag,
                'Last-Modified': stat.mtime.toUTCString(),
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
            }, data);
        });
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Error reading file: ${err.code || err.message}`);
    }
}

function getMirrorEntryPath() {
    const startPath = START_PATH.startsWith('/') ? START_PATH : `/${START_PATH}`;
    return startPath === '/' ? `/${MIRROR_NAME}/` : `/${MIRROR_NAME}${startPath}`;
}

function getBoundPort() {
    const address = server.address();
    return address && typeof address === 'object' ? address.port : PORT;
}

function getHealthStatus() {
    const mirrorFolder = path.join(__dirname, MIRROR_NAME);
    return {
        ok: true,
        startedAt: STARTED_AT.toISOString(),
        uptimeSeconds: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
        targetHost: TARGET_HOST,
        port: getBoundPort(),
        configuredPort: PORT,
        autoPort: AUTO_PORT,
        mirrorName: MIRROR_NAME,
        startPath: START_PATH,
        entryPath: getMirrorEntryPath(),
        mirrorFolder,
        mirrorFolderExists: fs.existsSync(mirrorFolder),
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        logFile: serverFileLogger.logFile
    };
}

function serveStarterPage(res) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, text) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error reading file: ${err.code}`);
            return;
        }

        const config = {
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        };

        const html = text
            .replace(
                '<script id="mirror-config" type="application/json"></script>',
                `<script id="mirror-config" type="application/json">${JSON.stringify(config)}</script>`
            )
            .replace(
                'window.__MIRROR_CONFIG__ = null;',
                `window.__MIRROR_CONFIG__ = ${JSON.stringify(config)};`
            );

        res.writeHead(200, {
            'Content-Type': MIME_TYPES['.html'],
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(html);
    });
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTargetHostName() {
    return new URL(TARGET_HOST).hostname;
}

function getLocalUrlPrefixForHost(host, slash) {
    const separator = slash === '\\/' ? '\\/' : '/';

    if (host === getTargetHostName()) {
        return `${separator}${MIRROR_NAME}${separator}`;
    }

    return `${separator}${MIRROR_NAME}${separator}${host}${separator}`;
}

function rewriteExternalUrlsForLocalMirror(text) {
    const plainUrl = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/)/gi;
    const escapedUrl = /\bhttps?:\\\/\\\/([a-z0-9.-]+\.[a-z]{2,})(\\\/)/gi;

    return text
        .replace(plainUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash))
        .replace(escapedUrl, (match, host, slash) => getLocalUrlPrefixForHost(host, slash));
}

function rewriteTextForLocalMirror(text) {
    const extGroup = REWRITE_ASSET_EXTS.join('|');
    const mirror = escapeRegExp(MIRROR_NAME);
    const assetUrl = new RegExp('https?:\\/\\/([^/"\\\'\\s)]+)(\\/[^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootAsset = new RegExp('(["\\\'(=])\\/(?!\\/|' + mirror + '\\/)([^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootRoute = new RegExp('(["\\\'=])\\/(?!\\/|' + mirror + '\\/)([a-z]{2}(?:-[a-z]{2})?(?:\\/[^"\\\'\\s<)]*)?)', 'gi');

    return rewriteExternalUrlsForLocalMirror(text)
        .replaceAll(TARGET_HOST, `/${MIRROR_NAME}`)
        .replace(assetUrl, (match, host, assetPath) => `/${MIRROR_NAME}/${host}${assetPath}`)
        .replace(rootAsset, (match, prefix, assetPath) => `${prefix}/${MIRROR_NAME}/${assetPath}`)
        .replace(rootRoute, (match, prefix, routePath) => `${prefix}/${MIRROR_NAME}/${routePath}`);
}

function getRemoteMirror(reqPath) {
    return [...REMOTE_MIRRORS, ...BUILTIN_REMOTE_MIRRORS].find(mirror => reqPath.startsWith(mirror.prefix));
}

function getGoogleStorageTargetUrl(reqPath, search) {
    const parts = reqPath.split('/').filter(Boolean);
    if (parts.length < 2) return null;

    if (parts[0] === 'storage.googleapis.com') {
        return `https://storage.googleapis.com/${parts.slice(1).join('/')}${search}`;
    }

    if (/^[a-z0-9-]+\.appspot\.com$/i.test(parts[0])) {
        return `https://storage.googleapis.com/${parts[0]}/${parts.slice(1).join('/')}${search}`;
    }

    return null;
}

function getTargetUrl(req, reqPath) {
    const requestUrl = new URL(req.url, `http://localhost:${getBoundPort()}`);
    const targetPath = isMirrorRequest(reqPath) ? stripMirrorPrefix(reqPath) : reqPath;
    const mirror = getRemoteMirror(targetPath);

    if (mirror) {
        return `${mirror.origin}${targetPath.slice(mirror.prefix.length - 1)}${requestUrl.search}`;
    }

    const gcsUrl = getGoogleStorageTargetUrl(targetPath, requestUrl.search);
    if (gcsUrl) return gcsUrl;

    const parts = targetPath.split('/').filter(Boolean);
    if (parts.length > 1 && looksLikeMirroredRemoteHost(parts[0]) && !SITE_PATH_PREFIXES.has(parts[0])) {
        return `https://${parts[0]}/${parts.slice(1).join('/')}${requestUrl.search}`;
    }

    return `${TARGET_HOST}${targetPath}${requestUrl.search}`;
}

async function proxyAndCache(req, res, localPath, reqPath) {
    const targetUrl = getTargetUrl(req, reqPath);
    logger('cache', `Cache miss: ${req.url} -> ${targetUrl}`);

    try {
        const response = await fetchWithTimeout(targetUrl, { timeoutMs: REQUEST_TIMEOUT_MS, referer: TARGET_HOST });

        if (!response.ok) {
            logger('error', `Origin status ${response.status}: ${req.url}`);
            res.writeHead(response.status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Origin responded with status: ${response.status}`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (!isValidDownload(localPath, response, buffer)) {
            const contentType = response.headers.get('content-type') || 'unknown';
            logger('error', `Rejected: ${req.url}`, { contentType });
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Rejected unexpected content for ${req.url}`);
            return;
        }

        ensureDirExists(localPath);
        await fs.promises.writeFile(localPath, buffer);
        logger('success', `Saved: ${localPath}`);

        if (req.headers.range && fs.existsSync(localPath) && fs.statSync(localPath).isFile() && canServeRange(localPath)) {
            serveLocalFile(localPath, req, res);
            return;
        }

        sendResponse(req, res, 200, {
            'Content-Type': getContentType(localPath, buffer),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
        }, buffer);
    } catch (err) {
        const status = err.name === 'AbortError' ? 504 : 500;
        logger('error', `${req.url}: ${err.message}`);
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Proxy error: ${err.message}`);
    }
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        sendOptions(res);
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendMethodNotAllowed(req, res);
        return;
    }

    if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    const reqPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;

    if (reqPath === '/__mirror-config.json') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({
            targetHost: TARGET_HOST,
            mirrorName: MIRROR_NAME,
            startPath: START_PATH,
            entryPath: getMirrorEntryPath()
        }));
        return;
    }

    if (reqPath === '/__health.json') {
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify(getHealthStatus()));
        return;
    }

    if (reqPath === '/index.html') {
        serveStarterPage(res);
        return;
    }

    if (IGNORED_PATH_PREFIXES.some(prefix => reqPath === prefix || reqPath.startsWith(prefix))) {
        res.writeHead(204);
        res.end();
        return;
    }

    const localPath = getLocalPath(reqPath);
    if (!localPath) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        serveLocalFile(localPath, req, res);
        return;
    }

    await proxyAndCache(req, res, localPath, reqPath);
});

function printStartupInfo(port = getBoundPort()) {
    console.log('\n==========================================================');
    console.log('\x1b[36m  Offline Mirror - Local Proxy & Crawler Server\x1b[0m');
    console.log('==========================================================');
    console.log(`Target host: \x1b[32m${TARGET_HOST}\x1b[0m`);
    console.log(`Mirror folder: \x1b[32m${MIRROR_NAME}\x1b[0m`);
    console.log(`Local starter: \x1b[32mhttp://localhost:${port}/\x1b[0m`);
    console.log(`Mirror entry: \x1b[32mhttp://localhost:${port}${getMirrorEntryPath()}\x1b[0m`);
    console.log(`Request timeout: ${REQUEST_TIMEOUT_MS}ms`);
    console.log(`Log file: ${serverFileLogger.logFile || 'disabled'}`);
    console.log('Unexpected HTML fallback responses will not be cached as assets.');
    console.log('----------------------------------------------------------\n');
}

function shouldOpenBrowser() {
    return !process.argv.includes('--no-open') && process.env.NO_OPEN !== '1';
}

function openBrowser(port = getBoundPort()) {
    if (!process.argv.includes('--no-open') && process.env.NO_OPEN !== '1') {
        const url = `http://localhost:${port}/`;
        const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${startCmd} ${url}`, (err) => {
            if (err) logger('warn', 'Failed to auto-open browser', { error: err.message });
        });
    }
}

function listenErrorMessage(err, port) {
    if (err && err.code === 'EADDRINUSE') {
        return [
            `Port ${port} is already in use.`,
            `Close the other process or start MirrorKit with another port: node server.js --port ${port + 1}`
        ].join('\n');
    }

    if (err && err.code === 'EACCES') {
        return [
            `Port ${port} cannot be opened due to permission restrictions.`,
            'Use a higher port, for example: node server.js --port 3000'
        ].join('\n');
    }

    return `Server listen error: ${err && err.message ? err.message : err}`;
}

function shouldRetryListen(err, port, autoPort = AUTO_PORT) {
    return Boolean(autoPort && err && err.code === 'EADDRINUSE' && port < 65535);
}

function startServer() {
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    try {
        const launcherPath = generateLauncher(__dirname, {
            mirrorName: MIRROR_NAME,
            targetHost: TARGET_HOST,
            startPath: START_PATH
        });
        logger('info', `Launcher generated: ${path.relative(__dirname, launcherPath)}`);
    } catch (err) {
        logger('warn', `Could not generate launcher: ${err.message}`);
    }

    function listenOn(port) {
        const onListening = () => {
            server.off('error', onError);
            const actualPort = getBoundPort();
            printStartupInfo(actualPort);
            if (shouldOpenBrowser()) openBrowser(actualPort);
        };

        const onError = err => {
            server.off('listening', onListening);
            if (shouldRetryListen(err, port)) {
                const nextPort = port + 1;
                logger('warn', `Port ${port} is already in use. Trying ${nextPort}...`);
                listenOn(nextPort);
                return;
            }

            logger('error', listenErrorMessage(err, port));
            process.exitCode = 1;
        };

        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
    }

    listenOn(PORT);

    return server;
}

function printHelp() {
    console.log(`MirrorKit local proxy server

Usage:
  node server.js [--config <file>] [--port <number>] [--auto-port] [--no-open] [--log-file <file>]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --port <number> Override the configured local server port.
  --auto-port     If the port is busy, try the next available port.
  --no-open       Start the server without opening a browser.
  --log-file <file>
                  Append server logs to this file. Default: logs/mirrorkit-server.log.
  -h, --help      Show this help.

Configuration:
  Edit mirror.config.json, pass --config <file>, or override with PORT,
  TARGET_HOST, MIRROR_NAME, START_PATH, PROXY_TIMEOUT_MS,
  MIRRORKIT_AUTO_PORT=1, MIRRORKIT_LOG_DIR, MIRRORKIT_LOG_FILE,
  MIRRORKIT_LOG_FILE=0, and NO_OPEN=1.
`);
}

let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger('info', `Received ${signal}, shutting down...`);
    server.close(() => {
        logger('info', 'Server closed.');
        process.exit(0);
    });
    setTimeout(() => {
        logger('warn', 'Forcing exit after timeout.');
        process.exit(1);
    }, 5000).unref();
}

if (require.main === module) {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printHelp();
    } else {
        startServer();
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }
}

module.exports = {
    CONFIG,
    server,
    startServer,
    listenErrorMessage,
    shouldRetryListen,
    getLocalPath,
    getTargetUrl,
    getMirrorEntryPath,
    getHealthStatus,
    sendMethodNotAllowed,
    sendOptions,
    rewriteExternalUrlsForLocalMirror,
    rewriteTextForLocalMirror
};
