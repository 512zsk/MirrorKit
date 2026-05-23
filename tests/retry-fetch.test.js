const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchWithRetries, shouldRetryStatus } = require('../lib/retry-fetch');

function response(status) {
    return { ok: status >= 200 && status < 300, status };
}

describe('shouldRetryStatus', () => {
    it('retries rate limits and server errors', () => {
        assert.strictEqual(shouldRetryStatus(429), true);
        assert.strictEqual(shouldRetryStatus(500), true);
        assert.strictEqual(shouldRetryStatus(503), true);
    });

    it('does not retry success or ordinary client errors', () => {
        assert.strictEqual(shouldRetryStatus(200), false);
        assert.strictEqual(shouldRetryStatus(404), false);
    });
});

describe('fetchWithRetries', () => {
    it('retries retryable status codes until success', async () => {
        const statuses = [503, 502, 200];
        const calls = [];

        const result = await fetchWithRetries('https://example.test/a.js', {
            retries: 3,
            baseDelayMs: 1,
            waitFn: async ms => calls.push(ms),
            fetchFn: async () => response(statuses.shift())
        });

        assert.strictEqual(result.status, 200);
        assert.deepStrictEqual(calls, [1, 2]);
    });

    it('does not retry non-retryable status codes', async () => {
        let attempts = 0;

        const result = await fetchWithRetries('https://example.test/missing.png', {
            retries: 3,
            waitFn: async () => {},
            fetchFn: async () => {
                attempts++;
                return response(404);
            }
        });

        assert.strictEqual(result.status, 404);
        assert.strictEqual(attempts, 1);
    });

    it('retries thrown errors and rethrows the last one', async () => {
        let attempts = 0;

        await assert.rejects(
            fetchWithRetries('https://example.test/slow', {
                retries: 2,
                waitFn: async () => {},
                fetchFn: async () => {
                    attempts++;
                    throw new Error(`boom-${attempts}`);
                }
            }),
            /boom-3/
        );

        assert.strictEqual(attempts, 3);
    });
});
