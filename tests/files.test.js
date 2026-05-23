const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { walk, readTextIfExists, ensureDirExists } = require('../lib/files');

describe('walk', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-test-'));
        fs.mkdirSync(path.join(tmpDir, 'sub'));
        fs.mkdirSync(path.join(tmpDir, 'node_modules'));
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
        fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
        fs.writeFileSync(path.join(tmpDir, 'sub', 'c.txt'), 'c');
        fs.writeFileSync(path.join(tmpDir, 'node_modules', 'd.txt'), 'd');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns all files in directory', () => {
        const files = walk(path.join(tmpDir));
        const names = files.map(f => path.basename(f));
        assert.strictEqual(names.includes('a.txt'), true);
        assert.strictEqual(names.includes('b.txt'), true);
        assert.strictEqual(names.includes('c.txt'), true);
    });

    it('skips node_modules by default', () => {
        const files = walk(path.join(tmpDir));
        const names = files.map(f => path.basename(f));
        assert.strictEqual(names.includes('d.txt'), false);
    });

    it('returns empty array for non-existent dir', () => {
        assert.deepStrictEqual(walk('/nonexistent/path'), []);
    });

    it('walks nested directories', () => {
        const files = walk(path.join(tmpDir));
        const relativePaths = files.map(f => path.relative(tmpDir, f));
        assert.strictEqual(relativePaths.includes(path.join('sub', 'c.txt')), true);
    });
});

describe('readTextIfExists', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads existing file', () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'hello world');
        assert.strictEqual(readTextIfExists(filePath), 'hello world');
    });

    it('returns empty string for non-existent file', () => {
        assert.strictEqual(readTextIfExists(path.join(tmpDir, 'missing.txt')), '');
    });
});

describe('ensureDirExists', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates nested directories', () => {
        const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'file.txt');
        ensureDirExists(deepPath);
        assert.strictEqual(fs.existsSync(path.dirname(deepPath)), true);
    });

    it('no error for existing directory', () => {
        const filePath = path.join(tmpDir, 'file.txt');
        fs.mkdirSync(tmpDir, { recursive: true });
        ensureDirExists(filePath);
        assert.strictEqual(fs.existsSync(tmpDir), true);
    });
});
