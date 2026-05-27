const fs = require('fs');
const path = require('path');
const { DEFAULT_ASSET_EXTS } = require('./constants');
const { createFileInventoryAsync, createMirrorManifest, writeMirrorManifest } = require('./manifest');
const { isInsidePath, mirrorRoot } = require('./paths');

const STANDALONE_MARKER_FILE = '.mirrorkit-standalone.json';

function toPosixPath(value) {
    return value.replace(/\\/g, '/');
}

function copyDirectory(srcDir, destDir, { exclude = () => false } = {}) {
    fs.mkdirSync(destDir, { recursive: true });

    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relativePath = toPosixPath(path.relative(srcDir, srcPath));
        if (exclude(relativePath, entry)) continue;

        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath, { exclude: (childPath, childEntry) => exclude(`${relativePath}/${childPath}`, childEntry) });
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function defaultStandaloneOutDir(rootDir, mirrorName) {
    return path.join(rootDir, 'exports', `${mirrorName}-offline`);
}

function samePath(a, b) {
    const left = path.resolve(a);
    const right = path.resolve(b);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function validateStandaloneOutDir(rootDir, sourceMirrorDir, outDir) {
    if (samePath(outDir, rootDir)) {
        throw new Error(`output folder cannot be the MirrorKit project root: ${outDir}`);
    }

    if (samePath(outDir, sourceMirrorDir) || isInsidePath(sourceMirrorDir, outDir)) {
        throw new Error(`output folder cannot be inside the source mirror folder: ${outDir}`);
    }

    if (isInsidePath(outDir, rootDir)) {
        throw new Error(`output folder cannot contain the MirrorKit project root: ${outDir}`);
    }
}

function isDirectoryEmpty(dir) {
    return fs.readdirSync(dir).length === 0;
}

function canReplaceStandaloneOutDir(outDir) {
    if (!fs.existsSync(outDir)) return true;
    if (!fs.statSync(outDir).isDirectory()) return false;
    return isDirectoryEmpty(outDir) || fs.existsSync(path.join(outDir, STANDALONE_MARKER_FILE));
}

function standalonePackageJson(mirrorName) {
    return {
        name: `${mirrorName.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()}-offline`,
        version: '1.0.0',
        private: true,
        description: `Standalone offline mirror for ${mirrorName}`,
        scripts: {
            start: 'node server.js --auto-port',
            check: 'node server.js --check'
        },
        engines: {
            node: '>=18.0.0'
        }
    };
}

function standaloneWindowsStartScript() {
    return [
        '@echo off',
        'node server.js --check',
        'if errorlevel 1 (',
        '  echo.',
        '  echo Standalone self-check failed.',
        '  pause',
        '  exit /b 1',
        ')',
        'node server.js --auto-port %*',
        'pause',
        ''
    ].join('\r\n');
}

function standaloneUnixStartScript() {
    return [
        '#!/usr/bin/env sh',
        'set -eu',
        'node server.js --check',
        'node server.js --auto-port "$@"',
        ''
    ].join('\n');
}

function standaloneReadme(config) {
    return `# Standalone Offline Mirror

This folder is a standalone offline local project exported from MirrorKit.

It does not include crawler scripts. It only serves files already copied into this folder.

## Run

Windows:

\`\`\`bat
start-windows.bat
\`\`\`

macOS / Linux:

\`\`\`sh
sh start.sh
\`\`\`

The start scripts run a self-check before launching the offline server.

You can also run the server directly:

\`\`\`bat
npm start
\`\`\`

Or:

\`\`\`bat
node server.js
\`\`\`

If the default port is busy, the start scripts automatically try the next available port. You can use the same behavior manually:

\`\`\`bat
node server.js --auto-port
\`\`\`

Open:

\`\`\`text
http://localhost:${config.port || 3000}/
\`\`\`

Mirror entry:

\`\`\`text
http://localhost:${config.port || 3000}${entryPath(config)}
\`\`\`

If the port is busy:

\`\`\`bat
node server.js --port 3001
\`\`\`

Health check:

\`\`\`text
http://localhost:${config.port || 3000}/__health.json
\`\`\`

The server supports byte-range requests for local binary files, which helps offline video and large-file playback.

## Debug Logs

The standalone server appends structured logs to:

\`\`\`text
logs/mirrorkit-standalone.log
\`\`\`

Choose another log file:

\`\`\`bat
node server.js --log-file logs\\debug.log
\`\`\`

Disable file logs:

\`\`\`bat
set MIRRORKIT_LOG_FILE=0
\`\`\`

Log files rotate automatically when they grow past 5 MB. Change the limit with \`MIRRORKIT_LOG_MAX_BYTES\`.

## Self Check

\`\`\`bat
node server.js --check
\`\`\`

The self-check fails if the mirror entry is missing, if the export manifest is missing, or if mirrored files no longer match the manifest.

## Help

\`\`\`bat
node server.js --help
\`\`\`
`;
}

function standaloneStarterHtml(config) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Standalone Offline Mirror</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #111; color: #eee; }
    main { max-width: 760px; padding: 48px 24px; line-height: 1.6; }
    a { color: #8bc7ff; }
    code { background: #222; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; }
  </style>
</head>
<body>
  <main>
    <h1>Standalone Offline Mirror</h1>
    <p>Target: <code>${escapeHtml(config.targetHost)}</code></p>
    <p>Mirror folder: <code>${escapeHtml(config.mirrorName)}</code></p>
    <p><a href="${entryPath(config)}">Open mirror entry</a></p>
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function entryPath(config) {
    const startPath = config.startPath && config.startPath.startsWith('/') ? config.startPath : '/';
    return startPath === '/' ? `/${config.mirrorName}/` : `/${config.mirrorName}${startPath}`;
}

function standaloneServerSource() {
    return `const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);
const deflateAsync = promisify(zlib.deflate);

const ROOT = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'mirror.config.json'), 'utf8'));
const STARTED_AT = new Date();
const PORT = Number(process.env.PORT || argValue(process.argv.slice(2), '--port') || CONFIG.port || 3000);
const AUTO_PORT = process.argv.includes('--auto-port') || process.env.MIRRORKIT_AUTO_PORT === '1' || CONFIG.autoPort === true;
const MIRROR_NAME = CONFIG.mirrorName;
const START_PATH = CONFIG.startPath || '/';
const LOG_FILE = resolveLogFile();
const LOG_MAX_BYTES = numberFrom(process.env.MIRRORKIT_LOG_MAX_BYTES, 5 * 1024 * 1024);
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
const REWRITE_TEXT_EXTS = new Set(['.html', '.css']);
const EXTERNAL_URL_REWRITE_TEXT_EXTS = new Set(['.js', '.mjs', '.json']);
const REWRITE_ASSET_EXTS = ${JSON.stringify(DEFAULT_ASSET_EXTS)};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/opentype',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.ktx': 'image/ktx',
  '.ktx2': 'image/ktx2',
  '.zip': 'application/zip',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.vtt': 'text/vtt',
  '.map': 'application/json',
  '.mpd': 'application/dash+xml'
};

const COMPRESSIBLE_CT = new Set([
  'text/html', 'text/css', 'text/plain', 'application/javascript',
  'application/json', 'image/svg+xml', 'application/wasm'
]);

function argValue(argv, name) {
  const eqPrefix = \`\${name}=\`;
  const eqValue = argv.find(arg => arg.startsWith(eqPrefix));
  if (eqValue) return eqValue.slice(eqPrefix.length);
  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1];
  return null;
}

function numberFrom(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveLogFile() {
  if (process.env.MIRRORKIT_LOG_FILE === '0' || process.env.NO_LOG_FILE === '1') return null;
  const explicit = argValue(process.argv.slice(2), '--log-file') || process.env.MIRRORKIT_LOG_FILE;
  if (explicit) return path.resolve(ROOT, explicit);
  const logDir = process.env.MIRRORKIT_LOG_DIR || 'logs';
  return path.resolve(ROOT, logDir, 'mirrorkit-standalone.log');
}

function logEvent(level, message, details = {}) {
  if (!LOG_FILE) return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    }) + '\\n';
    rotateLogIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // Logging must never stop the offline server.
  }
}

function rotateLogIfNeeded(incomingBytes) {
  if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return;
  const size = fs.statSync(LOG_FILE).size;
  if (size + incomingBytes <= LOG_MAX_BYTES) return;
  fs.rmSync(\`\${LOG_FILE}.1\`, { force: true });
  fs.renameSync(LOG_FILE, \`\${LOG_FILE}.1\`);
}

function entryPath() {
  const startPath = START_PATH.startsWith('/') ? START_PATH : '/';
  return startPath === '/' ? \`/\${MIRROR_NAME}/\` : \`/\${MIRROR_NAME}\${startPath}\`;
}

function boundPort() {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : PORT;
}

function isInsidePath(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeJoin(rootDir, unsafePath) {
  if (typeof unsafePath !== 'string') return null;
  if (unsafePath.includes('\0')) return null;
  let normalized = unsafePath.replace(/\\\\/g, '/').replace(/^[/]+/, '');
  if (/^[a-zA-Z]:[/]/.test(normalized) || normalized.startsWith('//')) return null;
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some(part => part === '..')) return null;
  const localPath = path.join(rootDir, ...parts);
  return isInsidePath(rootDir, localPath) ? localPath : null;
}

function mirrorRelativePath(reqPath) {
  let cleanPath;
  try {
    cleanPath = decodeURIComponent(reqPath);
  } catch {
    return null;
  }

  if (cleanPath === \`/\${MIRROR_NAME}\`) cleanPath = '/';
  else if (cleanPath.startsWith(\`/\${MIRROR_NAME}/\`)) cleanPath = cleanPath.slice(MIRROR_NAME.length + 1);

  if (!cleanPath.startsWith('/')) cleanPath = \`/\${cleanPath}\`;
  if (cleanPath.replace(/\\\\/g, '/').split('/').includes('..')) return null;

  if (path.extname(cleanPath) === '') cleanPath = path.posix.join(cleanPath, 'index.html');
  return cleanPath;
}

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function parseRangeHeader(rangeHeader, size) {
  const match = /^bytes=(\\d*)-(\\d*)$/.exec(String(rangeHeader || '').trim());
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
    'Content-Range': \`bytes */\${size}\`,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*'
  });
  res.end();
}

function escapeRegExp(value) {
  return String(value).replace(new RegExp('[\\\\\\\\^$.*+?()[\\\\]{}|]', 'g'), '\\\\$&');
}

function targetHostName() {
  return new URL(CONFIG.targetHost).hostname;
}

function localUrlPrefixForHost(host, slash) {
  const separator = slash === '\\\\/' ? '\\\\/' : '/';
  if (host === targetHostName()) return \`\${separator}\${MIRROR_NAME}\${separator}\`;
  return \`\${separator}\${MIRROR_NAME}\${separator}\${host}\${separator}\`;
}

function rewriteExternalUrlsForLocalMirror(text) {
  const plainUrl = /\\bhttps?:\\/\\/([a-z0-9.-]+\\.[a-z]{2,})(\\/)/gi;
  const escapedUrl = /\\bhttps?:\\\\\\/\\\\\\/([a-z0-9.-]+\\.[a-z]{2,})(\\\\\\/)/gi;
  return text
    .replace(plainUrl, (match, host, slash) => localUrlPrefixForHost(host, slash))
    .replace(escapedUrl, (match, host, slash) => localUrlPrefixForHost(host, slash));
}

function rewriteSingleUrl(url) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    const plainUrl = /\\bhttps?:\\/\\/([a-z0-9.-]+\\.[a-z]{2,})(\\/)/i;
    const m = url.match(plainUrl);
    if (m) return url.replace(m[0], localUrlPrefixForHost(m[1], m[2]));
    return url;
  }
  if (url.startsWith('/')) {
    const mirror = MIRROR_NAME;
    if (url.startsWith(\`/\${mirror}/\`)) return url;
    return \`/\${mirror}\${url}\`;
  }
  return url;
}

function rewriteTextForLocalMirror(text) {
  const extGroup = REWRITE_ASSET_EXTS.join('|');
  const mirror = escapeRegExp(MIRROR_NAME);
  const assetUrl = new RegExp('https?:\\\\/\\\\/([^/"\\\\\\'\\\\s)]+)(\\\\/[^"\\\\\\'\\\\s)]+?\\\\.(?:' + extGroup + ')(?:\\\\?[^"\\\\\\'\\\\s)]*)?)', 'gi');
  const rootAsset = new RegExp('(["\\\\\\'(=])\\\\/(?!\\\\/|' + mirror + '\\\\/)([^"\\\\\\'\\\\s)]+?\\\\.(?:' + extGroup + ')(?:\\\\?[^"\\\\\\'\\\\s)]*)?)', 'gi');
  const rootRoute = new RegExp('(["\\\\\\'=])\\\\/(?!\\\\/|' + mirror + '\\\\/)([a-z]{2}(?:-[a-z]{2})?(?:\\\\/[^"\\\\\\'\\\\s<)]*)?)', 'gi');
  return rewriteExternalUrlsForLocalMirror(text)
    .replace(new RegExp(escapeRegExp(CONFIG.targetHost), 'gi'), \`/\${MIRROR_NAME}\`)
    .replace(/https?:\\\\\\/\\\\\\/([a-z0-9.-]+\\.[a-z]{2,})(\\\\\\/)/gi,
      (match, host, slash) => localUrlPrefixForHost(host, '/'))
    .replace(assetUrl, (match, host, assetPath) => \`/\${MIRROR_NAME}/\${host}\${assetPath}\`)
    .replace(rootAsset, (match, prefix, assetPath) => \`\${prefix}/\${MIRROR_NAME}/\${assetPath}\`)
    .replace(rootRoute, (match, prefix, routePath) => \`\${prefix}/\${MIRROR_NAME}/\${routePath}\`)
    .replace(/<base\\s+[^>]*href\\s*=\\s*["'][^"']*["'][^>]*>\\s*/gi, '')
    .replace(/((?:iframe|embed|source|object)\\s+[^>]*?(?:src|data)\\s*=\\s*["'])((?:https?:\\/\\/[^"']+)|(?:\\/[^"']+))/gi,
      (match, attr, url) => \`\${attr}\${rewriteSingleUrl(url)}\`)
    .replace(/((?:data-(?:src|lazy-src|original|bg-src|hi-res-src)|(?:poster|action))\\s*=\\s*["'])((?:https?:\\/\\/[^"']+)|(?:\\/[^"']+))/gi,
      (match, attr, url) => \`\${attr}\${rewriteSingleUrl(url)}\`)
    .replace(/((?:data-)?srcset\\s*=\\s*["'])([^"']+)/gi, (match, attr, values) => {
      const rewritten = values.replace(/([^,\\s]+)\\s*(?:[^,]*)/g, (m, url) => m.replace(url, rewriteSingleUrl(url)));
      return \`\${attr}\${rewritten}\`;
    });
}

function acceptEncoding(req) {
  const value = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (value.includes('gzip')) return 'gzip';
  if (value.includes('deflate')) return 'deflate';
  return null;
}

async function send(req, res, status, headers, data) {
  const contentType = String(headers['Content-Type'] || '').split(';')[0].trim().toLowerCase();
  const encoding = acceptEncoding(req);
  if (encoding && data && data.length > 1024 && COMPRESSIBLE_CT.has(contentType)) {
    data = encoding === 'gzip' ? await gzipAsync(data) : await deflateAsync(data);
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
  logEvent('warn', 'Method not allowed', { method: req.method, url: req.url });
  res.writeHead(405, {
    'Allow': ALLOWED_METHODS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(req.method === 'HEAD' ? undefined : \`Method not allowed: \${req.method}\`);
}

function serveFileRange(req, res, filePath, stat) {
  const range = parseRangeHeader(req.headers.range, stat.size);
  if (!range) {
    sendRangeNotSatisfiable(res, stat.size);
    return;
  }

  res.writeHead(206, {
    'Content-Type': contentType(filePath),
    'Cache-Control': 'public, max-age=31536000',
    'Last-Modified': stat.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
    'Content-Range': \`bytes \${range.start}-\${range.end}/\${stat.size}\`,
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
      res.end(\`Error reading file: \${err.code || err.message}\`);
    })
    .pipe(res);
}

async function serveFile(req, res, filePath) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    logEvent('warn', 'Offline file not found', { filePath });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('Offline file not found');
    return;
  }

  if (req.headers.range && canServeRange(filePath)) {
    serveFileRange(req, res, filePath, stat);
    return;
  }

  try {
    let data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (REWRITE_TEXT_EXTS.has(ext) || ext === '') {
      data = Buffer.from(rewriteTextForLocalMirror(data.toString('utf8')));
    } else if (EXTERNAL_URL_REWRITE_TEXT_EXTS.has(ext)) {
      data = Buffer.from(rewriteExternalUrlsForLocalMirror(data.toString('utf8')));
    }
    await send(req, res, 200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'public, max-age=31536000',
      'Last-Modified': stat.mtime.toUTCString(),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    }, data);
  } catch (err) {
    logEvent('warn', 'Offline file not found', { filePath, error: err.code || err.message });
    if (!res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end('Offline file not found');
    }
  }
}

function health() {
  const mirrorFolder = path.join(ROOT, MIRROR_NAME);
  return {
    ok: true,
    standalone: true,
    startedAt: STARTED_AT.toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
    targetHost: CONFIG.targetHost,
    port: boundPort(),
    configuredPort: PORT,
    autoPort: AUTO_PORT,
    mirrorName: MIRROR_NAME,
    startPath: START_PATH,
    entryPath: entryPath(),
    mirrorFolder,
    mirrorFolderExists: fs.existsSync(mirrorFolder),
    logFile: LOG_FILE
  };
}

function formatListenError(err) {
  if (err && err.code === 'EADDRINUSE') {
    return [
      \`Port \${PORT} is already in use.\`,
      \`Try: node server.js --port \${PORT + 1}\`,
      \`Or set PORT=\${PORT + 1}\`
    ].join('\\n');
  }
  if (err && err.code === 'EACCES') {
    return [
      \`Port \${PORT} is not allowed on this machine.\`,
      'Try a higher port, for example: node server.js --port 3001'
    ].join('\\n');
  }
  return \`Failed to start standalone server: \${err && err.message ? err.message : err}\`;
}

function handleListenError(err) {
  logEvent('error', 'Listen error', { error: err && err.message ? err.message : String(err), code: err && err.code });
  console.error(formatListenError(err));
  process.exitCode = 1;
}

function shouldRetryListen(err, port, autoPort = AUTO_PORT) {
  return Boolean(autoPort && err && err.code === 'EADDRINUSE' && port < 65535);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function shouldIncludeFile(relativePath) {
  const name = path.basename(relativePath);
  if (/^\\.mirror-manifest.*\\.json(?:\\.tmp)?$/.test(name)) return false;
  if (/^\\.mirror-progress.*\\.json(?:\\.tmp)?$/.test(name)) return false;
  return true;
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileInventory(scanDir) {
  return walk(scanDir)
    .map(filePath => {
      const relativePath = path.relative(scanDir, filePath).replace(/\\\\/g, '/');
      if (!shouldIncludeFile(relativePath)) return null;
      const stat = fs.statSync(filePath);
      return { path: relativePath, bytes: stat.size, sha256: hashFile(filePath) };
    })
    .filter(Boolean)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function verifyManifest(manifestPath, scanDir) {
  const report = { ok: false, manifestPath, checked: 0, missing: [], changed: [], extra: [], error: null };
  if (!fs.existsSync(manifestPath)) {
    report.error = 'manifest file not found';
    return report;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    report.error = err.message;
    return report;
  }

  if (!Array.isArray(manifest.files)) {
    report.error = 'manifest does not contain a files array';
    return report;
  }

  const currentFiles = fileInventory(scanDir);
  const currentByPath = new Map(currentFiles.map(file => [file.path, file]));
  const expectedByPath = new Map();

  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string') continue;
    expectedByPath.set(file.path, file);
    const current = currentByPath.get(file.path);
    if (!current) {
      report.missing.push({ path: file.path });
      continue;
    }

    report.checked++;
    if (current.bytes !== file.bytes || current.sha256 !== file.sha256) {
      report.changed.push({
        path: file.path,
        expectedBytes: file.bytes,
        actualBytes: current.bytes,
        expectedSha256: file.sha256,
        actualSha256: current.sha256
      });
    }
  }

  for (const file of currentFiles) {
    if (!expectedByPath.has(file.path)) report.extra.push(file);
  }

  report.ok = report.missing.length === 0 && report.changed.length === 0 && report.extra.length === 0;
  return report;
}

function runCheck() {
  const mirrorFolder = path.join(ROOT, MIRROR_NAME);
  const checks = [];
  checks.push({ name: 'mirror-folder', ok: fs.existsSync(mirrorFolder) && fs.statSync(mirrorFolder).isDirectory() });

  const entryFile = safeJoin(mirrorFolder, mirrorRelativePath(entryPath()));
  checks.push({ name: 'entry-file', ok: Boolean(entryFile && fs.existsSync(entryFile)), path: entryFile });

  const manifestPath = path.join(mirrorFolder, '.mirror-manifest.json');
  const manifest = verifyManifest(manifestPath, mirrorFolder);
  checks.push({ name: 'manifest', ok: manifest.ok, details: manifest });

  const ok = checks.every(check => check.ok);
  console.log(JSON.stringify({ ok, standalone: true, checks }, null, 2));
  if (!ok) process.exitCode = 1;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return sendOptions(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendMethodNotAllowed(req, res);

  let url;
  try {
    url = new URL(req.url, \`http://localhost:\${boundPort()}\`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (url.pathname === '/__mirror-config.json') {
    await send(req, res, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }, Buffer.from(JSON.stringify({ ...CONFIG, entryPath: entryPath() })));
    return;
  }

  if (url.pathname === '/__health.json') {
    await send(req, res, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }, Buffer.from(JSON.stringify(health())));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    await serveFile(req, res, path.join(ROOT, 'index.html'));
    return;
  }

  const relativePath = mirrorRelativePath(url.pathname);
  const filePath = relativePath ? safeJoin(path.join(ROOT, MIRROR_NAME), relativePath) : null;
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end('Forbidden');
    return;
  }

  await serveFile(req, res, filePath);
});

function start() {
  function listenOn(port) {
    const onListening = () => {
      server.off('error', onError);
      const actualPort = boundPort();
      logEvent('info', 'Standalone server started', { port: actualPort, entryPath: entryPath() });
      console.log(\`Standalone offline mirror running at http://localhost:\${actualPort}/\`);
      console.log(\`Mirror entry: http://localhost:\${actualPort}\${entryPath()}\`);
      console.log(\`Log file: \${LOG_FILE || 'disabled'}\`);
    };

    const onError = err => {
      server.off('listening', onListening);
      if (shouldRetryListen(err, port)) {
        const nextPort = port + 1;
        logEvent('warn', 'Port busy; trying next port', { port, nextPort });
        console.warn(\`Port \${port} is already in use. Trying \${nextPort}...\`);
        listenOn(nextPort);
        return;
      }

      handleListenError(err);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  }

  listenOn(PORT);
}

function printHelp() {
  console.log(\`Standalone offline mirror server

Usage:
  node server.js [--port <number>] [--auto-port] [--check] [--log-file <file>]

Options:
  --port <number> Override the configured local server port.
  --auto-port     If the port is busy, try the next available port.
  --check         Verify the offline mirror files and manifest without starting the server.
  --log-file <file>
                 Append structured server logs to this file. Default: logs/mirrorkit-standalone.log.
                 Logs rotate to <file>.1 after 5 MB by default.
  -h, --help      Show this help.

Useful URLs after startup:
  Starter page:  http://localhost:\${PORT}/
  Mirror entry:  http://localhost:\${PORT}\${entryPath()}
  Health check:  http://localhost:\${PORT}/__health.json
  Log file:      \${LOG_FILE || 'disabled'}

This folder is standalone. It only serves local copied files and does not include crawler tools.
\`);
}

if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) printHelp();
  else if (process.argv.includes('--check')) runCheck();
  else start();
}

module.exports = { server, boundPort, entryPath, formatListenError, health, logEvent, printHelp, runCheck, shouldRetryListen, verifyManifest };
`;
}

async function exportStandaloneProject({
    rootDir,
    config,
    outDir = defaultStandaloneOutDir(rootDir, config.mirrorName),
    force = false
}) {
    const sourceMirrorDir = mirrorRoot(rootDir, config.mirrorName);
    validateStandaloneOutDir(rootDir, sourceMirrorDir, outDir);

    if (!fs.existsSync(sourceMirrorDir) || !fs.statSync(sourceMirrorDir).isDirectory()) {
        throw new Error(`mirror folder not found: ${sourceMirrorDir}`);
    }

    if (fs.existsSync(outDir)) {
        if (!force) throw new Error(`output folder already exists: ${outDir}`);
        if (!canReplaceStandaloneOutDir(outDir)) {
            throw new Error(`refusing to replace a folder that was not created by MirrorKit standalone export: ${outDir}`);
        }
        fs.rmSync(outDir, { recursive: true, force: true });
    }

    fs.mkdirSync(outDir, { recursive: true });
    const mirrorDest = path.join(outDir, config.mirrorName);
    copyDirectory(sourceMirrorDir, mirrorDest, {
        exclude: relativePath => /\.tmp$/i.test(relativePath) || /^\.mirror-progress.*\.json$/i.test(path.basename(relativePath))
    });

    const standaloneConfig = {
        port: config.port || 3000,
        autoPort: config.autoPort === undefined ? true : Boolean(config.autoPort),
        targetHost: config.targetHost,
        mirrorName: config.mirrorName,
        startPath: config.startPath || '/',
        exportedAt: new Date().toISOString()
    };

    writeMirrorManifest(path.join(mirrorDest, '.mirror-manifest.json'), createMirrorManifest({
        tool: 'export-standalone',
        targetHost: standaloneConfig.targetHost,
        mirrorName: standaloneConfig.mirrorName,
        startPath: standaloneConfig.startPath,
        stats: {},
        resources: [],
        pending: [],
        files: await createFileInventoryAsync(mirrorDest),
        scannedUniqueResources: 0,
        generatedAt: standaloneConfig.exportedAt
    }));

    fs.writeFileSync(path.join(outDir, 'server.js'), standaloneServerSource());
    fs.writeFileSync(path.join(outDir, 'index.html'), standaloneStarterHtml(standaloneConfig));
    fs.writeFileSync(path.join(outDir, 'mirror.config.json'), `${JSON.stringify(standaloneConfig, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(standalonePackageJson(config.mirrorName), null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, 'README.md'), standaloneReadme(standaloneConfig));
    fs.writeFileSync(path.join(outDir, 'start-windows.bat'), standaloneWindowsStartScript());
    fs.writeFileSync(path.join(outDir, 'start.sh'), standaloneUnixStartScript(), { mode: 0o755 });
    fs.writeFileSync(path.join(outDir, STANDALONE_MARKER_FILE), `${JSON.stringify({
        tool: 'MirrorKit standalone export',
        mirrorName: standaloneConfig.mirrorName,
        targetHost: standaloneConfig.targetHost,
        exportedAt: standaloneConfig.exportedAt
    }, null, 2)}\n`);

    return {
        outDir,
        mirrorDir: mirrorDest,
        entryPath: entryPath(standaloneConfig),
        files: [
            'server.js',
            'index.html',
            'mirror.config.json',
            'package.json',
            'README.md',
            'start-windows.bat',
            'start.sh',
            STANDALONE_MARKER_FILE,
            config.mirrorName
        ]
    };
}

module.exports = {
    STANDALONE_MARKER_FILE,
    canReplaceStandaloneOutDir,
    copyDirectory,
    defaultStandaloneOutDir,
    exportStandaloneProject,
    standaloneServerSource,
    standaloneUnixStartScript,
    standaloneWindowsStartScript,
    validateStandaloneOutDir
};
