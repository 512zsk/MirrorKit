const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLogReport, normalizeSeverity, readLogFile } = require('../lib/log-report');

describe('log report', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-logs-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('summarizes warnings, errors, and recent log events', () => {
        const logDir = path.join(tmpDir, 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, 'mirrorkit-server.log'), [
            JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', level: 'info', message: 'started' }),
            JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', level: 'warn', message: 'slow' }),
            JSON.stringify({ timestamp: '2026-01-01T00:00:02.000Z', level: 'error', message: 'failed', details: { url: '/a.js' } }),
            ''
        ].join('\n'));

        const report = createLogReport({
            rootDir: tmpDir,
            files: [path.join('logs', 'mirrorkit-server.log')],
            limit: 2
        });

        assert.strictEqual(report.ok, true);
        assert.strictEqual(report.eventCount, 3);
        assert.strictEqual(report.bySeverity.info, 1);
        assert.strictEqual(report.bySeverity.warn, 1);
        assert.strictEqual(report.bySeverity.error, 1);
        assert.deepStrictEqual(report.errors.map(event => event.message), ['failed']);
        assert.deepStrictEqual(report.warnings.map(event => event.message), ['slow']);
        assert.deepStrictEqual(report.recent.map(event => event.message), ['slow', 'failed']);
    });

    it('reports malformed log lines without throwing', () => {
        const filePath = path.join(tmpDir, 'bad.log');
        fs.writeFileSync(filePath, '{"level":"info","message":"ok"}\nnot-json\n');

        const report = readLogFile(filePath, { source: 'bad.log' });

        assert.strictEqual(report.events.length, 1);
        assert.strictEqual(report.parseErrors.length, 1);
        assert.strictEqual(report.parseErrors[0].lineNumber, 2);
    });

    it('normalizes tool event types into severities', () => {
        assert.strictEqual(normalizeSeverity({ type: 'error' }), 'error');
        assert.strictEqual(normalizeSeverity({ type: 'status' }), 'status');
        assert.strictEqual(normalizeSeverity({ level: 'WARNING' }), 'warn');
        assert.strictEqual(normalizeSeverity({}), 'unknown');
    });
});
