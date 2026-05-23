const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { createFileInventory, createMirrorManifest, writeMirrorManifest } = require('../lib/manifest');

const ROOT = path.resolve(__dirname, '..');

function runNode(args, env = {}) {
    return spawnSync(process.execPath, args, {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, MIRRORKIT_LOG_FILE: '0', ...env }
    });
}

describe('CLI help', () => {
    it('prints server help without starting the server', () => {
        const result = runNode(['server.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit local proxy server/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--port/);
        assert.match(result.stdout, /--auto-port/);
        assert.match(result.stdout, /--no-open/);
        assert.match(result.stdout, /--log-file/);
    });

    it('prints mirror-assets help', () => {
        const result = runNode(['tools/mirror-assets.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit batch asset downloader/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--resume/);
        assert.match(result.stdout, /--dry-run/);
        assert.match(result.stdout, /--quiet/);
        assert.match(result.stdout, /--json-log/);
        assert.match(result.stdout, /--log-file/);
    });

    it('prints CMS media help', () => {
        const result = runNode(['tools/mirror-cms-media.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit CMS media downloader/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /CMS_MEDIA_HOST/);
        assert.match(result.stdout, /--dry-run/);
        assert.match(result.stdout, /--quiet/);
        assert.match(result.stdout, /--json-log/);
        assert.match(result.stdout, /--log-file/);
    });

    it('prints validate-assets help', () => {
        const result = runNode(['tools/validate-assets.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit cache validator/);
        assert.match(result.stdout, /--config/);
    });

    it('prints find-video-refs help', () => {
        const result = runNode(['tools/find-video-refs.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit video reference finder/);
    });

    it('prints doctor help', () => {
        const result = runNode(['tools/doctor.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit doctor/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--auto-port/);
        assert.match(result.stdout, /--json/);
    });

    it('prints report help', () => {
        const result = runNode(['tools/report.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit mirror report/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--json/);
    });

    it('prints logs help', () => {
        const result = runNode(['tools/logs.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit log viewer/);
        assert.match(result.stdout, /--limit/);
        assert.match(result.stdout, /--json/);
    });

    it('prints status help', () => {
        const result = runNode(['tools/status.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit status/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--log-limit/);
        assert.match(result.stdout, /--json/);
    });

    it('prints check help', () => {
        const result = runNode(['tools/check.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit aggregate checker/);
        assert.match(result.stdout, /--quick/);
        assert.match(result.stdout, /--json/);
    });

    it('prints verify-manifest help', () => {
        const result = runNode(['tools/verify-manifest.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit manifest verifier/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--cms/);
        assert.match(result.stdout, /--json/);
    });

    it('prints export-standalone help', () => {
        const result = runNode(['tools/export-standalone.js', '--help']);
        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /MirrorKit standalone exporter/);
        assert.match(result.stdout, /--config/);
        assert.match(result.stdout, /--out/);
        assert.match(result.stdout, /--force/);
        assert.match(result.stdout, /--check/);
    });
});

describe('CLI dry-run', () => {
    it('previews mirror-assets resources without network access', () => {
        const result = runNode(['tools/mirror-assets.js', '--dry-run'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-dry-run-assets',
            START_PATH: '/'
        });

        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /Dry run: \d+ initial resources/);
        assert.match(result.stdout, /\//);
    });

    it('previews CMS media resources without network access', () => {
        const result = runNode(['tools/mirror-cms-media.js', '--dry-run'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-dry-run-cms',
            CMS_MEDIA_HOST: 'https://storage.example.test/bucket'
        });

        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /Dry run: \d+ initial CMS resources/);
        assert.match(result.stdout, /cms\/metadata-latest\.json/);
    });

    it('uses an alternate config file for dry-run', () => {
        const configPath = path.join(ROOT, `.tmp-cli-config-${process.pid}.json`);
        fs.writeFileSync(configPath, JSON.stringify({
            targetHost: 'https://alt-config.test',
            mirrorName: '.tmp-alt-config',
            startPath: '/zh'
        }));

        try {
            const result = runNode(['tools/mirror-assets.js', '--config', path.basename(configPath), '--dry-run']);

            assert.strictEqual(result.status, 0);
            assert.match(result.stdout, /Dry run: \d+ initial resources/);
            assert.match(result.stdout, /\/zh/);
        } finally {
            fs.rmSync(configPath, { force: true });
        }
    });

    it('prints JSON dry-run output when requested', () => {
        const result = runNode(['tools/mirror-assets.js', '--dry-run', '--json-log'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-json-log-assets',
            START_PATH: '/json',
            MIRRORKIT_LOG_FILE: '0'
        });

        assert.strictEqual(result.status, 0);
        const lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
        const dryRunLine = lines.find(l => l.type === 'dry-run');
        assert.ok(dryRunLine, 'expected a dry-run event');
        assert.strictEqual(dryRunLine.label, 'initial resources');
        assert.strictEqual(dryRunLine.resources.includes('/json'), true);
    });

    it('suppresses dry-run resource detail in quiet mode', () => {
        const result = runNode(['tools/mirror-assets.js', '--dry-run', '--quiet'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-quiet-assets',
            START_PATH: '/quiet',
            MIRRORKIT_LOG_FILE: '0'
        });

        assert.strictEqual(result.status, 0);
        assert.match(result.stdout, /Dry run: \d+ initial resources/);
        assert.doesNotMatch(result.stdout, /\/quiet/);
    });
});

describe('CLI config validation', () => {
    it('fails fast for invalid server configuration', () => {
        const result = runNode(['server.js', '--no-open'], {
            TARGET_HOST: 'not-a-url',
            MIRROR_NAME: 'bad/name'
        });

        assert.strictEqual(result.status, 1);
        assert.match(result.stderr, /Invalid MirrorKit configuration/);
        assert.match(result.stderr, /targetHost/);
        assert.match(result.stderr, /mirrorName/);
    });

    it('fails fast for a missing explicit config file', () => {
        const result = runNode(['server.js', '--config', '.tmp-missing-config.json', '--no-open']);

        assert.strictEqual(result.status, 1);
        assert.match(result.stderr, /config file not found/);
    });
});

describe('CLI doctor', () => {
    it('prints a JSON doctor report', () => {
        const result = runNode(['tools/doctor.js', '--json'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-doctor-cli',
            PORT: '65529'
        });

        const report = JSON.parse(result.stdout);
        assert.strictEqual(result.status, report.ok ? 0 : 1);
        assert.strictEqual(Array.isArray(report.checks), true);
        assert.strictEqual(report.checks.some(check => check.name === 'node-version'), true);

        fs.rmSync(path.join(ROOT, '.tmp-doctor-cli'), { recursive: true, force: true });
    });

    it('returns non-zero when config is invalid', () => {
        const result = runNode(['tools/doctor.js', '--json'], {
            TARGET_HOST: 'bad-url',
            MIRROR_NAME: '.tmp-doctor-bad',
            PORT: '65528'
        });

        const report = JSON.parse(result.stdout);
        assert.strictEqual(result.status, 1);
        assert.strictEqual(report.ok, false);
        assert.strictEqual(report.checks.some(check => check.name === 'config' && check.status === 'fail'), true);

        fs.rmSync(path.join(ROOT, '.tmp-doctor-bad'), { recursive: true, force: true });
    });
});

describe('CLI report', () => {
    it('prints a JSON mirror report', () => {
        const dir = path.join(ROOT, `.tmp-report-cli-${process.pid}`);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html></html>');
        fs.writeFileSync(path.join(dir, 'bad.json'), '{bad');

        try {
            const result = runNode(['tools/report.js', '--json', path.basename(dir)], {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: path.basename(dir)
            });

            const report = JSON.parse(result.stdout);
            assert.strictEqual(result.status, 2);
            assert.strictEqual(report.exists, true);
            assert.strictEqual(report.files, 2);
            assert.strictEqual(report.invalidCount, 1);
            assert.strictEqual(report.invalid[0].reason, 'invalid-json');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns non-zero for a missing mirror folder', () => {
        const result = runNode(['tools/report.js', '--json', '.tmp-report-missing'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-report-missing'
        });

        const report = JSON.parse(result.stdout);
        assert.strictEqual(result.status, 1);
        assert.strictEqual(report.exists, false);
    });
});

describe('CLI logs', () => {
    it('prints a JSON log report for selected log files', () => {
        const logPath = path.join(ROOT, `.tmp-log-report-${process.pid}.log`);
        fs.writeFileSync(logPath, [
            JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', level: 'warn', message: 'slow' }),
            JSON.stringify({ timestamp: '2026-01-01T00:00:01.000Z', type: 'error', message: 'failed' }),
            ''
        ].join('\n'));

        try {
            const result = runNode(['tools/logs.js', '--json', '--limit', '1', path.basename(logPath)]);
            const report = JSON.parse(result.stdout);

            assert.strictEqual(result.status, 0, result.stderr);
            assert.strictEqual(report.ok, true);
            assert.strictEqual(report.eventCount, 2);
            assert.strictEqual(report.bySeverity.warn, 1);
            assert.strictEqual(report.bySeverity.error, 1);
            assert.deepStrictEqual(report.errors.map(event => event.message), ['failed']);
            assert.deepStrictEqual(report.recent.map(event => event.message), ['failed']);
        } finally {
            fs.rmSync(logPath, { force: true });
        }
    });
});

describe('CLI status', () => {
    it('prints a JSON status report', () => {
        const mirrorName = `.tmp-status-cli-${process.pid}`;
        const mirrorDir = path.join(ROOT, mirrorName);
        fs.rmSync(mirrorDir, { recursive: true, force: true });

        try {
            const result = runNode(['tools/status.js', '--json', '--log-limit', '1'], {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: mirrorName,
                START_PATH: '/',
                PORT: '65521',
                MIRRORKIT_AUTO_PORT: '1'
            });
            const report = JSON.parse(result.stdout);

            assert.strictEqual(result.status, report.ok ? 0 : 1);
            assert.strictEqual(report.config.mirrorName, mirrorName);
            assert.strictEqual(Array.isArray(report.checks), true);
            assert.strictEqual(report.checks.some(check => check.name === 'doctor'), true);
            assert.strictEqual(report.checks.some(check => check.name === 'logs-parse'), true);
        } finally {
            fs.rmSync(mirrorDir, { recursive: true, force: true });
        }
    });
});

describe('CLI manifest verification', () => {
    it('prints a JSON manifest verification report', () => {
        const dir = path.join(ROOT, `.tmp-verify-manifest-${process.pid}`);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html></html>');

        try {
            const manifestPath = path.join(dir, '.mirror-manifest.json');
            writeMirrorManifest(manifestPath, createMirrorManifest({
                tool: 'mirror-assets',
                targetHost: 'https://example.test',
                mirrorName: path.basename(dir),
                files: createFileInventory(dir),
                generatedAt: '2026-01-01T00:00:00.000Z'
            }));

            const result = runNode(['tools/verify-manifest.js', '--json', path.relative(ROOT, manifestPath)], {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: path.basename(dir)
            });

            const report = JSON.parse(result.stdout);
            assert.strictEqual(result.status, 0);
            assert.strictEqual(report.ok, true);
            assert.strictEqual(report.checked, 1);
            assert.deepStrictEqual(report.missing, []);
            assert.deepStrictEqual(report.changed, []);
            assert.deepStrictEqual(report.extra, []);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('CLI standalone export', () => {
    it('exports a standalone project and runs its self-check', () => {
        const mirrorName = `.tmp-export-cli-${process.pid}`;
        const mirrorDir = path.join(ROOT, mirrorName);
        const outDir = path.join(ROOT, `.tmp-export-cli-out-${process.pid}`);
        fs.rmSync(mirrorDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(mirrorDir, { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'index.html'), '<!doctype html><html>offline</html>');

        try {
            const result = runNode([
                'tools/export-standalone.js',
                '--out', path.basename(outDir),
                '--check'
            ], {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: mirrorName,
                START_PATH: '/'
            });

            assert.strictEqual(result.status, 0, result.stderr);
            assert.match(result.stdout, /Standalone offline project exported/);
            assert.match(result.stdout, /Standalone self-check passed/);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'server.js')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'start-windows.bat')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'start.sh')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, mirrorName, '.mirror-manifest.json')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'tools')), false);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'lib')), false);
        } finally {
            fs.rmSync(mirrorDir, { recursive: true, force: true });
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    it('exports to an absolute folder outside the MirrorKit project', () => {
        const mirrorName = `.tmp-export-absolute-${process.pid}`;
        const mirrorDir = path.join(ROOT, mirrorName);
        const outDir = path.join(os.tmpdir(), `mirrorkit-cli-out-${process.pid}-${Date.now()}`);
        fs.rmSync(mirrorDir, { recursive: true, force: true });
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(mirrorDir, { recursive: true });
        fs.writeFileSync(path.join(mirrorDir, 'index.html'), '<!doctype html><html>offline</html>');

        try {
            const result = runNode([
                'tools/export-standalone.js',
                '--out', outDir,
                '--check'
            ], {
                TARGET_HOST: 'https://example.test',
                MIRROR_NAME: mirrorName,
                START_PATH: '/'
            });

            assert.strictEqual(result.status, 0, result.stderr);
            assert.match(result.stdout, /Standalone offline project exported/);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'server.js')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, '.mirrorkit-standalone.json')), true);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'tools')), false);
            assert.strictEqual(fs.existsSync(path.join(outDir, 'lib')), false);
        } finally {
            fs.rmSync(mirrorDir, { recursive: true, force: true });
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });
});

describe('CLI check', () => {
    it('runs quick checks and prints JSON output', () => {
        const result = runNode(['tools/check.js', '--quick', '--json'], {
            TARGET_HOST: 'https://example.test',
            MIRROR_NAME: '.tmp-check-cli'
        });

        const report = JSON.parse(result.stdout);
        const stepNames = new Set(report.steps.map(step => step.name.replace(/\\/g, '/')));
        assert.strictEqual(result.status, report.ok ? 0 : 1);
        assert.strictEqual(report.ok, true);
        assert.strictEqual(stepNames.has('doctor'), true);
        assert.match(report.steps.find(step => step.name === 'doctor').env.PORT, /^[4-5]\d{4}$/);
        assert.strictEqual(stepNames.has('syntax:server.js'), true);
        assert.strictEqual(stepNames.has('syntax:lib/config.js'), true);
        assert.strictEqual(stepNames.has('syntax:tools/check.js'), true);
        assert.strictEqual(stepNames.has('syntax:tests/cli.test.js'), true);
        assert.strictEqual(stepNames.has('syntax:tools/verify-manifest.js'), true);
        assert.strictEqual(stepNames.has('syntax:tools/export-standalone.js'), true);
        assert.strictEqual(stepNames.has('json:package.json'), true);
        assert.strictEqual(stepNames.has('json:mirror.config.json'), true);
        assert.strictEqual(stepNames.has('tests'), false);

        fs.rmSync(path.join(ROOT, '.tmp-check-cli'), { recursive: true, force: true });
    });
});

describe('Launcher scripts', () => {
    it('runs preflight checks and starts with auto-port fallback', () => {
        const script = fs.readFileSync(path.join(ROOT, '一键启动服务器.bat'), 'utf8');

        assert.match(script, /where node/);
        assert.match(script, /node tools\\doctor\.js --auto-port/);
        assert.match(script, /node server\.js --auto-port/);
    });

    it('uses auto-port for npm start', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        assert.strictEqual(pkg.scripts.start, 'node server.js --auto-port');
        assert.strictEqual(pkg.scripts.status, 'node tools/status.js');
        assert.strictEqual(pkg.scripts.logs, 'node tools/logs.js');
    });
});
