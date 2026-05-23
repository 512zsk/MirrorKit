const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { safeDecodeURIComponent, safeJoin, isInsidePath, mirrorRoot } = require('../lib/paths');

describe('safeDecodeURIComponent', () => {
    it('decodes valid URI components', () => {
        assert.strictEqual(safeDecodeURIComponent('/a%20b/index.html'), '/a b/index.html');
    });

    it('returns null for malformed URI components', () => {
        assert.strictEqual(safeDecodeURIComponent('/bad/%E0%A4%A'), null);
    });
});

describe('safeJoin', () => {
    const root = path.join('C:', 'repo');

    it('joins normal relative paths', () => {
        assert.strictEqual(safeJoin(root, '/example.com/assets/app.js'), path.join(root, 'example.com', 'assets', 'app.js'));
    });

    it('rejects parent traversal', () => {
        assert.strictEqual(safeJoin(root, '../secret.txt'), null);
        assert.strictEqual(safeJoin(root, 'example.com/../secret.txt'), null);
    });

    it('rejects null bytes', () => {
        assert.strictEqual(safeJoin(root, 'file\0.txt'), null);
    });

    it('keeps resolved paths inside the root', () => {
        const localPath = safeJoin(root, 'example.com/index.html');
        assert.strictEqual(isInsidePath(root, localPath), true);
    });
});

describe('mirrorRoot', () => {
    it('returns the mirror directory path', () => {
        assert.strictEqual(mirrorRoot('/repo', 'example.com'), path.join('/repo', 'example.com'));
    });
});
