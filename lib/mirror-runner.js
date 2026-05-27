const { runQueue } = require('./queue');

function defaultStats() {
    return { save: 0, skip: 0, fail: 0, reject: 0, error: 0 };
}

async function runMirrorWorkflow({
    collectInitialAssets,
    concurrency,
    discoverAssets,
    downloadAsset,
    dryRunLabel,
    logger,
    loadProgress,
    maxPasses,
    mirrorFolder,
    onPassStart,
    passLabel = pass => `Pass ${pass}`,
    saveProgress,
    clearProgress = () => {},
    shouldDryRun = false,
    shouldResume = false,
    shouldStop = () => false
}) {
    let pending;
    let seen;
    let stats;
    let startPass;

    const saved = shouldResume ? loadProgress() : null;
    if (saved) {
        pending = new Set(saved.pending);
        seen = new Set(saved.seen);
        stats = saved.stats || defaultStats();
        startPass = saved.pass + 1;
        logger.status(`Resuming from pass ${saved.pass} (${saved.savedAt})`, {
            pass: saved.pass,
            savedAt: saved.savedAt,
            seen: seen.size,
            pending: pending.size
        });
        logger.status(`Seen: ${seen.size}, Pending: ${pending.size}`);
    } else {
        pending = collectInitialAssets();
        seen = new Set();
        stats = defaultStats();
        startPass = 1;
    }

    if (shouldDryRun) {
        logger.dryRun({ label: dryRunLabel, resources: pending });
        return { dryRun: true, pending, seen, stats };
    }

    let lastCompletedPass = startPass - 1;
    for (let pass = startPass; pass <= maxPasses; pass++) {
        if (shouldStop()) {
            saveProgress(pass - 1, pending, seen, stats);
            logger.status('\nProgress saved. Run with --resume to continue.', { force: true });
            return { stopped: true, pass: pass - 1, pending, seen, stats };
        }

        if (onPassStart) await onPassStart(pass);

        const batch = [...pending].filter(item => !seen.has(item));
        if (!batch.length) break;
        batch.forEach(item => seen.add(item));
        for (const item of batch) pending.delete(item);

        logger.status(`\n${passLabel(pass)}: ${batch.length} resources`, { pass, resources: batch.length });
        await runQueue(batch, concurrency, downloadAsset, result => {
            stats[result.status] = (stats[result.status] || 0) + 1;
            logger.result(result);
        });

        for (const item of batch) {
            for (const assetPath of await discoverAssets(item)) {
                if (!seen.has(assetPath)) pending.add(assetPath);
            }
        }

        saveProgress(pass, pending, seen, stats);
        lastCompletedPass = pass;
    }

    const remaining = [...pending].filter(item => !seen.has(item));
    if (remaining.length) {
        logger.status(`\nReached max passes with ${remaining.length} resource(s) still pending. Increase maxPasses and run with --resume.`, {
            force: true,
            remaining: remaining.length
        });
        logger.summary({
            stats,
            mirrorFolder,
            scannedUniqueResources: seen.size
        });
        return { incomplete: true, pass: lastCompletedPass, pending, seen, stats, remaining };
    }

    clearProgress();
    logger.summary({
        stats,
        mirrorFolder,
        scannedUniqueResources: seen.size
    });

    return { completed: true, pending, seen, stats };
}

module.exports = { defaultStats, runMirrorWorkflow };
