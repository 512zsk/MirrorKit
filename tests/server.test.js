const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listen(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function listenAny(server) {
    return new Promise(resolve => {
        server.listen(0, () => resolve(server.address().port));
    });
}

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

function waitForListening(server) {
    if (server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 2000);
        server.once('listening', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function loadServerWithEnv(env) {
    const serverPath = require.resolve('../server');
    delete require.cache[serverPath];
    for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return require('../server');
}

describe('server integration', () => {
    let origin;
    let originPort;
    let mirrorName;
    let mirrorDir;
    let mirrorServerModule;
    let previousEnv;

    beforeEach(async () => {
        previousEnv = {
            TARGET_HOST: process.env.TARGET_HOST,
            MIRROR_NAME: process.env.MIRROR_NAME,
            START_PATH: process.env.START_PATH,
            PORT: process.env.PORT,
            MIRRORKIT_AUTO_PORT: process.env.MIRRORKIT_AUTO_PORT,
            MIRRORKIT_LOG_DIR: process.env.MIRRORKIT_LOG_DIR,
            MIRRORKIT_LOG_FILE: process.env.MIRRORKIT_LOG_FILE,
            NO_LOG_FILE: process.env.NO_LOG_FILE,
            NO_OPEN: process.env.NO_OPEN
        };

        origin = http.createServer((req, res) => {
            if (req.url === '/assets/app.js') {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end('window.cached = true;');
                return;
            }

            if (req.url === '/bad.png') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<!doctype html><html><title>not found</title></html>');
                return;
            }

            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('missing');
        });
        originPort = await listen(origin);

        mirrorName = `.tmp-server-mirror-${process.pid}-${Date.now()}`;
        mirrorDir = path.join(ROOT, mirrorName);
        fs.rmSync(mirrorDir, { recursive: true, force: true });

        mirrorServerModule = loadServerWithEnv({
            TARGET_HOST: `http://127.0.0.1:${originPort}`,
            MIRROR_NAME: mirrorName,
            START_PATH: '/',
            MIRRORKIT_LOG_DIR: path.join(mirrorName, 'logs'),
            MIRRORKIT_LOG_FILE: undefined,
            NO_LOG_FILE: undefined,
            NO_OPEN: '1'
        });
    });

    afterEach(async () => {
        if (mirrorServerModule?.server?.listening) {
            await close(mirrorServerModule.server);
        }
        await close(origin);
        fs.rmSync(mirrorDir, { recursive: true, force: true });

        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }

        const serverPath = require.resolve('../server');
        delete require.cache[serverPath];
    });

    it('fetches a missing asset from origin and caches it locally', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/app.js`);

        assert.strictEqual(response.status, 200);
        assert.strictEqual(await response.text(), 'window.cached = true;');
        assert.strictEqual(fs.existsSync(path.join(mirrorDir, 'assets', 'app.js')), true);
    });

    it('serves HEAD requests without a response body', async () => {
        fs.mkdirSync(path.join(mirrorDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'assets', 'app.js'), 'window.cached = true;');

        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/app.js`, { method: 'HEAD' });

        assert.strictEqual(response.status, 200);
        assert.match(response.headers.get('content-type'), /javascript/);
        assert.strictEqual(await response.text(), '');
    });

    it('serves byte ranges for cached binary files', async () => {
        fs.mkdirSync(path.join(mirrorDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'assets', 'clip.mp4'), Buffer.from('0123456789'));

        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/clip.mp4`, {
            headers: { Range: 'bytes=2-5' }
        });

        assert.strictEqual(response.status, 206);
        assert.strictEqual(response.headers.get('accept-ranges'), 'bytes');
        assert.strictEqual(response.headers.get('content-range'), 'bytes 2-5/10');
        assert.strictEqual(response.headers.get('content-length'), '4');
        assert.strictEqual(Buffer.from(await response.arrayBuffer()).toString(), '2345');
    });

    it('rejects invalid byte ranges for cached binary files', async () => {
        fs.mkdirSync(path.join(mirrorDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'assets', 'clip.mp4'), Buffer.from('0123456789'));

        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/clip.mp4`, {
            headers: { Range: 'bytes=20-30' }
        });

        assert.strictEqual(response.status, 416);
        assert.strictEqual(response.headers.get('accept-ranges'), 'bytes');
        assert.strictEqual(response.headers.get('content-range'), 'bytes */10');
    });

    it('handles CORS preflight without proxying to origin', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/app.js`, { method: 'OPTIONS' });

        assert.strictEqual(response.status, 204);
        assert.strictEqual(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
        assert.strictEqual(response.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
        assert.strictEqual(fs.existsSync(path.join(mirrorDir, 'assets', 'app.js')), false);
    });

    it('rejects unsupported methods before proxying', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/assets/app.js`, { method: 'POST' });

        assert.strictEqual(response.status, 405);
        assert.strictEqual(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
        assert.match(await response.text(), /Method not allowed: POST/);
        assert.strictEqual(fs.existsSync(path.join(mirrorDir, 'assets', 'app.js')), false);
    });

    it('rejects HTML fallback content for binary assets', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/${mirrorName}/bad.png`);

        assert.strictEqual(response.status, 502);
        assert.strictEqual(fs.existsSync(path.join(mirrorDir, 'bad.png')), false);
    });

    it('ignores configured noisy request prefixes', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/.well-known/appspecific/com.chrome.devtools.json`);

        assert.strictEqual(response.status, 204);
    });

    it('serves a no-cache health endpoint for monitoring', async () => {
        const port = await listen(mirrorServerModule.server);
        const response = await fetch(`http://127.0.0.1:${port}/__health.json`);
        const health = await response.json();

        assert.strictEqual(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.strictEqual(response.headers.get('cache-control'), 'no-store');
        assert.strictEqual(health.ok, true);
        assert.strictEqual(health.targetHost, `http://127.0.0.1:${originPort}`);
        assert.strictEqual(health.mirrorName, mirrorName);
        assert.strictEqual(health.entryPath, `/${mirrorName}/`);
        assert.strictEqual(health.mirrorFolderExists, false);
        assert.strictEqual(Number.isInteger(health.uptimeSeconds), true);
        assert.match(health.logFile, /mirrorkit-server\.log$/);
    });

    it('returns health status without starting the HTTP server', () => {
        const health = mirrorServerModule.getHealthStatus();

        assert.strictEqual(health.ok, true);
        assert.strictEqual(health.mirrorName, mirrorName);
        assert.strictEqual(health.entryPath, `/${mirrorName}/`);
        assert.strictEqual(typeof health.startedAt, 'string');
    });

    it('prints actionable listen errors for occupied or restricted ports', () => {
        assert.match(
            mirrorServerModule.listenErrorMessage({ code: 'EADDRINUSE' }, 3000),
            /node server\.js --port 3001/
        );
        assert.match(
            mirrorServerModule.listenErrorMessage({ code: 'EACCES' }, 80),
            /permission restrictions/
        );
    });

    it('retries occupied ports only when auto-port is enabled', () => {
        assert.strictEqual(mirrorServerModule.shouldRetryListen({ code: 'EADDRINUSE' }, 3000, true), true);
        assert.strictEqual(mirrorServerModule.shouldRetryListen({ code: 'EADDRINUSE' }, 3000, false), false);
        assert.strictEqual(mirrorServerModule.shouldRetryListen({ code: 'EACCES' }, 3000, true), false);
        assert.strictEqual(mirrorServerModule.shouldRetryListen({ code: 'EADDRINUSE' }, 65535, true), false);
    });

    it('starts on the next available port when auto-port is enabled', async () => {
        const blocker = http.createServer((req, res) => res.end('busy'));
        const blockedPort = await listenAny(blocker);
        const serverPath = require.resolve('../server');
        delete require.cache[serverPath];

        mirrorServerModule = loadServerWithEnv({
            TARGET_HOST: `http://127.0.0.1:${originPort}`,
            MIRROR_NAME: mirrorName,
            START_PATH: '/',
            PORT: String(blockedPort),
            MIRRORKIT_AUTO_PORT: '1',
            NO_OPEN: '1'
        });

        try {
            mirrorServerModule.startServer();
            await waitForListening(mirrorServerModule.server);
            const health = mirrorServerModule.getHealthStatus();

            assert.notStrictEqual(health.port, blockedPort);
            assert.strictEqual(health.configuredPort, blockedPort);
            assert.strictEqual(health.autoPort, true);
        } finally {
            await close(blocker);
        }
    });
});

describe('URL rewriting', () => {
    let mirrorServerModule;
    let previousEnv;

    beforeEach(() => {
        previousEnv = {
            TARGET_HOST: process.env.TARGET_HOST,
            MIRROR_NAME: process.env.MIRROR_NAME
        };
        mirrorServerModule = loadServerWithEnv({
            TARGET_HOST: 'https://www.example.test',
            MIRROR_NAME: 'example.test',
            NO_OPEN: '1'
        });
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(previousEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        const serverPath = require.resolve('../server');
        delete require.cache[serverPath];
    });

    it('rewrites target-host, external-host, root asset, and language routes', () => {
        const input = [
            '<script src="https://cdn.example.test/app.js"></script>',
            '<img src="/assets/logo.png">',
            '<a href="/zh/about">About</a>',
            'https://www.example.test/assets/site.css'
        ].join('\n');

        const output = mirrorServerModule.rewriteTextForLocalMirror(input);
        assert.match(output, /\/example\.test\/cdn\.example\.test\/app\.js/);
        assert.match(output, /src="\/example\.test\/assets\/logo\.png"/);
        assert.match(output, /href="\/example\.test\/zh\/about"/);
        assert.match(output, /\/example\.test\/assets\/site\.css/);
    });

    it('rewrites escaped external URLs without dropping escaped slashes', () => {
        const output = mirrorServerModule.rewriteExternalUrlsForLocalMirror('https:\\/\\/cdn.example.test\\/video.mp4');
        assert.strictEqual(output, '\\/example.test\\/cdn.example.test\\/video.mp4');
    });
});
