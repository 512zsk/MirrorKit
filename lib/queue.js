async function runQueue(items, concurrency, workerFn, onResult) {
    const queue = [...items];
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, 64) }, async () => {
        while (index < queue.length) {
            const item = queue[index++];
            try {
                const result = await workerFn(item);
                try { onResult(result); } catch { /* onResult callback error — do not crash worker */ }
            } catch (err) {
                try { onResult({ status: 'error', assetPath: item, message: err.message }); } catch { /* onResult callback error */ }
            }
        }
    });
    await Promise.all(workers);
}

module.exports = { runQueue };
