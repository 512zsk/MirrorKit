const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileLogger, resolveLogFile, resolveMaxBytes } = require('../lib/file-logger');

describe('file logger', () => {
    it('writes newline-delimited JSON events', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-log-'));
        const logger = createFileLogger({ rootDir, filename: 'test.log', env: {} });

        try {
            logger.write({ type: 'status', message: 'ok', details: { count: 1 } });

            const lines = fs.readFileSync(logger.logFile, 'utf8').trim().split(/\r?\n/);
            assert.strictEqual(lines.length, 1);

            const event = JSON.parse(lines[0]);
            assert.strictEqual(event.type, 'status');
            assert.strictEqual(event.message, 'ok');
            assert.deepStrictEqual(event.details, { count: 1 });
            assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it('can be disabled with MIRRORKIT_LOG_FILE=0', () => {
        const logFile = resolveLogFile({
            rootDir: process.cwd(),
            filename: 'test.log',
            env: { MIRRORKIT_LOG_FILE: '0' }
        });

        assert.strictEqual(logFile, null);
    });

    it('rotates the current log file when it grows past the size limit', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-log-'));
        const logger = createFileLogger({ rootDir, filename: 'test.log', maxBytes: 180, env: {} });

        try {
            logger.write({ type: 'status', message: 'first'.repeat(20) });
            logger.write({ type: 'status', message: 'second'.repeat(20) });

            assert.strictEqual(fs.existsSync(logger.logFile), true);
            assert.strictEqual(fs.existsSync(`${logger.logFile}.1`), true);

            const current = fs.readFileSync(logger.logFile, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
            const rotated = fs.readFileSync(`${logger.logFile}.1`, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
            assert.strictEqual(current.some(event => event.message.includes('second')), true);
            assert.strictEqual(rotated.some(event => event.message.includes('first')), true);
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it('reads MIRRORKIT_LOG_MAX_BYTES from the environment', () => {
        assert.strictEqual(resolveMaxBytes({ MIRRORKIT_LOG_MAX_BYTES: '1234' }), 1234);
        assert.strictEqual(resolveMaxBytes({ MIRRORKIT_LOG_MAX_BYTES: 'bad' }, 999), 999);
    });

    it('does not throw if the log sink fails', () => {
        const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-log-'));
        const blocker = path.join(rootDir, 'blocked');
        fs.writeFileSync(blocker, 'not a directory');
        const logger = createFileLogger({ rootDir, logFile: path.join('blocked', 'test.log'), env: {} });

        try {
            assert.doesNotThrow(() => logger.write({ type: 'status', message: 'ok' }));
        } finally {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });
});
