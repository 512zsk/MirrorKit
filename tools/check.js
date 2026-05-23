const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const SHOULD_JSON = args.has('--json') || args.has('--json-log');
const SHOULD_QUICK = args.has('--quick');
const CHECK_PORT = String(40000 + (process.pid % 20000));

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit aggregate checker

Usage:
  node tools\\check.js [--quick] [--json]

Options:
  --quick         Skip the full test suite. Runs doctor, syntax, and JSON checks.
  --json          Print machine-readable JSON output.
  -h, --help      Show this help.

Checks:
  doctor, JavaScript syntax checks, JSON config checks, and the full node:test suite unless --quick is used.
`);
    process.exit(0);
}

const syntaxRoots = [
    'server.js',
    'lib',
    'tools',
    'tests'
];

const jsonFiles = [
    'package.json',
    'mirror.config.json'
];

function collectJsFiles(relativePath) {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) return [];

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) return relativePath.endsWith('.js') ? [relativePath] : [];
    if (!stat.isDirectory()) return [];

    return fs.readdirSync(fullPath, { withFileTypes: true })
        .flatMap(entry => collectJsFiles(path.join(relativePath, entry.name)))
        .sort();
}

function syntaxFiles() {
    return [...new Set(syntaxRoots.flatMap(collectJsFiles))].sort();
}

function testFiles() {
    const testsDir = path.join(ROOT, 'tests');
    return fs.readdirSync(testsDir)
        .filter(file => file.endsWith('.test.js'))
        .sort()
        .map(file => path.join('tests', file));
}

function runStep(name, command, args, options = {}) {
    const startedAt = Date.now();
    const { env: envOverride = {}, ...spawnOptions } = options;
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, NO_OPEN: '1', ...envOverride },
        ...spawnOptions
    });

    return {
        name,
        command: [command, ...args].join(' '),
        status: result.status === 0 ? 'pass' : 'fail',
        exitCode: result.status,
        durationMs: Date.now() - startedAt,
        stdout: result.stdout || '',
        stderr: result.error ? `${result.error.code || 'ERROR'}: ${result.error.message}` : (result.stderr || '')
    };
}

function runJsonStep(file) {
    const startedAt = Date.now();
    const filePath = path.join(ROOT, file);

    try {
        JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            name: `json:${file}`,
            command: `JSON.parse ${file}`,
            status: 'pass',
            exitCode: 0,
            durationMs: Date.now() - startedAt,
            stdout: '',
            stderr: ''
        };
    } catch (err) {
        return {
            name: `json:${file}`,
            command: `JSON.parse ${file}`,
            status: 'fail',
            exitCode: 1,
            durationMs: Date.now() - startedAt,
            stdout: '',
            stderr: err.message
        };
    }
}

function printStep(step) {
    const label = step.status === 'pass' ? 'PASS' : 'FAIL';
    console.log(`${label} ${step.name} (${step.durationMs}ms)`);
    if (step.status === 'fail') {
        if (step.stdout.trim()) console.log(step.stdout.trim());
        if (step.stderr.trim()) console.error(step.stderr.trim());
    }
}

function main() {
    const steps = [];

    steps.push(runStep('doctor', process.execPath, ['tools/doctor.js', '--json'], {
        env: { PORT: process.env.PORT || CHECK_PORT }
    }));

    for (const file of syntaxFiles()) {
        steps.push(runStep(`syntax:${file}`, process.execPath, ['--check', file]));
    }

    for (const file of jsonFiles) {
        steps.push(runJsonStep(file));
    }

    if (!SHOULD_QUICK) {
        steps.push(runStep('tests', process.execPath, ['--test', ...testFiles()]));
    }

    const failed = steps.filter(step => step.status === 'fail').length;
    const report = {
        ok: failed === 0,
        failed,
        steps: steps.map(step => ({
            name: step.name,
            command: step.command,
            status: step.status,
            exitCode: step.exitCode,
            durationMs: step.durationMs,
            env: step.name === 'doctor' ? { PORT: process.env.PORT || CHECK_PORT } : undefined
        }))
    };

    if (SHOULD_JSON) {
        console.log(JSON.stringify(report));
    } else {
        for (const step of steps) printStep(step);
        console.log('');
        console.log(report.ok ? 'Check passed.' : `Check failed: ${failed} failed step(s).`);
    }

    if (!report.ok) process.exitCode = 1;
}

main();
