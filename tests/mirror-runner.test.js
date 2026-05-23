const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runMirrorWorkflow } = require('../lib/mirror-runner');

function createLogger() {
    return {
        dryRuns: [],
        results: [],
        statuses: [],
        summaries: [],
        dryRun(payload) { this.dryRuns.push(payload); },
        result(payload) { this.results.push(payload); },
        status(message, payload) { this.statuses.push({ message, payload }); },
        summary(payload) { this.summaries.push(payload); }
    };
}

describe('runMirrorWorkflow', () => {
    it('dry-runs initial resources without downloading', async () => {
        const logger = createLogger();
        let downloads = 0;

        const result = await runMirrorWorkflow({
            collectInitialAssets: () => new Set(['/a.js']),
            concurrency: 1,
            discoverAssets: async () => [],
            downloadAsset: async () => {
                downloads++;
                return { status: 'save', assetPath: '/a.js' };
            },
            dryRunLabel: 'initial resources',
            logger,
            loadProgress: () => null,
            maxPasses: 2,
            mirrorFolder: '/mirror',
            saveProgress: () => {},
            shouldDryRun: true
        });

        assert.strictEqual(result.dryRun, true);
        assert.strictEqual(downloads, 0);
        assert.strictEqual(logger.dryRuns.length, 1);
        assert.strictEqual(logger.dryRuns[0].resources.has('/a.js'), true);
    });

    it('downloads resources, discovers new resources, and summarizes stats', async () => {
        const logger = createLogger();
        const savedPasses = [];
        const downloaded = [];

        const result = await runMirrorWorkflow({
            collectInitialAssets: () => new Set(['/a.js']),
            concurrency: 1,
            discoverAssets: async item => item === '/a.js' ? ['/b.css'] : [],
            downloadAsset: async assetPath => {
                downloaded.push(assetPath);
                return { status: 'save', assetPath };
            },
            dryRunLabel: 'initial resources',
            logger,
            loadProgress: () => null,
            maxPasses: 3,
            mirrorFolder: '/mirror',
            saveProgress: (pass, pending, seen, stats) => {
                savedPasses.push({ pass, pending: [...pending], seen: [...seen], stats: { ...stats } });
            }
        });

        assert.strictEqual(result.completed, true);
        assert.deepStrictEqual(downloaded, ['/a.js', '/b.css']);
        assert.deepStrictEqual(savedPasses.map(item => item.pass), [1, 2]);
        assert.deepStrictEqual(result.stats, { save: 2, skip: 0, fail: 0, reject: 0, error: 0 });
        assert.strictEqual(logger.summaries[0].scannedUniqueResources, 2);
    });

    it('resumes from saved progress', async () => {
        const logger = createLogger();
        const downloaded = [];

        await runMirrorWorkflow({
            collectInitialAssets: () => new Set(['/unused.js']),
            concurrency: 1,
            discoverAssets: async () => [],
            downloadAsset: async assetPath => {
                downloaded.push(assetPath);
                return { status: 'skip', assetPath };
            },
            dryRunLabel: 'initial resources',
            logger,
            loadProgress: () => ({
                pass: 1,
                pending: ['/a.js', '/b.css'],
                seen: ['/a.js'],
                stats: { save: 1, skip: 0, fail: 0, reject: 0, error: 0 },
                savedAt: '2026-01-01T00:00:00.000Z'
            }),
            maxPasses: 2,
            mirrorFolder: '/mirror',
            saveProgress: () => {},
            shouldResume: true
        });

        assert.deepStrictEqual(downloaded, ['/b.css']);
        assert.strictEqual(logger.statuses[0].message.includes('Resuming from pass 1'), true);
    });

    it('saves progress and stops before starting the next batch', async () => {
        const logger = createLogger();
        const saved = [];
        let stopChecks = 0;

        const result = await runMirrorWorkflow({
            collectInitialAssets: () => new Set(['/a.js']),
            concurrency: 1,
            discoverAssets: async () => [],
            downloadAsset: async assetPath => ({ status: 'save', assetPath }),
            dryRunLabel: 'initial resources',
            logger,
            loadProgress: () => null,
            maxPasses: 2,
            mirrorFolder: '/mirror',
            saveProgress: (pass, pending, seen, stats) => saved.push({ pass, pending: [...pending], seen: [...seen], stats }),
            shouldStop: () => ++stopChecks === 1
        });

        assert.strictEqual(result.stopped, true);
        assert.strictEqual(result.pass, 0);
        assert.deepStrictEqual(saved[0].pending, ['/a.js']);
        assert.deepStrictEqual(saved[0].seen, []);
    });

    it('does not claim completion when max passes leave resources pending', async () => {
        const logger = createLogger();
        let cleared = false;

        const result = await runMirrorWorkflow({
            collectInitialAssets: () => new Set(['/a.js']),
            concurrency: 1,
            discoverAssets: async item => item === '/a.js' ? ['/b.css'] : [],
            downloadAsset: async assetPath => ({ status: 'save', assetPath }),
            dryRunLabel: 'initial resources',
            logger,
            loadProgress: () => null,
            maxPasses: 1,
            mirrorFolder: '/mirror',
            saveProgress: () => {},
            clearProgress: () => { cleared = true; }
        });

        assert.strictEqual(result.incomplete, true);
        assert.strictEqual(result.completed, undefined);
        assert.strictEqual(result.remaining.includes('/b.css'), true);
        assert.strictEqual(cleared, false);
        assert.strictEqual(logger.statuses.some(item => item.message.includes('Reached max passes')), true);
    });
});
