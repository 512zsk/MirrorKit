const { describe, it } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { fetchWithTimeout } = require('../lib/fetch');
const { fetchWithRetries, shouldRetryStatus } = require('../lib/retry-fetch');

function createTestServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            resolve({ server, port, url: `http://127.0.0.1:${port}/` });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

describe('fetchWithTimeout', () => {
    it('fetches a successful response', async () => {
        const { server, url } = await createTestServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
        });
        try {
            const response = await fetchWithTimeout(url, { timeoutMs: 5000 });
            assert.strictEqual(response.status, 200);
            const text = await response.text();
            assert.strictEqual(text, 'ok');
        } finally {
            await closeServer(server);
        }
    });

    it('sets User-Agent header', async () => {
        let receivedUA;
        const { server, url } = await createTestServer((req, res) => {
            receivedUA = req.headers['user-agent'];
            res.writeHead(200);
            res.end();
        });
        try {
            await fetchWithTimeout(url, { timeoutMs: 5000 });
            assert.ok(receivedUA.includes('Mozilla'));
        } finally {
            await closeServer(server);
        }
    });

    it('sets custom cookie header', async () => {
        let receivedCookie;
        const { server, url } = await createTestServer((req, res) => {
            receivedCookie = req.headers['cookie'];
            res.writeHead(200);
            res.end();
        });
        try {
            await fetchWithTimeout(url, { timeoutMs: 5000, cookie: 'session=abc' });
            assert.strictEqual(receivedCookie, 'session=abc');
        } finally {
            await closeServer(server);
        }
    });

    it('aborts on timeout', async () => {
        const { server, url } = await createTestServer((req, res) => {
            // Never respond
        });
        try {
            await assert.rejects(
                fetchWithTimeout(url, { timeoutMs: 100 }),
                (err) => err.name === 'AbortError' || err.cause?.name === 'AbortError'
            );
        } finally {
            await closeServer(server);
        }
    });
});

describe('shouldRetryStatus', () => {
    it('retries 429 and 5xx', () => {
        assert.strictEqual(shouldRetryStatus(429), true);
        assert.strictEqual(shouldRetryStatus(500), true);
        assert.strictEqual(shouldRetryStatus(502), true);
        assert.strictEqual(shouldRetryStatus(503), true);
        assert.strictEqual(shouldRetryStatus(504), true);
    });

    it('does not retry 2xx or 4xx', () => {
        assert.strictEqual(shouldRetryStatus(200), false);
        assert.strictEqual(shouldRetryStatus(301), false);
        assert.strictEqual(shouldRetryStatus(400), false);
        assert.strictEqual(shouldRetryStatus(403), false);
        assert.strictEqual(shouldRetryStatus(404), false);
    });
});

describe('fetchWithRetries', () => {
    it('returns successful response on first try', async () => {
        let attempts = 0;
        const { server, url } = await createTestServer((req, res) => {
            attempts++;
            res.writeHead(200);
            res.end('ok');
        });
        try {
            const response = await fetchWithRetries(url, { timeoutMs: 5000, retries: 2 });
            assert.strictEqual(response.status, 200);
            assert.strictEqual(attempts, 1);
        } finally {
            await closeServer(server);
        }
    });

    it('retries on 500 status', async () => {
        let attempts = 0;
        const { server, url } = await createTestServer((req, res) => {
            attempts++;
            if (attempts < 3) {
                res.writeHead(500);
                res.end('error');
            } else {
                res.writeHead(200);
                res.end('ok');
            }
        });
        try {
            const response = await fetchWithRetries(url, { timeoutMs: 5000, retries: 3, baseDelayMs: 10 });
            assert.strictEqual(response.status, 200);
            assert.strictEqual(attempts, 3);
        } finally {
            await closeServer(server);
        }
    });

    it('throws after all retries exhausted', async () => {
        let attempts = 0;
        const { server, url } = await createTestServer((req, res) => {
            attempts++;
            res.writeHead(500);
            res.end('error');
        });
        try {
            const response = await fetchWithRetries(url, { timeoutMs: 5000, retries: 2, baseDelayMs: 10 });
            assert.strictEqual(response.status, 500);
            assert.strictEqual(attempts, 3);
        } finally {
            await closeServer(server);
        }
    });

    it('does not retry 404 status', async () => {
        let attempts = 0;
        const { server, url } = await createTestServer((req, res) => {
            attempts++;
            res.writeHead(404);
            res.end('not found');
        });
        try {
            const response = await fetchWithRetries(url, { timeoutMs: 5000, retries: 3, baseDelayMs: 10 });
            assert.strictEqual(response.status, 404);
            assert.strictEqual(attempts, 1);
        } finally {
            await closeServer(server);
        }
    });

    it('retries with 0 retries still makes one attempt', async () => {
        let attempts = 0;
        const { server, url } = await createTestServer((req, res) => {
            attempts++;
            res.writeHead(200);
            res.end('ok');
        });
        try {
            const response = await fetchWithRetries(url, { timeoutMs: 5000, retries: 0 });
            assert.strictEqual(response.status, 200);
            assert.strictEqual(attempts, 1);
        } finally {
            await closeServer(server);
        }
    });
});
