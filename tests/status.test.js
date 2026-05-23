const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileInventory, createMirrorManifest, writeMirrorManifest } = require('../lib/manifest');
const { createStatusReport, createSuggestions } = require('../lib/status');

describe('createStatusReport', () => {
    let tmpDir;
    let config;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-status-'));
        fs.mkdirSync(path.join(tmpDir, 'tools'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html></html>');
        fs.writeFileSync(path.join(tmpDir, 'server.js'), 'console.log("server");');
        fs.writeFileSync(path.join(tmpDir, 'tools', 'mirror-assets.js'), 'console.log("mirror");');

        config = {
            configPath: path.join(tmpDir, 'mirror.config.json'),
            port: 65520,
            autoPort: true,
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            startPath: '/',
            cmsMediaHost: 'https://storage.example.test/bucket',
            remoteMirrors: [],
            remoteAssetPrefixes: [],
            ignoredPathPrefixes: [],
            sitePathPrefixes: []
        };

    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('combines environment, mirror, manifest, and log health', async () => {
        const mirrorDir = path.join(tmpDir, config.mirrorName);
        fs.mkdirSync(mirrorDir, { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'index.html'), '<!doctype html><html>offline</html>');
        writeMirrorManifest(path.join(mirrorDir, '.mirror-manifest.json'), createMirrorManifest({
            tool: 'test',
            targetHost: config.targetHost,
            mirrorName: config.mirrorName,
            startPath: config.startPath,
            files: createFileInventory(mirrorDir),
            generatedAt: '2026-01-01T00:00:00.000Z'
        }));

        const report = await createStatusReport(tmpDir, config);

        assert.strictEqual(report.ok, true);
        assert.strictEqual(report.failed, 0);
        assert.strictEqual(report.config.mirrorName, 'example.test');
        assert.strictEqual(report.checks.some(check => check.name === 'doctor' && check.status === 'pass'), true);
        assert.strictEqual(report.checks.some(check => check.name === 'invalid-assets' && check.status === 'pass'), true);
        assert.strictEqual(report.checks.some(check => check.name === 'manifest-verify' && check.status === 'pass'), true);
        assert.strictEqual(report.manifestVerifications.length, 1);
        assert.strictEqual(report.suggestions.length, 1);
        assert.strictEqual(report.suggestions[0].command.includes('export-standalone.js --check'), true);
    });

    it('fails status when cached assets are invalid', async () => {
        fs.mkdirSync(path.join(tmpDir, config.mirrorName), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, config.mirrorName, 'bad.json'), '{bad');

        const report = await createStatusReport(tmpDir, config);

        assert.strictEqual(report.ok, false);
        assert.strictEqual(report.checks.some(check => check.name === 'invalid-assets' && check.status === 'fail'), true);
        assert.strictEqual(report.suggestions.some(item => item.command.includes('validate-assets.js')), true);
        assert.strictEqual(report.suggestions.some(item => item.command.includes('--retry-bad')), true);
    });

    it('does not create a missing mirror folder while checking status', async () => {
        const mirrorDir = path.join(tmpDir, config.mirrorName);

        const report = await createStatusReport(tmpDir, config);

        assert.strictEqual(fs.existsSync(mirrorDir), false);
        assert.strictEqual(report.ok, true);
        assert.strictEqual(report.checks.some(check => check.name === 'mirror-folder' && check.status === 'warn'), true);
        assert.strictEqual(report.doctor.checks.some(check => check.name === 'mirror-write' && check.status === 'warn'), true);
        assert.strictEqual(report.suggestions.some(item => item.command.includes('--dry-run')), true);
    });

    it('suggests focused commands for failed checks and logs', () => {
        const suggestions = createSuggestions({
            config,
            checks: [
                { name: 'doctor', status: 'fail' },
                { name: 'mirror-folder', status: 'warn' }
            ],
            mirror: { exists: true, invalidCount: 0, manifestCount: 0 },
            logs: { parseErrorCount: 1, bySeverity: { error: 1, warn: 1 } },
            manifestVerifications: [{ ok: false }]
        });

        assert.strictEqual(suggestions.some(item => item.command.includes('doctor.js')), true);
        assert.strictEqual(suggestions.some(item => item.command.includes('mirror-assets.js')), true);
        assert.strictEqual(suggestions.some(item => item.command.includes('verify-manifest.js')), true);
        assert.strictEqual(suggestions.some(item => item.command.includes('logs.js')), true);
        assert.strictEqual(suggestions.some(item => item.command.includes('export-standalone.js')), false);
    });
});
