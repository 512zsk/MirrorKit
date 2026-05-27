const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CookieJar, parseCookies } = require('../lib/cookie-jar');

describe('parseCookies', () => {
    it('parses a simple Set-Cookie header', () => {
        const cookies = parseCookies('session=abc123', 'https://example.com/');
        assert.strictEqual(cookies.length, 1);
        assert.strictEqual(cookies[0].name, 'session');
        assert.strictEqual(cookies[0].value, 'abc123');
        assert.strictEqual(cookies[0].domain, 'example.com');
        assert.strictEqual(cookies[0].path, '/');
    });

    it('parses cookie with attributes', () => {
        const cookies = parseCookies(
            'id=1; Domain=.example.com; Path=/api; Secure; HttpOnly; SameSite=Lax',
            'https://example.com/'
        );
        assert.strictEqual(cookies.length, 1);
        assert.strictEqual(cookies[0].name, 'id');
        assert.strictEqual(cookies[0].value, '1');
        assert.strictEqual(cookies[0].domain, 'example.com');
        assert.strictEqual(cookies[0].path, '/api');
        assert.strictEqual(cookies[0].secure, true);
        assert.strictEqual(cookies[0].httpOnly, true);
        assert.strictEqual(cookies[0].sameSite, 'Lax');
    });

    it('parses Max-Age and converts to expires', () => {
        const before = Date.now();
        const cookies = parseCookies('token=xyz; Max-Age=3600', 'https://example.com/');
        const after = Date.now();
        assert.strictEqual(cookies[0].maxAge, 3600);
        const expires = new Date(cookies[0].expires).getTime();
        assert.ok(expires >= before + 3600000 - 1000);
        assert.ok(expires <= after + 3600000 + 1000);
    });

    it('expires cookie immediately when Max-Age=0', () => {
        const cookies = parseCookies('token=xyz; Max-Age=0', 'https://example.com/');
        assert.strictEqual(cookies[0].maxAge, 0);
        assert.ok(new Date(cookies[0].expires).getTime() < Date.now());
    });

    it('expires cookie immediately when Max-Age is negative', () => {
        const cookies = parseCookies('token=xyz; Max-Age=-1', 'https://example.com/');
        assert.strictEqual(cookies[0].maxAge, -1);
        assert.ok(new Date(cookies[0].expires).getTime() < Date.now());
    });

    it('returns empty array for empty header', () => {
        assert.deepStrictEqual(parseCookies('', 'https://example.com/'), []);
        assert.deepStrictEqual(parseCookies(null, 'https://example.com/'), []);
    });

    it('returns empty array for header without equals', () => {
        assert.deepStrictEqual(parseCookies('invalid', 'https://example.com/'), []);
    });

    it('handles cookie value with equals sign', () => {
        const cookies = parseCookies('data=a=b=c', 'https://example.com/');
        assert.strictEqual(cookies[0].value, 'a=b=c');
    });

    it('strips leading dot from domain', () => {
        const cookies = parseCookies('id=1; Domain=.example.com', 'https://example.com/');
        assert.strictEqual(cookies[0].domain, 'example.com');
    });
});

describe('CookieJar', () => {
    it('stores and retrieves cookies', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'session', value: 'abc', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        const result = jar.getCookiesForUrl('https://example.com/page');
        assert.strictEqual(result, 'session=abc');
    });

    it('returns empty string when no cookies match', () => {
        const jar = new CookieJar();
        assert.strictEqual(jar.getCookiesForUrl('https://other.com/'), '');
    });

    it('matches cookies by domain', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'a', value: '1', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), 'a=1');
        assert.strictEqual(jar.getCookiesForUrl('https://other.com/'), '');
    });

    it('matches cookies by path prefix', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'api', value: '1', domain: 'example.com',
            path: '/api', expires: null, secure: false, httpOnly: false
        });
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/api/data'), 'api=1');
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/other'), '');
    });

    it('filters secure cookies for http', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'sec', value: '1', domain: 'example.com',
            path: '/', expires: null, secure: true, httpOnly: false
        });
        assert.strictEqual(jar.getCookiesForUrl('http://example.com/'), '');
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), 'sec=1');
    });

    it('skips expired cookies', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'old', value: '1', domain: 'example.com',
            path: '/', expires: new Date(Date.now() - 1000).toISOString(),
            secure: false, httpOnly: false
        });
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), '');
    });

    it('skips cookies with Max-Age=0 (immediate expiry)', () => {
        const jar = new CookieJar();
        const cookies = parseCookies('del=1; Max-Age=0', 'https://example.com/');
        jar.addCookie(cookies[0]);
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), '');
    });

    it('overwrites cookies with the same key', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'id', value: 'first', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        jar.addCookie({
            name: 'id', value: 'second', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), 'id=second');
    });

    it('joins multiple cookies with semicolons', () => {
        const jar = new CookieJar();
        jar.addCookie({
            name: 'a', value: '1', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        jar.addCookie({
            name: 'b', value: '2', domain: 'example.com',
            path: '/', expires: null, secure: false, httpOnly: false
        });
        const result = jar.getCookiesForUrl('https://example.com/');
        assert.ok(result.includes('a=1'));
        assert.ok(result.includes('b=2'));
        assert.ok(result.includes('; '));
    });

    it('saves and loads from file', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'));
        const filePath = path.join(tmpDir, 'cookies.json');
        try {
            const jar = new CookieJar();
            jar.addCookie({
                name: 'test', value: 'val', domain: 'example.com',
                path: '/', expires: null, secure: false, httpOnly: false
            });
            jar.saveToFile(filePath);

            const jar2 = new CookieJar();
            jar2.loadFromFile(filePath);
            assert.strictEqual(jar2.getCookiesForUrl('https://example.com/'), 'test=val');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('loadFromFile handles missing file gracefully', () => {
        const jar = new CookieJar();
        jar.loadFromFile('/nonexistent/path/cookies.json');
        assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), '');
    });

    it('loadFromFile handles corrupt JSON gracefully', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'));
        const filePath = path.join(tmpDir, 'corrupt.json');
        try {
            fs.writeFileSync(filePath, 'not valid json{{{');
            const jar = new CookieJar();
            jar.loadFromFile(filePath);
            assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), '');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('loadFromFile skips entries without name or domain', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'));
        const filePath = path.join(tmpDir, 'partial.json');
        try {
            fs.writeFileSync(filePath, JSON.stringify([
                { name: 'valid', value: '1', domain: 'example.com', path: '/' },
                { value: '2', domain: 'example.com' },
                { name: 'nodomain' },
                null
            ]));
            const jar = new CookieJar();
            jar.loadFromFile(filePath);
            assert.strictEqual(jar.getCookiesForUrl('https://example.com/'), 'valid=1');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('saveToFile filters expired cookies', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-test-'));
        const filePath = path.join(tmpDir, 'cookies.json');
        try {
            const jar = new CookieJar();
            jar.addCookie({
                name: 'alive', value: '1', domain: 'example.com',
                path: '/', expires: new Date(Date.now() + 86400000).toISOString(),
                secure: false, httpOnly: false
            });
            jar.addCookie({
                name: 'dead', value: '2', domain: 'example.com',
                path: '/', expires: new Date(Date.now() - 1000).toISOString(),
                secure: false, httpOnly: false
            });
            jar.saveToFile(filePath);

            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            assert.strictEqual(data.length, 1);
            assert.strictEqual(data[0].name, 'alive');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
