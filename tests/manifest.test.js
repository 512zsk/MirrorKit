const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    MANIFEST_SCHEMA_VERSION,
    createFileInventory,
    createMirrorManifest,
    summarizeMirrorManifest,
    verifyMirrorManifest,
    writeMirrorManifest
} = require('../lib/manifest');

describe('mirror manifest', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-manifest-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates stable manifest data for completed mirror runs', () => {
        const manifest = createMirrorManifest({
            tool: 'mirror-assets',
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            startPath: '/',
            stats: { save: 2, skip: 1 },
            resources: ['/b.css', '/a.js', '/a.js'],
            pending: ['/b.css', '/c.png'],
            files: [
                { path: 'b.css', bytes: 2, sha256: 'b' },
                { path: 'a.js', bytes: 1, sha256: 'a' }
            ],
            scannedUniqueResources: 2,
            generatedAt: '2026-01-01T00:00:00.000Z'
        });

        assert.strictEqual(manifest.schemaVersion, MANIFEST_SCHEMA_VERSION);
        assert.strictEqual(manifest.resourceCount, 2);
        assert.strictEqual(manifest.pendingCount, 2);
        assert.strictEqual(manifest.fileCount, 2);
        assert.strictEqual(manifest.fileBytes, 3);
        assert.deepStrictEqual(manifest.resources, ['/a.js', '/b.css']);
        assert.deepStrictEqual(manifest.pending, ['/b.css', '/c.png']);
        assert.deepStrictEqual(manifest.files.map(file => file.path), ['a.js', 'b.css']);
    });

    it('creates a hash inventory for mirror files', () => {
        fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'index.html'), '<!doctype html>');
        fs.writeFileSync(path.join(tmpDir, 'assets', 'app.js'), 'console.log("ok");');
        fs.writeFileSync(path.join(tmpDir, '.mirror-progress.json'), '{}');
        fs.writeFileSync(path.join(tmpDir, '.mirror-manifest.json.tmp'), '{}');

        const files = createFileInventory(tmpDir);

        assert.deepStrictEqual(files.map(file => file.path), ['assets/app.js', 'index.html']);
        assert.strictEqual(files[0].bytes, 18);
        assert.match(files[0].sha256, /^[a-f0-9]{64}$/);
    });

    it('writes manifests atomically and summarizes them for reports', () => {
        const filePath = path.join(tmpDir, '.mirror-manifest.json');
        const manifest = createMirrorManifest({
            tool: 'mirror-assets',
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            stats: { save: 1 },
            resources: ['/index.html'],
            pending: ['/index.html'],
            files: [{ path: 'index.html', bytes: 15, sha256: 'hash' }],
            scannedUniqueResources: 1,
            generatedAt: '2026-01-01T00:00:00.000Z'
        });

        writeMirrorManifest(filePath, manifest);
        const summary = summarizeMirrorManifest(filePath, { rootDir: tmpDir });

        assert.strictEqual(fs.existsSync(`${filePath}.tmp`), false);
        assert.strictEqual(summary.ok, true);
        assert.strictEqual(summary.path, '.mirror-manifest.json');
        assert.strictEqual(summary.tool, 'mirror-assets');
        assert.strictEqual(summary.resourceCount, 1);
        assert.strictEqual(summary.fileCount, 1);
        assert.strictEqual(summary.fileBytes, 15);
        assert.deepStrictEqual(summary.stats, { save: 1 });
    });

    it('summarizes invalid manifest files without throwing', () => {
        const filePath = path.join(tmpDir, '.mirror-manifest.json');
        fs.writeFileSync(filePath, '{bad');

        const summary = summarizeMirrorManifest(filePath, { rootDir: tmpDir });
        assert.strictEqual(summary.ok, false);
        assert.strictEqual(summary.path, '.mirror-manifest.json');
        assert.match(summary.error, /JSON/);
    });

    it('verifies files against a manifest snapshot', () => {
        fs.writeFileSync(path.join(tmpDir, 'keep.txt'), 'same');
        fs.writeFileSync(path.join(tmpDir, 'change.txt'), 'before');
        fs.writeFileSync(path.join(tmpDir, 'remove.txt'), 'present');

        const manifestPath = path.join(tmpDir, '.mirror-manifest.json');
        writeMirrorManifest(manifestPath, createMirrorManifest({
            tool: 'mirror-assets',
            targetHost: 'https://example.test',
            mirrorName: 'example.test',
            files: createFileInventory(tmpDir),
            generatedAt: '2026-01-01T00:00:00.000Z'
        }));

        fs.writeFileSync(path.join(tmpDir, 'change.txt'), 'after');
        fs.rmSync(path.join(tmpDir, 'remove.txt'));
        fs.writeFileSync(path.join(tmpDir, 'extra.txt'), 'new');

        const report = verifyMirrorManifest(manifestPath, { scanDir: tmpDir });
        assert.strictEqual(report.ok, false);
        assert.strictEqual(report.checked, 2);
        assert.deepStrictEqual(report.missing.map(item => item.path), ['remove.txt']);
        assert.deepStrictEqual(report.changed.map(item => item.path), ['change.txt']);
        assert.deepStrictEqual(report.extra.map(item => item.path), ['extra.txt']);
    });
});
