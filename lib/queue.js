async function runQueue(items, concurrency, workerFn, onResult) {
    const queue = [...items];
    let index = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (index < queue.length) {
            const item = queue[index++];
            try {
                onResult(await workerFn(item));
            } catch (err) {
                onResult({ status: 'error', assetPath: item, message: err.message });
            }
        }
    });
    await Promise.all(workers);
}

module.exports = { runQueue };
