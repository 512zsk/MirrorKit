const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
    configCheck,
    mirrorWriteCheck,
    nodeVersionCheck,
    portAvailable,
    requiredFilesCheck,
    runDoctor
} = require('../lib/doctor');
const { loadMirrorConfig } = require('../lib/config');

describe('doctor checks', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-doctor-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('checks Node.js version', () => {
        assert.strictEqual(nodeVersionCheck('18.0.0').status, 'pass');
        assert.strictEqual(nodeVersionCheck('16.20.0').status, 'fail');
        assert.strictEqual(nodeVersionCheck('v18.0.0').status, 'pass');
        assert.strictEqual(nodeVersionCheck('v20.11.0').status, 'pass');
        assert.strictEqual(nodeVersionCheck('v16.20.0').status, 'fail');
    });

    it('checks required files', () => {
        fs.writeFileSync(path.join(tmpDir, 'index.html'), '');
        assert.strictEqual(requiredFilesCheck(tmpDir, ['index.html']).status, 'pass');
        assert.strictEqual(requiredFilesCheck(tmpDir, ['missing.js']).status, 'fail');
    });

    it('reports config validation failures', () => {
        const config = loadMirrorConfig(tmpDir, { TARGET_HOST: 'bad-url' });
        const check = configCheck(config);
        assert.strictEqual(check.status, 'fail');
        assert.strictEqual(check.details.problems.some(problem => problem.includes('targetHost')), true);
    });

    it('can check mirror write access without creating the mirror folder', () => {
        const config = loadMirrorConfig(tmpDir, {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-doctor-readonly'
        });
        const mirrorDir = path.join(tmpDir, '.tmp-doctor-readonly');

        const check = mirrorWriteCheck(tmpDir, config, { create: false });

        assert.strictEqual(check.status, 'warn');
        assert.strictEqual(fs.existsSync(mirrorDir), false);
    });

    it('checks whether a port is available', async () => {
        const server = net.createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            assert.strictEqual(await portAvailable(port), false);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('warns instead of failing when a port is occupied and auto-port is enabled', async () => {
        const server = net.createServer();
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            for (const file of ['index.html', 'server.js']) {
                fs.writeFileSync(path.join(tmpDir, file), '');
            }
            fs.mkdirSync(path.join(tmpDir, 'tools'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'tools', 'mirror-assets.js'), '');

            const config = loadMirrorConfig(tmpDir, {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: '.tmp-doctor',
                PORT: String(port),
                MIRRORKIT_AUTO_PORT: '1'
            });

            const report = await runDoctor(tmpDir, config, { nodeVersion: '18.0.0' });
            const portReport = report.checks.find(check => check.name === 'port');

            assert.strictEqual(report.ok, true);
            assert.strictEqual(report.warned, 1);
            assert.strictEqual(portReport.status, 'warn');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('runs the full doctor report', async () => {
        for (const file of ['index.html', 'server.js']) {
            fs.writeFileSync(path.join(tmpDir, file), '');
        }
        fs.mkdirSync(path.join(tmpDir, 'tools'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'tools', 'mirror-assets.js'), '');

        const config = loadMirrorConfig(tmpDir, {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-doctor',
            PORT: '65530'
        });

        const report = await runDoctor(tmpDir, config, { nodeVersion: '18.0.0' });
        assert.strictEqual(report.ok, true);
        assert.strictEqual(report.failed, 0);
        assert.strictEqual(report.checks.length, 5);
        assert.strictEqual(fs.existsSync(path.join(tmpDir, '.tmp-doctor')), true);
    });
});
