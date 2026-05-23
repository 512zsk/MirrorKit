const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMirrorReport, validateCachedFile } = require('../lib/report');

describe('createMirrorReport', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-report-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns an empty non-existing report for missing folders', () => {
        const report = createMirrorReport(path.join(tmpDir, 'missing'));
        assert.strictEqual(report.exists, false);
        assert.strictEqual(report.files, 0);
    });

    it('summarizes files, extensions, progress files, invalid assets, and largest files', () => {
        fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html><html></html>');
        fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"ok":true}');
        fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{bad');
        fs.writeFileSync(path.join(tmpDir, 'image.png'), '<!doctype html><html><title>404</title></html>');
        fs.writeFileSync(path.join(tmpDir, '.mirror-progress.json'), '{"pass":1}');
        fs.writeFileSync(path.join(tmpDir, '.mirror-manifest.json'), JSON.stringify({
            schemaVersion: 1,
            generatedAt: '2026-01-01T00:00:00.000Z',
            tool: 'mirror-assets',
            completed: true,
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            stats: { save: 1 },
            scannedUniqueResources: 1,
            resourceCount: 1,
            pendingCount: 1,
            fileCount: 1,
            fileBytes: 28,
            resources: ['/index.html'],
            pending: ['/index.html'],
            files: [{ path: 'index.html', bytes: 28, sha256: 'hash' }]
        }));

        const report = createMirrorReport(tmpDir, { rootDir: tmpDir, largestLimit: 2 });
        assert.strictEqual(report.exists, true);
        assert.strictEqual(report.files, 6);
        assert.strictEqual(report.byExtension['.html'], 1);
        assert.strictEqual(report.byExtension['.json'], 4);
        assert.strictEqual(report.byExtension['.png'], 1);
        assert.strictEqual(report.manifestCount, 1);
        assert.strictEqual(report.manifests[0].tool, 'mirror-assets');
        assert.strictEqual(report.manifests[0].resourceCount, 1);
        assert.strictEqual(report.manifests[0].fileCount, 1);
        assert.strictEqual(report.manifests[0].fileBytes, 28);
        assert.strictEqual(report.progressCount, 1);
        assert.strictEqual(report.invalidCount, 2);
        assert.strictEqual(report.invalid.some(item => item.reason === 'invalid-json' && item.path === 'bad.json'), true);
        assert.strictEqual(report.invalid.some(item => item.reason === 'html-fallback' && item.path === 'image.png'), true);
        assert.strictEqual(report.largestFiles.length, 2);
    });
});

describe('validateCachedFile', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-report-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null for valid JSON and invalid-json for broken JSON', () => {
        const good = path.join(tmpDir, 'good.json');
        const bad = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(good, '{"ok":true}');
        fs.writeFileSync(bad, '{bad');

        assert.strictEqual(validateCachedFile(good, { rootDir: tmpDir }), null);
        assert.strictEqual(validateCachedFile(bad, { rootDir: tmpDir }), 'invalid-json');
    });
});
