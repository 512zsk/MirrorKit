const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isHtmlLike, hasMagic, hasExpectedMagic, isValidDownload } = require('../lib/validation');

describe('isHtmlLike', () => {
    it('detects doctype html', () => {
        assert.strictEqual(isHtmlLike(Buffer.from('<!doctype html><html>')), true);
    });

    it('detects html tag', () => {
        assert.strictEqual(isHtmlLike(Buffer.from('<html lang="en">')), true);
    });

    it('detects title tag inside body', () => {
        assert.strictEqual(isHtmlLike(Buffer.from('<body><title>Page</title></body>')), true);
    });

    it('rejects plain text', () => {
        assert.strictEqual(isHtmlLike(Buffer.from('hello world')), false);
    });

    it('rejects binary data', () => {
        const buf = Buffer.alloc(256, 0x89);
        assert.strictEqual(isHtmlLike(buf), false);
    });

    it('rejects empty buffer', () => {
        assert.strictEqual(isHtmlLike(Buffer.alloc(0)), false);
    });

    it('handles leading whitespace before doctype', () => {
        assert.strictEqual(isHtmlLike(Buffer.from('\n  <!doctype html>')), true);
    });
});

describe('hasMagic', () => {
    const pngMagic = [0x89, 0x50, 0x4e, 0x47];

    it('matches correct magic bytes', () => {
        assert.strictEqual(hasMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), pngMagic), true);
    });

    it('rejects wrong magic bytes', () => {
        assert.strictEqual(hasMagic(Buffer.from([0x00, 0x00, 0x00, 0x00]), pngMagic), false);
    });

    it('rejects buffer shorter than magic', () => {
        assert.strictEqual(hasMagic(Buffer.from([0x89]), pngMagic), false);
    });

    it('rejects empty buffer', () => {
        assert.strictEqual(hasMagic(Buffer.alloc(0), pngMagic), false);
    });
});

describe('hasExpectedMagic', () => {
    it('returns true for unknown extension', () => {
        assert.strictEqual(hasExpectedMagic('/test.bin', Buffer.from('data')), true);
    });

    it('validates png magic correctly', () => {
        assert.strictEqual(hasExpectedMagic('/test.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])), true);
    });

    it('rejects bad png magic', () => {
        assert.strictEqual(hasExpectedMagic('/test.png', Buffer.from([0x00, 0x00, 0x00, 0x00])), false);
    });
});

describe('isValidDownload', () => {
    function fakeResponse(contentType) {
        return { headers: { get: () => contentType || '' } };
    }

    it('rejects HTML content saved as image', () => {
        const buf = Buffer.from('<!doctype html><html><title>404</title></html>');
        assert.strictEqual(isValidDownload('/test.png', fakeResponse(), buf), false);
    });

    it('accepts real HTML saved as .html', () => {
        const buf = Buffer.from('<!doctype html><html><head></head><body></body></html>');
        assert.strictEqual(isValidDownload('/page.html', fakeResponse(), buf), true);
    });

    it('accepts valid JSON', () => {
        assert.strictEqual(isValidDownload('/data.json', fakeResponse('application/json'), Buffer.from('{"a":1}')), true);
    });

    it('rejects invalid JSON', () => {
        assert.strictEqual(isValidDownload('/data.json', fakeResponse('application/json'), Buffer.from('not json')), false);
    });

    it('rejects JS with HTML content-type', () => {
        assert.strictEqual(isValidDownload('/app.js', fakeResponse('text/html'), Buffer.from('var x = 1;')), false);
    });

    it('accepts JS with JavaScript content-type', () => {
        assert.strictEqual(isValidDownload('/app.js', fakeResponse('application/javascript'), Buffer.from('var x = 1;')), true);
    });

    it('accepts image extension with image content-type (content-type bypass)', () => {
        assert.strictEqual(isValidDownload('/img.png', fakeResponse('image/jpeg'), Buffer.alloc(10)), true);
    });

    it('validates magic for known binary extensions', () => {
        assert.strictEqual(isValidDownload('/img.png', fakeResponse(), Buffer.from([0x89, 0x50, 0x4e, 0x47])), true);
    });

    it('rejects bad magic for known binary extensions', () => {
        assert.strictEqual(isValidDownload('/font.woff2', fakeResponse(), Buffer.from([0x00, 0x00, 0x00, 0x00])), false);
    });

    it('default: accepts unknown extension with non-HTML content', () => {
        assert.strictEqual(isValidDownload('/file.bin', fakeResponse('application/octet-stream'), Buffer.alloc(10)), true);
    });

    it('strictTextHtmlFallback: rejects unknown extension with text/html', () => {
        assert.strictEqual(isValidDownload('/file.bin', fakeResponse('text/html'), Buffer.alloc(10), { strictTextHtmlFallback: true }), false);
    });

    it('strictTextHtmlFallback: accepts unknown extension with non-HTML content', () => {
        assert.strictEqual(isValidDownload('/file.bin', fakeResponse('application/octet-stream'), Buffer.alloc(10), { strictTextHtmlFallback: true }), true);
    });

    it('route-like paths (no extension) with HTML content are accepted', () => {
        const buf = Buffer.from('<!doctype html><html><title>Home</title></html>');
        assert.strictEqual(isValidDownload('/about', fakeResponse(), buf), true);
    });
});
