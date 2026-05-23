const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
    isAbsoluteHttpUrl,
    localPathForAsset,
    remoteUrlForAsset,
    targetHostName
} = require('../lib/asset-paths');

const ROOT = path.join('C:', 'repo');
const MIRROR = 'example.test';
const TARGET = 'https://www.example.test';

describe('asset path planning', () => {
    it('maps target-host absolute URLs into the mirror root', () => {
        const localPath = localPathForAsset('https://www.example.test/assets/app.js?v=1', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: true
        });

        assert.strictEqual(localPath, path.join(ROOT, MIRROR, 'assets', 'app.js'));
    });

    it('maps external absolute URLs under a host folder', () => {
        const localPath = localPathForAsset('https://cdn.example.test/video/intro.mp4', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: true
        });

        assert.strictEqual(localPath, path.join(ROOT, MIRROR, 'cdn.example.test', 'video', 'intro.mp4'));
    });

    it('maps extensionless routes to index.html when requested', () => {
        const localPath = localPathForAsset('/about', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: true
        });

        assert.strictEqual(localPath, path.join(ROOT, MIRROR, 'about', 'index.html'));
    });

    it('keeps extensionless paths unchanged when routeToIndex is false', () => {
        const localPath = localPathForAsset('/api/latest', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: false
        });

        assert.strictEqual(localPath, path.join(ROOT, MIRROR, 'api', 'latest'));
    });

    it('rejects malformed encodings and traversal', () => {
        assert.strictEqual(localPathForAsset('/bad/%E0%A4%A', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: true
        }), null);

        assert.strictEqual(localPathForAsset('/../secret.txt', {
            rootDir: ROOT,
            mirrorName: MIRROR,
            targetHost: TARGET,
            routeToIndex: true
        }), null);
    });
});

describe('remote asset URL planning', () => {
    it('keeps absolute URLs unchanged', () => {
        assert.strictEqual(remoteUrlForAsset('https://cdn.example.test/a.js', TARGET), 'https://cdn.example.test/a.js');
    });

    it('resolves relative paths against the target host', () => {
        assert.strictEqual(remoteUrlForAsset('/assets/a.js', TARGET), 'https://www.example.test/assets/a.js');
    });
});

describe('asset URL helpers', () => {
    it('detects absolute HTTP URLs', () => {
        assert.strictEqual(isAbsoluteHttpUrl('https://example.test/a.js'), true);
        assert.strictEqual(isAbsoluteHttpUrl('/a.js'), false);
    });

    it('extracts target host names', () => {
        assert.strictEqual(targetHostName(TARGET), 'www.example.test');
    });
});
