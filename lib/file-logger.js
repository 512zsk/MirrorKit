const fs = require('fs');
const path = require('path');
const { numberFrom } = require('./config');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function isDisabled(env = process.env) {
    return env.MIRRORKIT_LOG_FILE === '0' || env.NO_LOG_FILE === '1';
}

function resolveMaxBytes(env = process.env, fallback = DEFAULT_MAX_BYTES) {
    return numberFrom(env.MIRRORKIT_LOG_MAX_BYTES, fallback);
}

function resolveLogFile({
    rootDir = process.cwd(),
    filename = 'mirrorkit.log',
    env = process.env
} = {}) {
    if (isDisabled(env)) return null;

    if (env.MIRRORKIT_LOG_FILE) {
        return path.resolve(rootDir, env.MIRRORKIT_LOG_FILE);
    }

    const logDir = env.MIRRORKIT_LOG_DIR || 'logs';
    return path.resolve(rootDir, logDir, filename);
}

function createFileLogger({
    logFile,
    rootDir = process.cwd(),
    filename = 'mirrorkit.log',
    maxBytes,
    env = process.env,
    onError
} = {}) {
    const resolvedLogFile = logFile === undefined
        ? resolveLogFile({ rootDir, filename, env })
        : (logFile ? path.resolve(rootDir, logFile) : null);
    const resolvedMaxBytes = maxBytes === undefined ? resolveMaxBytes(env) : numberFrom(maxBytes, DEFAULT_MAX_BYTES);

    function rotateIfNeeded(incomingBytes) {
        if (!resolvedLogFile || !fs.existsSync(resolvedLogFile)) return;
        const size = fs.statSync(resolvedLogFile).size;
        if (size + incomingBytes <= resolvedMaxBytes) return;

        const rotatedFile = `${resolvedLogFile}.1`;
        try {
            fs.rmSync(rotatedFile, { force: true });
            fs.renameSync(resolvedLogFile, rotatedFile);
        } catch {
            // renameSync can fail across devices; fall back to copy+delete
            try {
                fs.copyFileSync(resolvedLogFile, rotatedFile);
                fs.writeFileSync(resolvedLogFile, '', 'utf8');
            } catch { /* rotation failure does not block logging */ }
        }
    }

    function clear() {
        if (!resolvedLogFile) return;
        try {
            fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });
            fs.writeFileSync(resolvedLogFile, '', 'utf8');
        } catch { /* ignore */ }
    }

    function write(event) {
        if (!resolvedLogFile) return;

        try {
            fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });
            const line = JSON.stringify({
                timestamp: new Date().toISOString(),
                ...event
            }) + '\n';
            rotateIfNeeded(Buffer.byteLength(line));
            fs.appendFileSync(resolvedLogFile, line, 'utf8');
        } catch (err) {
            if (typeof onError === 'function') onError(err);
        }
    }

    return {
        logFile: resolvedLogFile,
        write,
        clear
    };
}

module.exports = {
    createFileLogger,
    resolveLogFile,
    resolveMaxBytes
};
