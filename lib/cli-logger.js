function createCliLogger({
    quiet = false,
    json = false,
    stdout = message => console.log(message),
    stderr = message => console.error(message),
    fileLogger = null
} = {}) {
    function writeFile(type, payload = {}) {
        if (!fileLogger || typeof fileLogger.write !== 'function') return;
        fileLogger.write({ type, ...payload });
    }

    function writeJson(type, payload = {}) {
        const event = { type, ...payload };
        writeFile(type, payload);
        stdout(JSON.stringify(event));
    }

    function log(message, { force = false, file = true } = {}) {
        if (file) writeFile('log', { message: String(message) });
        if (json) return;
        if (quiet && !force) return;
        stdout(message);
    }

    function error(message) {
        if (json) {
            writeJson('error', { message: String(message) });
            return;
        }
        writeFile('error', { message: String(message) });
        stderr(message);
    }

    function status(message, payload = {}) {
        const { force = false, ...data } = payload;
        if (json) {
            writeJson('status', { message, ...data });
            return;
        }
        writeFile('status', { message, ...data });
        log(message, { force, file: false });
    }

    function result(result) {
        if (json) {
            writeJson('result', result);
            return;
        }
        writeFile('result', result);

        const suffix = result.message ? ` (${result.message})` : '';
        log(`${result.status.padEnd(6)} ${result.assetPath}${suffix}`, { file: false });
    }

    function dryRun({ label, resources, limit = 200 }) {
        const list = [...resources];
        const shown = list.slice(0, limit);
        const remaining = Math.max(0, list.length - shown.length);

        if (json) {
            writeJson('dry-run', {
                label,
                count: list.length,
                resources: shown,
                truncated: remaining
            });
            return;
        }

        writeFile('dry-run', {
            label,
            count: list.length,
            resources: shown,
            truncated: remaining
        });
        log(`Dry run: ${list.length} ${label}`, { force: true, file: false });
        if (!quiet) {
            for (const item of shown) stdout(item);
            if (remaining) stdout(`... ${remaining} more`);
        }
    }

    function summary(payload) {
        if (json) {
            writeJson('summary', payload);
            return;
        }

        writeFile('summary', payload);
        log('\nDone.', { force: true, file: false });
        log(JSON.stringify(payload.stats), { force: true, file: false });
        log(`Mirror folder: ${payload.mirrorFolder}`, { force: true, file: false });
        log(`Scanned unique resources: ${payload.scannedUniqueResources}`, { force: true, file: false });
    }

    return { dryRun, error, log, result, status, summary };
}

module.exports = { createCliLogger };
