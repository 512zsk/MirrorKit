const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createCliLogger } = require('../lib/cli-logger');

describe('createCliLogger', () => {
    it('prints human-readable dry-run output by default', () => {
        const lines = [];
        const logger = createCliLogger({ stdout: line => lines.push(line) });

        logger.dryRun({ label: 'initial resources', resources: new Set(['/a.js', '/b.css']) });

        assert.deepStrictEqual(lines, [
            'Dry run: 2 initial resources',
            '/a.js',
            '/b.css'
        ]);
    });

    it('suppresses detail lines in quiet mode but keeps summaries', () => {
        const lines = [];
        const logger = createCliLogger({ quiet: true, stdout: line => lines.push(line) });

        logger.log('hidden');
        logger.dryRun({ label: 'initial resources', resources: new Set(['/a.js']) });
        logger.summary({
            stats: { save: 1 },
            mirrorFolder: '/mirror',
            scannedUniqueResources: 1
        });

        assert.deepStrictEqual(lines, [
            'Dry run: 1 initial resources',
            '\nDone.',
            '{"save":1}',
            'Mirror folder: /mirror',
            'Scanned unique resources: 1'
        ]);
    });

    it('prints newline-delimited JSON events in JSON mode', () => {
        const lines = [];
        const logger = createCliLogger({ json: true, stdout: line => lines.push(line) });

        logger.status('Pass 1', { pass: 1 });
        logger.result({ status: 'save', assetPath: '/a.js', bytes: 10 });
        logger.summary({
            stats: { save: 1 },
            mirrorFolder: '/mirror',
            scannedUniqueResources: 1
        });

        assert.deepStrictEqual(lines.map(JSON.parse), [
            { type: 'status', message: 'Pass 1', pass: 1 },
            { type: 'result', status: 'save', assetPath: '/a.js', bytes: 10 },
            { type: 'summary', stats: { save: 1 }, mirrorFolder: '/mirror', scannedUniqueResources: 1 }
        ]);
    });

    it('mirrors structured events to an optional file sink', () => {
        const events = [];
        const logger = createCliLogger({
            stdout: () => {},
            stderr: () => {},
            fileLogger: { write: event => events.push(event) }
        });

        logger.status('Pass 1', { pass: 1 });
        logger.result({ status: 'save', assetPath: '/a.js', bytes: 10 });
        logger.summary({
            stats: { save: 1 },
            mirrorFolder: '/mirror',
            scannedUniqueResources: 1
        });
        logger.error('failed');

        assert.deepStrictEqual(events, [
            { type: 'status', message: 'Pass 1', pass: 1 },
            { type: 'result', status: 'save', assetPath: '/a.js', bytes: 10 },
            { type: 'summary', stats: { save: 1 }, mirrorFolder: '/mirror', scannedUniqueResources: 1 },
            { type: 'error', message: 'failed' }
        ]);
    });
});
