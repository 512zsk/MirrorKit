const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runQueue } = require('../lib/queue');

describe('runQueue', () => {
    it('processes all items', async () => {
        const results = [];
        await runQueue([1, 2, 3], 2, async (item) => {
            return { value: item * 2 };
        }, (result) => results.push(result));
        assert.deepStrictEqual(results.sort((a, b) => a.value - b.value), [
            { value: 2 }, { value: 4 }, { value: 6 }
        ]);
    });

    it('handles empty items array', async () => {
        const results = [];
        await runQueue([], 2, async () => { throw new Error('should not run'); }, (r) => results.push(r));
        assert.strictEqual(results.length, 0);
    });

    it('handles concurrency of 1 (sequential)', async () => {
        const order = [];
        await runQueue([1, 2, 3], 1, async (item) => {
            order.push(`start-${item}`);
            return { done: item };
        }, (result) => order.push(`end-${result.done}`));
        // With concurrency 1, items are processed strictly sequentially
        assert.deepStrictEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
    });

    it('handles worker errors gracefully', async () => {
        const results = [];
        await runQueue(['ok', 'fail', 'ok2'], 2, async (item) => {
            if (item === 'fail') throw new Error('test error');
            return { status: 'ok', item };
        }, (result) => results.push(result));

        const statuses = results.map(r => r.status).sort();
        assert.deepStrictEqual(statuses, ['error', 'ok', 'ok']);
        const errorResult = results.find(r => r.status === 'error');
        assert.strictEqual(errorResult.message, 'test error');
        assert.strictEqual(errorResult.assetPath, 'fail');
    });

    it('respects concurrency limit', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        await runQueue([1, 2, 3, 4, 5], 2, async (item) => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise(r => setTimeout(r, 10));
            concurrent--;
            return { item };
        }, () => {});
        assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
    });

    it('handles single item', async () => {
        const results = [];
        await runQueue(['only'], 3, async (item) => ({ item }), (r) => results.push(r));
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].item, 'only');
    });

    it('handles concurrency higher than items', async () => {
        const results = [];
        await runQueue([1, 2], 10, async (item) => ({ item }), (r) => results.push(r));
        assert.strictEqual(results.length, 2);
    });
});
