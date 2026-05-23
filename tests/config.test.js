const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    argValue,
    loadMirrorConfig,
    numberFrom,
    resolveConfigPath,
    validateMirrorConfig
} = require('../lib/config');

describe('loadMirrorConfig', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-config-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses defaults when no config file exists', () => {
        const config = loadMirrorConfig(tmpDir, {});
        assert.strictEqual(config.targetHost, 'https://example.com');
        assert.strictEqual(config.mirrorName, 'example.com');
        assert.strictEqual(config.maxPasses, 4);
        assert.deepStrictEqual(config.ignoredPathPrefixes, ['/.well-known/', '/bb-mcp']);
    });

    it('uses mirror.config.json values', () => {
        fs.writeFileSync(path.join(tmpDir, 'mirror.config.json'), JSON.stringify({
            targetHost: 'https://site.test',
            mirrorName: 'site.test',
            maxPasses: 8,
            remoteAssetPrefixes: ['https://cdn.test/'],
            sitePathPrefixes: ['content']
        }));

        const config = loadMirrorConfig(tmpDir, {});
        assert.strictEqual(config.targetHost, 'https://site.test');
        assert.strictEqual(config.mirrorName, 'site.test');
        assert.strictEqual(config.maxPasses, 8);
        assert.deepStrictEqual(config.remoteAssetPrefixes, ['https://cdn.test/']);
        assert.deepStrictEqual(config.sitePathPrefixes, ['content']);
    });

    it('lets environment values override file values', () => {
        fs.writeFileSync(path.join(tmpDir, 'mirror.config.json'), JSON.stringify({
            targetHost: 'https://file.test',
            port: 3000,
            concurrency: 3
        }));

        const config = loadMirrorConfig(tmpDir, {
            TARGET_HOST: 'https://env.test',
            PORT: '4000',
            MIRROR_CONCURRENCY: '9'
        });

        assert.strictEqual(config.targetHost, 'https://env.test');
        assert.strictEqual(config.port, 4000);
        assert.strictEqual(config.concurrency, 9);
    });

    it('loads an explicit config file path', () => {
        fs.writeFileSync(path.join(tmpDir, 'site-a.json'), JSON.stringify({
            targetHost: 'https://site-a.test',
            mirrorName: 'site-a.test'
        }));

        const config = loadMirrorConfig(tmpDir, {}, { argv: ['--config', 'site-a.json'] });
        assert.strictEqual(config.targetHost, 'https://site-a.test');
        assert.strictEqual(config.mirrorName, 'site-a.test');
        assert.strictEqual(config.configFileMissing, false);
    });

    it('lets --port override file values while keeping environment precedence', () => {
        fs.writeFileSync(path.join(tmpDir, 'mirror.config.json'), JSON.stringify({
            port: 3000
        }));

        const cliConfig = loadMirrorConfig(tmpDir, {}, { argv: ['--port', '3100'] });
        assert.strictEqual(cliConfig.port, 3100);

        const envConfig = loadMirrorConfig(tmpDir, { PORT: '3200' }, { argv: ['--port', '3100'] });
        assert.strictEqual(envConfig.port, 3200);
    });

    it('loads auto-port from config, environment, or CLI args', () => {
        fs.writeFileSync(path.join(tmpDir, 'mirror.config.json'), JSON.stringify({
            autoPort: true
        }));

        assert.strictEqual(loadMirrorConfig(tmpDir, {}).autoPort, true);
        assert.strictEqual(loadMirrorConfig(tmpDir, { MIRRORKIT_AUTO_PORT: '0' }).autoPort, false);
        assert.strictEqual(loadMirrorConfig(tmpDir, {}, { argv: ['--auto-port'] }).autoPort, true);
    });
});

describe('CLI config helpers', () => {
    it('reads --config values in both supported forms', () => {
        assert.strictEqual(argValue(['--config', 'site-a.json'], '--config'), 'site-a.json');
        assert.strictEqual(argValue(['--config=site-b.json'], '--config'), 'site-b.json');
        assert.strictEqual(argValue(['--port', '3100'], '--port'), '3100');
        assert.strictEqual(argValue(['--port=3200'], '--port'), '3200');
    });

    it('resolves config path from args or environment', () => {
        assert.strictEqual(resolveConfigPath('/repo', ['--config', 'a.json'], {}), path.resolve('/repo', 'a.json'));
        assert.strictEqual(resolveConfigPath('/repo', [], { MIRRORKIT_CONFIG: 'b.json' }), path.resolve('/repo', 'b.json'));
    });
});

describe('numberFrom', () => {
    it('falls back for invalid or non-positive values', () => {
        assert.strictEqual(numberFrom('abc', 6), 6);
        assert.strictEqual(numberFrom('0', 6), 6);
        assert.strictEqual(numberFrom('-1', 6), 6);
    });

    it('parses positive numbers', () => {
        assert.strictEqual(numberFrom('12', 6), 12);
    });
});

describe('validateMirrorConfig', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorkit-config-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns no problems for default config', () => {
        assert.deepStrictEqual(validateMirrorConfig(loadMirrorConfig(tmpDir, {})), []);
    });

    it('reports invalid URL and path-like folder names', () => {
        const config = loadMirrorConfig(tmpDir, {
            TARGET_HOST: 'not-a-url',
            MIRROR_NAME: '../bad',
            START_PATH: 'missing-slash'
        });

        const problems = validateMirrorConfig(config);
        assert.strictEqual(problems.some(problem => problem.includes('targetHost')), true);
        assert.strictEqual(problems.some(problem => problem.includes('mirrorName')), true);
        assert.strictEqual(problems.some(problem => problem.includes('startPath')), true);
    });

    it('reports invalid remote mirror entries', () => {
        const config = loadMirrorConfig(tmpDir, {});
        config.remoteMirrors = [{ prefix: 'cdn/', origin: 'ftp://cdn.example.test' }];

        const problems = validateMirrorConfig(config);
        assert.strictEqual(problems.some(problem => problem.includes('prefix')), true);
        assert.strictEqual(problems.some(problem => problem.includes('origin')), true);
    });

    it('reports missing explicit config files and invalid JSON', () => {
        const missing = loadMirrorConfig(tmpDir, {}, { argv: ['--config', 'missing.json'] });
        assert.strictEqual(validateMirrorConfig(missing).some(problem => problem.includes('config file not found')), true);

        fs.writeFileSync(path.join(tmpDir, 'bad.json'), '{not json');
        const bad = loadMirrorConfig(tmpDir, {}, { argv: ['--config', 'bad.json'] });
        assert.strictEqual(validateMirrorConfig(bad).some(problem => problem.includes('not valid JSON')), true);
    });
});
