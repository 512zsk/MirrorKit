const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

describe('tools/validate-assets.js', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(ROOT, '.tmp-validate-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function runValidate() {
        return spawnSync(process.execPath, [
            'tools/validate-assets.js',
            path.relative(ROOT, tmpDir)
        ], {
            cwd: ROOT,
            encoding: 'utf8'
        });
    }

    it('passes for valid cached assets in a selected directory', () => {
        fs.writeFileSync(path.join(tmpDir, 'data.json'), '{"ok":true}');

        const result = runValidate();
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /No invalid cached assets found/);
    });

    it('reports HTML fallback saved as a binary asset', () => {
        fs.writeFileSync(path.join(tmpDir, 'image.png'), '<!doctype html><html><title>404</title></html>');

        const result = runValidate();
        assert.strictEqual(result.status, 2);
        assert.match(result.stdout, /html-fallback/);
        assert.match(result.stdout, /image\.png/);
    });
});
