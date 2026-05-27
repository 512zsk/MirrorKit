const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { STANDALONE_MARKER_FILE, exportStandaloneProject } = require('../lib/standalone-export');

function listen(server) {
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

describe('exportStandaloneProject', () => {
    let tmpDir;
    let config;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-standalone-'));
        config = {
            port: 3000,
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            startPath: '/'
        };

        const mirrorDir = path.join(tmpDir, config.mirrorName);
        fs.mkdirSync(path.join(mirrorDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'index.html'), [
            '<!doctype html><html><body>',
            '<script src="https://cdn.example.test/app.js"></script>',
            '<img src="/assets/logo.png">',
            '<a href="/zh/about">About</a>',
            'offline',
            '</body></html>'
        ].join(''));
        fs.writeFileSync(path.join(mirrorDir, 'assets', 'app.js'), 'window.video = "https:\\/\\/cdn.example.test\\/video.mp4";');
        fs.writeFileSync(path.join(mirrorDir, 'assets', 'clip.mp4'), Buffer.from('0123456789'));
        fs.writeFileSync(path.join(mirrorDir, '.mirror-progress.json'), '{"pass":1}');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('exports a self-contained offline project without crawler files', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        const result = await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        assert.strictEqual(result.entryPath, '/example.test/');
        assert.strictEqual(fs.existsSync(path.join(outDir, 'server.js')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'package.json')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'README.md')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'start-windows.bat')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'start.sh')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, STANDALONE_MARKER_FILE)), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, config.mirrorName, 'index.html')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, config.mirrorName, 'assets', 'app.js')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, config.mirrorName, '.mirror-progress.json')), false);
        assert.strictEqual(fs.existsSync(path.join(outDir, config.mirrorName, '.mirror-manifest.json')), true);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'tools')), false);
        assert.strictEqual(fs.existsSync(path.join(outDir, 'lib')), false);

        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, config.mirrorName, '.mirror-manifest.json'), 'utf8'));
        assert.strictEqual(manifest.tool, 'export-standalone');
        assert.strictEqual(manifest.fileCount, 3);
        assert.deepStrictEqual(manifest.files.map(file => file.path), ['assets/app.js', 'assets/clip.mp4', 'index.html']);

        const pkg = JSON.parse(fs.readFileSync(path.join(outDir, 'package.json'), 'utf8'));
        assert.strictEqual(pkg.scripts.start, 'node server.js --auto-port');
        assert.strictEqual(pkg.scripts.check, 'node server.js --check');
        const standaloneConfig = JSON.parse(fs.readFileSync(path.join(outDir, 'mirror.config.json'), 'utf8'));
        assert.strictEqual(standaloneConfig.autoPort, true);
        const marker = JSON.parse(fs.readFileSync(path.join(outDir, STANDALONE_MARKER_FILE), 'utf8'));
        assert.strictEqual(marker.tool, 'MirrorKit standalone export');
        assert.strictEqual(marker.mirrorName, config.mirrorName);
        assert.match(fs.readFileSync(path.join(outDir, 'README.md'), 'utf8'), /node server\.js --check/);
        assert.match(fs.readFileSync(path.join(outDir, 'README.md'), 'utf8'), /logs\/mirrorkit-standalone\.log/);
        assert.match(fs.readFileSync(path.join(outDir, 'start-windows.bat'), 'utf8'), /node server\.js --check/);
        assert.match(fs.readFileSync(path.join(outDir, 'start-windows.bat'), 'utf8'), /node server\.js --auto-port %\*/);
        assert.match(fs.readFileSync(path.join(outDir, 'start.sh'), 'utf8'), /node server\.js --check/);
        assert.match(fs.readFileSync(path.join(outDir, 'start.sh'), 'utf8'), /node server\.js --auto-port "\$@"/);

        const syntax = spawnSync(process.execPath, ['--check', path.join(outDir, 'server.js')], { encoding: 'utf8' });
        assert.strictEqual(syntax.status, 0, syntax.stderr);
    });

    it('prints standalone server help without starting the server', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        const result = spawnSync(process.execPath, ['server.js', '--help'], {
            cwd: outDir,
            encoding: 'utf8'
        });

        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Standalone offline mirror server/);
        assert.match(result.stdout, /--port/);
        assert.match(result.stdout, /--auto-port/);
        assert.match(result.stdout, /--check/);
        assert.match(result.stdout, /--log-file/);
        assert.match(result.stdout, /does not include crawler tools/);
    });

    it('lets the exported project check itself without MirrorKit helpers', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        const result = spawnSync(process.execPath, ['server.js', '--check'], {
            cwd: outDir,
            encoding: 'utf8'
        });
        const report = JSON.parse(result.stdout);

        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(report.ok, true);
        assert.strictEqual(report.standalone, true);
        assert.strictEqual(report.checks.some(check => check.name === 'mirror-folder' && check.ok), true);
        assert.strictEqual(report.checks.some(check => check.name === 'entry-file' && check.ok), true);
        assert.strictEqual(report.checks.some(check => check.name === 'manifest' && check.ok), true);
    });

    it('fails the exported self-check when the entry file is missing', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });
        fs.rmSync(path.join(outDir, config.mirrorName, 'index.html'));

        const result = spawnSync(process.execPath, ['server.js', '--check'], {
            cwd: outDir,
            encoding: 'utf8'
        });
        const report = JSON.parse(result.stdout);

        assert.strictEqual(result.status, 1);
        assert.strictEqual(report.ok, false);
        assert.strictEqual(report.checks.some(check => check.name === 'entry-file' && !check.ok), true);
    });

    it('fails the exported self-check when the manifest is missing', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });
        fs.rmSync(path.join(outDir, config.mirrorName, '.mirror-manifest.json'));

        const result = spawnSync(process.execPath, ['server.js', '--check'], {
            cwd: outDir,
            encoding: 'utf8'
        });
        const report = JSON.parse(result.stdout);
        const manifestCheck = report.checks.find(check => check.name === 'manifest');

        assert.strictEqual(result.status, 1);
        assert.strictEqual(report.ok, false);
        assert.strictEqual(manifestCheck.ok, false);
        assert.strictEqual(manifestCheck.details.error, 'manifest file not found');
    });

    it('fails the exported self-check when a mirrored file changes', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });
        fs.writeFileSync(path.join(outDir, config.mirrorName, 'assets', 'app.js'), 'window.offline = false;');

        const result = spawnSync(process.execPath, ['server.js', '--check'], {
            cwd: outDir,
            encoding: 'utf8'
        });
        const report = JSON.parse(result.stdout);
        const manifestCheck = report.checks.find(check => check.name === 'manifest');

        assert.strictEqual(result.status, 1);
        assert.strictEqual(report.ok, false);
        assert.strictEqual(manifestCheck.ok, false);
        assert.deepStrictEqual(manifestCheck.details.changed.map(item => item.path), ['assets/app.js']);
    });

    it('serves exported files with the standalone server only', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        const serverPath = path.join(outDir, 'server.js');
        const previousLogFile = process.env.MIRRORKIT_LOG_FILE;
        delete process.env.MIRRORKIT_LOG_FILE;
        delete require.cache[serverPath];
        const standalone = require(serverPath);
        const port = await listen(standalone.server);

        try {
            const root = await fetch(`http://127.0.0.1:${port}/`);
            assert.strictEqual(root.status, 200);
            assert.match(await root.text(), /Standalone Offline Mirror/);

            const asset = await fetch(`http://127.0.0.1:${port}/example.test/assets/app.js`);
            assert.strictEqual(asset.status, 200);
            assert.strictEqual(await asset.text(), 'window.video = "\\/example.test\\/cdn.example.test\\/video.mp4";');

            const range = await fetch(`http://127.0.0.1:${port}/example.test/assets/clip.mp4`, {
                headers: { Range: 'bytes=4-8' }
            });
            assert.strictEqual(range.status, 206);
            assert.strictEqual(range.headers.get('content-range'), 'bytes 4-8/10');
            assert.strictEqual(Buffer.from(await range.arrayBuffer()).toString(), '45678');

            const mirrorIndex = await fetch(`http://127.0.0.1:${port}/example.test/`);
            const mirrorHtml = await mirrorIndex.text();
            assert.match(mirrorHtml, /\/example\.test\/cdn\.example\.test\/app\.js/);
            assert.match(mirrorHtml, /src="\/example\.test\/assets\/logo\.png"/);
            assert.match(mirrorHtml, /href="\/example\.test\/zh\/about"/);

            const missing = await fetch(`http://127.0.0.1:${port}/example.test/missing.js`);
            assert.strictEqual(missing.status, 404);

            const health = await fetch(`http://127.0.0.1:${port}/__health.json`);
            const json = await health.json();
            assert.strictEqual(json.ok, true);
            assert.strictEqual(json.standalone, true);
            assert.strictEqual(json.mirrorName, 'example.test');
            assert.match(json.logFile, /mirrorkit-standalone\.log$/);

            const logFile = path.join(outDir, 'logs', 'mirrorkit-standalone.log');
            assert.strictEqual(fs.existsSync(logFile), true);
            const logEvents = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
            assert.strictEqual(logEvents.some(event => event.message === 'Offline file not found'), true);
        } finally {
            await close(standalone.server);
            delete require.cache[serverPath];
            if (previousLogFile === undefined) delete process.env.MIRRORKIT_LOG_FILE;
            else process.env.MIRRORKIT_LOG_FILE = previousLogFile;
        }
    });

    it('prints actionable standalone server startup errors', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        const serverPath = path.join(outDir, 'server.js');
        delete require.cache[serverPath];
        const standalone = require(serverPath);

        try {
            assert.match(standalone.formatListenError({ code: 'EADDRINUSE', message: 'busy' }), /Port 3000 is already in use/);
            assert.match(standalone.formatListenError({ code: 'EADDRINUSE', message: 'busy' }), /node server\.js --port 3001/);
            assert.match(standalone.formatListenError({ code: 'EACCES', message: 'denied' }), /not allowed/);
            assert.match(standalone.formatListenError(new Error('boom')), /Failed to start standalone server: boom/);
            assert.strictEqual(standalone.shouldRetryListen({ code: 'EADDRINUSE' }, 3000, true), true);
            assert.strictEqual(standalone.shouldRetryListen({ code: 'EADDRINUSE' }, 3000, false), false);
            assert.strictEqual(standalone.shouldRetryListen({ code: 'EACCES' }, 3000, true), false);
        } finally {
            delete require.cache[serverPath];
        }
    });

    it('rotates standalone logs without MirrorKit helper files', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        const serverPath = path.join(outDir, 'server.js');
        const previousLogFile = process.env.MIRRORKIT_LOG_FILE;
        const previousMaxBytes = process.env.MIRRORKIT_LOG_MAX_BYTES;
        process.env.MIRRORKIT_LOG_FILE = 'logs/rotate.log';
        process.env.MIRRORKIT_LOG_MAX_BYTES = '220';
        delete require.cache[serverPath];
        const standalone = require(serverPath);

        try {
            standalone.logEvent('info', 'first'.repeat(20));
            standalone.logEvent('info', 'second'.repeat(20));

            const logFile = path.join(outDir, 'logs', 'rotate.log');
            assert.strictEqual(fs.existsSync(logFile), true);
            assert.strictEqual(fs.existsSync(`${logFile}.1`), true);
            assert.match(fs.readFileSync(logFile, 'utf8'), /second/);
            assert.match(fs.readFileSync(`${logFile}.1`, 'utf8'), /first/);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'lib')), false);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'tools')), false);
        } finally {
            delete require.cache[serverPath];
            if (previousLogFile === undefined) delete process.env.MIRRORKIT_LOG_FILE;
            else process.env.MIRRORKIT_LOG_FILE = previousLogFile;
            if (previousMaxBytes === undefined) delete process.env.MIRRORKIT_LOG_MAX_BYTES;
            else process.env.MIRRORKIT_LOG_MAX_BYTES = previousMaxBytes;
        }
    });

    it('refuses to overwrite an existing output folder unless force is set', async () => {
        const outDir = path.join(tmpDir, 'exports', 'example-offline');
        await exportStandaloneProject({ rootDir: tmpDir, config, outDir });

        await assert.rejects(
            () => exportStandaloneProject({ rootDir: tmpDir, config, outDir }),
            /output folder already exists/
        );

        await assert.doesNotReject(() => exportStandaloneProject({ rootDir: tmpDir, config, outDir, force: true }));
    });

    it('refuses unsafe standalone output directories', async () => {
        const mirrorDir = path.join(tmpDir, config.mirrorName);

        await assert.rejects(
            () => exportStandaloneProject({ rootDir: tmpDir, config, outDir: tmpDir, force: true }),
            /output folder cannot be the MirrorKit project root/
        );

        await assert.rejects(
            () => exportStandaloneProject({ rootDir: tmpDir, config, outDir: path.join(mirrorDir, 'offline'), force: true }),
            /output folder cannot be inside the source mirror folder/
        );
    });

    it('refuses to force-replace folders that were not standalone exports', async () => {
        const outDir = path.join(tmpDir, 'existing-work');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'keep.txt'), 'do not delete');

        await assert.rejects(
            () => exportStandaloneProject({ rootDir: tmpDir, config, outDir, force: true }),
            /refusing to replace a folder that was not created by MirrorKit standalone export/
        );

        assert.strictEqual(fs.existsSync(path.join(outDir, 'keep.txt')), true);
    });

    it('fails clearly when the mirror folder does not exist', async () => {
        await assert.rejects(
            () => exportStandaloneProject({
                rootDir: tmpDir,
                config: { ...config, mirrorName: 'missing.test' },
                outDir: path.join(tmpDir, 'exports', 'missing-offline')
            }),
            /mirror folder not found/
        );
    });
});
