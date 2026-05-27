const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { execFile } = require('child_process');

const gzipAsync = promisify(zlib.gzip);
const deflateAsync = promisify(zlib.deflate);
const { DEFAULT_ASSET_EXTS, MIME_TYPES } = require('./lib/constants');
const { isHtmlLike, isValidDownload } = require('./lib/validation');
const { fetchWithTimeout } = require('./lib/fetch');
const { fetchWithRetries } = require('./lib/retry-fetch');
const { ensureDirExists } = require('./lib/files');
const { argValue, loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('./lib/config');
const { safeDecodeURIComponent, safeJoin } = require('./lib/paths');
const { createFileLogger } = require('./lib/file-logger');
const { generateLauncher } = require('./lib/generate-launcher');
const { CookieJar, parseCookies, getSetCookieValues } = require('./lib/cookie-jar');

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
const HOST = CONFIG.host;
const TARGET_HOST = CONFIG.targetHost;
const MIRROR_NAME = CONFIG.mirrorName;
const START_PATH = CONFIG.startPath;
const REQUEST_TIMEOUT_MS = CONFIG.requestTimeoutMs;
const MAX_DOWNLOAD_BYTES = CONFIG.maxDownloadBytes;

const REMOTE_MIRRORS = CONFIG.remoteMirrors;
const BUILTIN_REMOTE_MIRRORS = [];

const IGNORED_PATH_PREFIXES = CONFIG.ignoredPathPrefixes;

const COOKIE_JAR_PATH = path.join(__dirname, MIRROR_NAME, '.cookies.json');
let cookieJar = null;
if (CONFIG.forwardCookies) {
    cookieJar = new CookieJar();
    try { fs.unlinkSync(COOKIE_JAR_PATH); } catch { /* ignore */ }
    serverFileLogger.clear();
}

// ====== 通用规则区：不是某个网站专用，不要随便删 ======
const SITE_PATH_PREFIXES = new Set(CONFIG.sitePathPrefixes);

function looksLikeMirroredRemoteHost(segment) {
    return /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(segment);
}

const REWRITE_TEXT_EXTS = new Set(['.html', '.css']);
const EXTERNAL_URL_REWRITE_TEXT_EXTS = new Set(['.js', '.mjs', '.json']);
const REWRITE_ASSET_EXTS = DEFAULT_ASSET_EXTS;
const ALLOWED_METHODS = 'GET, HEAD, POST, OPTIONS';

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

async function compressBody(encoding, data) {
    if (encoding === 'gzip') return gzipAsync(data);
    if (encoding === 'deflate') return deflateAsync(data);
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
            res.end('Error reading file');
            logger('error', `Stream error for ${filePath}: ${err.message}`);
        })
        .pipe(res);
}

async function sendResponse(req, res, status, headers, data) {
    const contentType = headers['Content-Type'] || '';
    const encoding = acceptEncoding(req);

    if (encoding && isCompressible(contentType) && data && data.length > 1024) {
        data = await compressBody(encoding, data);
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
        'Access-Control-Allow-Headers': 'Content-Type, Range, If-None-Match, Cookie',
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

function isTooLargeResponse(response) {
    const contentLength = Number(response.headers.get('content-length'));
    return Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES;
}

async function serveLocalFile(filePath, req, res) {
    try {
        const stat = await fs.promises.stat(filePath);
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

        let data = await fs.promises.readFile(filePath);

        const ext = path.extname(filePath).toLowerCase();
        if (REWRITE_TEXT_EXTS.has(ext) || (ext === '' && !data.includes(0))) {
            data = Buffer.from(rewriteTextForLocalMirror(data.toString('utf8')));
        } else if (EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext)) {
            data = Buffer.from(rewriteExternalUrlsForLocalMirror(data.toString('utf8')));
        }

        await sendResponse(req, res, 200, {
            'Content-Type': getContentType(filePath, data),
            'Cache-Control': 'public, max-age=31536000',
            'ETag': etag,
            'Last-Modified': stat.mtime.toUTCString(),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
        }, data);
    } catch (err) {
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Error reading file');
        }
        logger('error', `File read error for ${filePath}: ${err.message}`);
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
        host: HOST,
        port: getBoundPort(),
        configuredPort: PORT,
        autoPort: AUTO_PORT,
        mirrorName: MIRROR_NAME,
        startPath: START_PATH,
        entryPath: getMirrorEntryPath(),
        mirrorFolder,
        mirrorFolderExists: fs.existsSync(mirrorFolder),
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        maxDownloadBytes: MAX_DOWNLOAD_BYTES,
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

function rewriteSingleUrl(url) {
    if (url.startsWith('https://') || url.startsWith('http://')) {
        const plainUrl = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(\/)/i;
        const m = url.match(plainUrl);
        if (m) return url.replace(m[0], getLocalUrlPrefixForHost(m[1], m[2]));
        return url;
    }
    if (url.startsWith('/')) {
        const mirror = MIRROR_NAME;
        if (url.startsWith(`/${mirror}/`)) return url;
        return `/${mirror}${url}`;
    }
    return url;
}

function rewriteTextForLocalMirror(text) {
    const extGroup = REWRITE_ASSET_EXTS.join('|');
    const mirror = escapeRegExp(MIRROR_NAME);
    const assetUrl = new RegExp('https?:\\/\\/([^/"\\\'\\s)]+)(\\/[^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootAsset = new RegExp('(["\\\'(=])\\/(?!\\/|' + mirror + '\\/)([^"\\\'\\s)]+?\\.(?:' + extGroup + ')(?:\\?[^"\\\'\\s)]*)?)', 'gi');
    const rootRoute = new RegExp('(["\\\'=])\\/(?!\\/|' + mirror + '\\/)([a-z]{2}(?:-[a-z]{2})?(?:\\/[^"\\\'\\s<)]*)?)', 'gi');

    return rewriteExternalUrlsForLocalMirror(text)
        .replace(new RegExp(escapeRegExp(TARGET_HOST), 'gi'), `/${MIRROR_NAME}`)
        // JSON-escaped URLs: https:\/\/host\/path -> /mirrorName/host/path
        .replace(/https?:\\\/\\\/([a-z0-9.-]+\.[a-z]{2,})(\\\/)/gi,
            (match, host, slash) => getLocalUrlPrefixForHost(host, '/'))
        .replace(assetUrl, (match, host, assetPath) => `/${MIRROR_NAME}/${host}${assetPath}`)
        .replace(rootAsset, (match, prefix, assetPath) => `${prefix}/${MIRROR_NAME}/${assetPath}`)
        .replace(rootRoute, (match, prefix, routePath) => `${prefix}/${MIRROR_NAME}/${routePath}`)
        // Remove <base href> to prevent relative URL resolution against origin
        .replace(/<base\s+[^>]*href\s*=\s*["'][^"']*["'][^>]*>\s*/gi, '')
        // iframe, embed, source, object attributes
        .replace(/((?:iframe|embed|source|object)\s+[^>]*?(?:src|data)\s*=\s*["'])((?:https?:\/\/[^"']+)|(?:\/[^"']+))/gi,
            (match, attr, url) => `${attr}${rewriteSingleUrl(url)}`)
        .replace(/((?:data-(?:src|lazy-src|original|bg-src|hi-res-src)|(?:poster|action))\s*=\s*["'])((?:https?:\/\/[^"']+)|(?:\/[^"']+))/gi,
            (match, attr, url) => `${attr}${rewriteSingleUrl(url)}`)
        .replace(/((?:data-)?srcset\s*=\s*["'])([^"']+)/gi, (match, attr, values) => {
            const rewritten = values.replace(/([^,\s]+)\s*(?:[^,]*)/g, (m, url) => m.replace(url, rewriteSingleUrl(url)));
            return `${attr}${rewritten}`;
        });
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

function getAllowedHosts() {
    const hosts = new Set();
    try {
        hosts.add(new URL(TARGET_HOST).hostname);
    } catch {}
    for (const mirror of REMOTE_MIRRORS) {
        try {
            if (mirror.origin) hosts.add(new URL(mirror.origin).hostname);
        } catch {}
    }
    try {
        hosts.add(new URL(CONFIG.cmsMediaHost).hostname);
    } catch {}
    return hosts;
}

function isAllowedTargetHost(urlString) {
    try {
        const hostname = new URL(urlString).hostname;
        return getAllowedHosts().has(hostname);
    } catch {
        return false;
    }
}

function getTargetUrl(req, reqPath) {
    let requestUrl;
    try {
        requestUrl = new URL(req.url, `http://localhost:${getBoundPort()}`);
    } catch {
        return null;
    }
    const targetPath = isMirrorRequest(reqPath) ? stripMirrorPrefix(reqPath) : reqPath;
    const mirror = getRemoteMirror(targetPath);

    if (mirror) {
        return `${mirror.origin}${targetPath.slice(mirror.prefix.length - 1)}${requestUrl.search}`;
    }

    const gcsUrl = getGoogleStorageTargetUrl(targetPath, requestUrl.search);
    if (gcsUrl) return gcsUrl;

    const parts = targetPath.split('/').filter(Boolean);
    if (parts.length > 1 && looksLikeMirroredRemoteHost(parts[0]) && !SITE_PATH_PREFIXES.has(parts[0])) {
        const url = `https://${parts[0]}/${parts.slice(1).join('/')}${requestUrl.search}`;
        if (!isAllowedTargetHost(url)) return null;
        return url;
    }

    return `${TARGET_HOST}${targetPath}${requestUrl.search}`;
}

const pendingFetches = new Map();

async function proxyAndCache(req, res, localPath, reqPath, postBody) {
    const targetUrl = getTargetUrl(req, reqPath);
    if (!targetUrl) {
        logger('error', `SSRF rejected: ${req.url}`);
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden: target host not allowed');
        return;
    }
    logger('cache', `Cache miss: ${req.url} -> ${targetUrl}`);

    // For POST, the body is already buffered — don't abort just because the stream closed
    if (req.destroyed && !postBody) return;

    try {
        const isUnsafeMethod = req.method !== 'GET' && req.method !== 'HEAD';

        // Only deduplicate safe methods (GET/HEAD) — POST must not share fetches
        let fetchResult;
        if (!isUnsafeMethod && pendingFetches.has(targetUrl)) {
            fetchResult = await pendingFetches.get(targetUrl);
        } else {
            const fetchPromise = (async () => {
                let upstreamCookie;
                if (CONFIG.forwardCookies && cookieJar) {
                    const browserCookie = req.headers['cookie'] || '';
                    const jarCookie = cookieJar.getCookiesForUrl(targetUrl);
                    if (browserCookie && jarCookie) {
                        const browserNames = new Set(browserCookie.split(';').map(c => c.trim().split('=')[0]));
                        const jarParts = jarCookie.split(';').filter(c => !browserNames.has(c.trim().split('=')[0]));
                        upstreamCookie = [browserCookie, ...jarParts].join('; ');
                    } else {
                        upstreamCookie = browserCookie || jarCookie || undefined;
                    }
                }

                const fetchOpts = { timeoutMs: REQUEST_TIMEOUT_MS, referer: TARGET_HOST, cookie: upstreamCookie, retries: CONFIG.downloadRetries };

                // Forward POST body and content-type to origin
                if (isUnsafeMethod) {
                    fetchOpts.method = req.method;
                    fetchOpts.headers = {};
                    if (req.headers['content-type']) fetchOpts.headers['Content-Type'] = req.headers['content-type'];
                    fetchOpts.body = postBody;
                    fetchOpts.retries = 0; // Don't retry unsafe methods to avoid duplicate side effects
                    fetchOpts.redirect = 'manual'; // Preserve 3xx status and intermediate Set-Cookie
                }

                const response = await fetchWithRetries(targetUrl, fetchOpts);

                const setCookieValues = getSetCookieValues(response);

                // For manual redirects (POST login flows), forward the redirect to the browser
                if (isUnsafeMethod && response.status >= 300 && response.status < 400) {
                    return {
                        ok: true,
                        status: response.status,
                        redirect: true,
                        location: response.headers.get('location'),
                        setCookieValues
                    };
                }

                if (!response.ok) return { ok: false, status: response.status };

                if (isTooLargeResponse(response)) {
                    return { ok: false, status: 502, reason: 'too large' };
                }

                const buffer = Buffer.from(await response.arrayBuffer());
                if (buffer.length > MAX_DOWNLOAD_BYTES) {
                    return { ok: false, status: 502, reason: 'too large' };
                }

                return { ok: true, buffer, contentType: response.headers.get('content-type'), setCookieValues };
            })();

            if (!isUnsafeMethod) {
                pendingFetches.set(targetUrl, fetchPromise);
            }
            try {
                fetchResult = await fetchPromise;
            } finally {
                if (!isUnsafeMethod) {
                    pendingFetches.delete(targetUrl);
                }
            }
        }

        if (!fetchResult.ok) {
            const msg = fetchResult.reason === 'too large'
                ? 'Origin response too large to proxy'
                : `Origin responded with status: ${fetchResult.status}`;
            logger('error', `${msg}: ${req.url}`);
            res.writeHead(fetchResult.status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(msg);
            return;
        }

        const buffer = fetchResult.buffer;
        const response = { headers: { get: (name) => name === 'content-type' ? fetchResult.contentType : '' } };

        if (CONFIG.forwardCookies && cookieJar && fetchResult.setCookieValues && fetchResult.setCookieValues.length) {
            for (const headerValue of fetchResult.setCookieValues) {
                for (const cookie of parseCookies(headerValue, targetUrl)) {
                    cookieJar.addCookie(cookie);
                }
            }
            cookieJar.saveToFile(COOKIE_JAR_PATH);
        }

        if (req.destroyed && !postBody) return;

        // POST responses are not cached - just forward them
        if (req.method === 'POST') {
            if (fetchResult.redirect) {
                // Forward redirect status and Location to the browser (login flows)
                const redirectHeaders = {
                    'Access-Control-Allow-Origin': '*',
                    'Location': fetchResult.location || '/'
                };
                if (fetchResult.setCookieValues && fetchResult.setCookieValues.length) {
                    res.setHeader('Set-Cookie', fetchResult.setCookieValues);
                }
                res.writeHead(fetchResult.status, redirectHeaders);
                res.end();
                return;
            }
            const responseHeaders = {
                'Content-Type': fetchResult.contentType || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*'
            };
            if (fetchResult.setCookieValues && fetchResult.setCookieValues.length) {
                res.setHeader('Set-Cookie', fetchResult.setCookieValues);
            }
            await sendResponse(req, res, 200, responseHeaders, buffer);
            return;
        }

        if (!isValidDownload(localPath, response, buffer)) {
            const contentType = response.headers.get('content-type') || 'unknown';
            logger('error', `Rejected: ${req.url}`, { contentType });
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Rejected unexpected content');
            return;
        }

        ensureDirExists(localPath);
        await fs.promises.writeFile(localPath, buffer);
        logger('success', `Saved: ${localPath}`);

        if (req.headers.range && canServeRange(localPath)) {
            serveLocalFile(localPath, req, res);
            return;
        }

        const responseHeaders = {
            'Content-Type': getContentType(localPath, buffer),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
        };

        if (fetchResult.setCookieValues && fetchResult.setCookieValues.length) {
            res.setHeader('Set-Cookie', fetchResult.setCookieValues);
        }

        await sendResponse(req, res, 200, responseHeaders, buffer);
    } catch (err) {
        if (res.headersSent) return;
        const status = err.name === 'AbortError' ? 504 : 500;
        logger('error', `${req.url}: ${err.message}`);
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(status === 504 ? 'Gateway timeout' : 'Proxy error');
    }
}

const server = http.createServer(async (req, res) => {
    try {
    if (req.method === 'OPTIONS') {
        sendOptions(res);
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
        sendMethodNotAllowed(req, res);
        return;
    }

    // Collect POST body eagerly before any async work can destroy the stream
    let postBody = undefined;
    if (req.method === 'POST') {
        postBody = await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => resolve(chunks.length > 0 ? Buffer.concat(chunks) : undefined));
            req.on('error', reject);
        });
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

    // POST requests always proxy to origin (for login flows, etc.)
    if (req.method === 'POST') {
        await proxyAndCache(req, res, localPath, reqPath, postBody);
        return;
    }

    try {
        const stat = await fs.promises.stat(localPath);
        if (stat.isFile()) {
            await serveLocalFile(localPath, req, res);
            return;
        }
    } catch {
        // File doesn't exist, fall through to proxy
    }

    await proxyAndCache(req, res, localPath, reqPath);
    } catch (err) {
        if (!res.headersSent) {
            const status = err.name === 'AbortError' ? 504 : 500;
            res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Internal server error');
        }
        logger('error', `Unhandled error for ${req.url}: ${err.message}`);
    }
});

server.timeout = 120000;
server.headersTimeout = 30000;
server.keepAliveTimeout = 5000;

function printStartupInfo(port = getBoundPort(), host = HOST) {
    const displayHost = host === '127.0.0.1' ? 'localhost' : host;
    console.log('\n==========================================================');
    console.log('\x1b[36m  Offline Mirror - Local Proxy & Crawler Server\x1b[0m');
    console.log('==========================================================');
    console.log(`Target host: \x1b[32m${TARGET_HOST}\x1b[0m`);
    console.log(`Mirror folder: \x1b[32m${MIRROR_NAME}\x1b[0m`);
    console.log(`Bind address: \x1b[32m${host}\x1b[0m`);
    console.log(`Local starter: \x1b[32mhttp://${displayHost}:${port}/\x1b[0m`);
    console.log(`Mirror entry: \x1b[32mhttp://${displayHost}:${port}${getMirrorEntryPath()}\x1b[0m`);
    console.log(`Request timeout: ${REQUEST_TIMEOUT_MS}ms`);
    console.log(`Max download size: ${MAX_DOWNLOAD_BYTES} bytes`);
    console.log(`Log file: ${serverFileLogger.logFile || 'disabled'}`);
    if (CONFIG.forwardCookies) {
        console.log(`Cookie forwarding: \x1b[32menabled\x1b[0m`);
        console.log(`  Cookie jar: ${COOKIE_JAR_PATH}`);
        console.log('  \x1b[33mPlease log in through the browser first, then run mirror-assets.js\x1b[0m');
    }
    console.log('Unexpected HTML fallback responses will not be cached as assets.');
    console.log('----------------------------------------------------------\n');
}

function shouldOpenBrowser() {
    return !process.argv.includes('--no-open') && process.env.NO_OPEN !== '1';
}

function openBrowser(port = getBoundPort()) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) return;
    if (!process.argv.includes('--no-open') && process.env.NO_OPEN !== '1') {
        const displayHost = HOST === '127.0.0.1' ? 'localhost' : HOST;
        const url = `http://${displayHost}:${port}/`;
        const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        if (process.platform === 'win32') {
            execFile('cmd', ['/c', 'start', url], (err) => {
                if (err) logger('warn', 'Failed to auto-open browser', { error: err.message });
            });
        } else {
            execFile(startCmd, [url], (err) => {
                if (err) logger('warn', 'Failed to auto-open browser', { error: err.message });
            });
        }
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
            try { fs.writeFileSync(path.join(__dirname, '.port'), String(actualPort)); } catch {}
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
        server.listen(port, HOST);
    }

    listenOn(PORT);

    return server;
}

function printHelp() {
    console.log(`MirrorKit local proxy server

Usage:
  node server.js [--config <file>] [--port <number>] [--host <address>] [--auto-port] [--no-open] [--log-file <file>]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --port <number> Override the configured local server port.
  --host <address>
                  Bind to this address. Default: 127.0.0.1 (localhost only).
                  Use 0.0.0.0 to listen on all network interfaces.
  --auto-port     If the port is busy, try the next available port.
  --no-open       Start the server without opening a browser.
  --log-file <file>
                  Append server logs to this file. Default: logs/mirrorkit-server.log.
  -h, --help      Show this help.

Configuration:
  Edit mirror.config.json, pass --config <file>, or override with PORT,
  MIRRORKIT_HOST, TARGET_HOST, MIRROR_NAME, START_PATH, PROXY_TIMEOUT_MS,
  MIRROR_MAX_DOWNLOAD_BYTES, MIRRORKIT_AUTO_PORT=1, MIRRORKIT_LOG_DIR,
  MIRRORKIT_LOG_FILE, MIRRORKIT_LOG_FILE=0, and NO_OPEN=1.
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
        process.on('unhandledRejection', (reason) => {
            logger('error', `Unhandled rejection: ${reason && reason.stack || reason}`);
        });
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
