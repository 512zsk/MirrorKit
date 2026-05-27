const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isAssetUrl, normalizeAssetPath, extractAssetPathsFromText, extractAssetPathsFromJson } = require('../lib/extraction');

const ASSET_EXTS = ['css', 'js', 'png', 'jpg', 'json', 'html', 'svg', 'woff2'];

describe('isAssetUrl', () => {
    it('returns true for URL with known extension', () => {
        assert.strictEqual(isAssetUrl('https://cdn.example.com/style.css', ASSET_EXTS), true);
    });

    it('returns false for URL without asset extension', () => {
        assert.strictEqual(isAssetUrl('https://example.com/api/data', ASSET_EXTS), false);
    });

    it('returns false for invalid URL', () => {
        assert.strictEqual(isAssetUrl('not a url', ASSET_EXTS), false);
    });

    it('handles query strings in extension detection', () => {
        assert.strictEqual(isAssetUrl('https://cdn.example.com/bundle.js?v=123', ASSET_EXTS), true);
    });
});

describe('normalizeAssetPath', () => {
    it('returns null for empty input', () => {
        assert.strictEqual(normalizeAssetPath('', ASSET_EXTS), null);
    });

    it('normalizes protocol-relative URL', () => {
        assert.strictEqual(normalizeAssetPath('//cdn.example.com/lib.js', ASSET_EXTS), 'https://cdn.example.com/lib.js');
    });

    it('normalizes absolute URL', () => {
        assert.strictEqual(normalizeAssetPath('https://cdn.example.com/style.css', ASSET_EXTS), 'https://cdn.example.com/style.css');
    });

    it('normalizes root-relative path', () => {
        assert.strictEqual(normalizeAssetPath('/assets/js/app.js', ASSET_EXTS), 'assets/js/app.js');
    });

    it('strips query strings', () => {
        assert.strictEqual(normalizeAssetPath('style.css?v=1.0', ASSET_EXTS), 'style.css');
    });

    it('strips hash fragments', () => {
        assert.strictEqual(normalizeAssetPath('image.png#fragment', ASSET_EXTS), 'image.png');
    });

    it('rejects template literals', () => {
        assert.strictEqual(normalizeAssetPath('/js/${name}.js', ASSET_EXTS), null);
    });

    it('rejects paths with newlines', () => {
        assert.strictEqual(normalizeAssetPath('/js/app.js\nbad', ASSET_EXTS), null);
    });

    it('rejects non-asset extensions', () => {
        assert.strictEqual(normalizeAssetPath('/video.mp4', ASSET_EXTS), null);
    });

    it('rejects paths with backtick template markers', () => {
        assert.strictEqual(normalizeAssetPath('/js/`template`.js', ASSET_EXTS), null);
    });

    it('rejects null input', () => {
        assert.strictEqual(normalizeAssetPath(null, ASSET_EXTS), null);
    });

    it('strips surrounding quotes', () => {
        assert.strictEqual(normalizeAssetPath('"style.css"', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('"css/style.css"', ASSET_EXTS), 'css/style.css');
    });

    it('unescapes forward slashes', () => {
        assert.strictEqual(normalizeAssetPath('assets\\/js\\/app.js', ASSET_EXTS), 'assets/js/app.js');
    });

    it('rejects bare filenames without directory paths', () => {
        assert.strictEqual(normalizeAssetPath('browser.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('config.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('cookie.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('app.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('target-vec.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('css/style.css', ASSET_EXTS), 'css/style.css');
        assert.strictEqual(normalizeAssetPath('/js/app.js', ASSET_EXTS), 'js/app.js');
    });

    it('rejects error message strings with asset extensions', () => {
        assert.strictEqual(normalizeAssetPath('Unable to load target-vec.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('Loading target-vec.js', ASSET_EXTS), null);
        assert.strictEqual(normalizeAssetPath('Failed to fetch app.js', ASSET_EXTS), null);
    });
});

describe('extractAssetPathsFromText', () => {
    it('extracts src attribute from HTML', () => {
        const html = '<script src="/js/app.js"></script><link href="/css/style.css">';
        const result = extractAssetPathsFromText(html, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('js/app.js'), true);
        assert.strictEqual(result.has('css/style.css'), true);
    });

    it('extracts url() references from CSS', () => {
        const css = 'body { background: url(/img/bg.png); } @font-face { src: url(/fonts/roboto.woff2); }';
        const result = extractAssetPathsFromText(css, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('img/bg.png'), true);
        assert.strictEqual(result.has('fonts/roboto.woff2'), true);
    });

    it('extracts full URLs', () => {
        const text = '<img src="https://cdn.example.com/img/logo.png">';
        const result = extractAssetPathsFromText(text, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('https://cdn.example.com/img/logo.png'), true);
    });

    it('filters error message strings and bare filenames', () => {
        const text = 'Unable to load target-vec.js and browser.js but /assets/app.js is fine';
        const result = extractAssetPathsFromText(text, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('assets/app.js'), true);
        assert.strictEqual([...result].every(r => r !== 'target-vec.js'), true);
        assert.strictEqual([...result].every(r => r !== 'browser.js'), true);
    });

    it('loose prefix scan captures cdn URLs', () => {
        const text = 'var url = https://storage.googleapis.com/bucket/image.jpg with spaces';
        const result = extractAssetPathsFromText(text, {
            assetExts: ASSET_EXTS,
            loosePrefixes: ['https://storage.googleapis.com/']
        });
        assert.strictEqual(result.has('https://storage.googleapis.com/bucket/image.jpg'), true);
    });

    it('returns empty set for text without assets', () => {
        const result = extractAssetPathsFromText('hello world', { assetExts: ASSET_EXTS });
        assert.strictEqual(result.size, 0);
    });
});

describe('extractAssetPathsFromJson', () => {
    it('extracts asset strings from nested objects', () => {
        const json = { icons: { logo: '/img/logo.png', banner: 'https://cdn.example.com/banner.jpg' } };
        const result = extractAssetPathsFromJson(json, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('img/logo.png'), true);
        assert.strictEqual(result.has('https://cdn.example.com/banner.jpg'), true);
    });

    it('extracts from arrays', () => {
        const json = { files: ['/css/main.css', '/js/app.js', '/video.mp4'] };
        const result = extractAssetPathsFromJson(json, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('css/main.css'), true);
        assert.strictEqual(result.has('js/app.js'), true);
        assert.strictEqual(result.has('video.mp4'), false);
    });

    it('handles non-string scalars', () => {
        const json = { count: 42, enabled: true, data: null };
        const result = extractAssetPathsFromJson(json, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.size, 0);
    });

    it('extracts embedded URLs from string values', () => {
        const json = { html: '<img src="/img/photo.jpg">' };
        const result = extractAssetPathsFromJson(json, { assetExts: ASSET_EXTS });
        assert.strictEqual(result.has('img/photo.jpg'), true);
    });
});
