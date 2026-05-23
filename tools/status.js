const path = require('path');
const { loadMirrorConfig } = require('../lib/config');
const { createStatusReport } = require('../lib/status');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const CONFIG = loadMirrorConfig(ROOT);
const SHOULD_JSON = args.has('--json') || args.has('--json-log');

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit status

Usage:
  node tools\\status.js [--config <file>] [--json] [--log-limit <number>]

Options:
  --config <file>       Use a config file other than mirror.config.json.
  --json                Print machine-readable JSON output.
  --log-limit <number>  Number of recent log warnings/errors/events to include. Default: 20.
  -h, --help            Show this help.

Checks:
  doctor, mirror folder, invalid assets, manifests, and log health.
`);
    process.exit(0);
}

function argValue(name) {
    const eqPrefix = `${name}=`;
    const eqValue = argv.find(arg => arg.startsWith(eqPrefix));
    if (eqValue) return eqValue.slice(eqPrefix.length);

    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1];
    return null;
}

function numberFrom(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHuman(report) {
    console.log(`Target host: ${report.config.targetHost}`);
    console.log(`Mirror name: ${report.config.mirrorName}`);
    console.log(`Start path: ${report.config.startPath}`);
    console.log(`Port: ${report.config.port}${report.config.autoPort ? ' (auto-port enabled)' : ''}`);
    console.log('');

    for (const check of report.checks) {
        const label = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
        console.log(`${label} ${check.name}: ${check.message}`);
    }

    console.log('');
    console.log(`Mirror files: ${report.mirror.files}`);
    console.log(`Mirror bytes: ${report.mirror.bytes}`);
    console.log(`Invalid assets: ${report.mirror.invalidCount}`);
    console.log(`Manifests: ${report.mirror.manifestCount}`);
    console.log(`Log events: ${report.logs.eventCount}`);
    console.log(`Log errors: ${report.logs.bySeverity.error || 0}`);
    console.log(`Log warnings: ${report.logs.bySeverity.warn || 0}`);
    console.log('');
    console.log(report.ok ? 'Status passed.' : `Status failed: ${report.failed} failed check(s).`);
    if (report.warned) console.log(`Warnings: ${report.warned}`);

    if (report.suggestions.length) {
        console.log('\nSuggested next steps:');
        for (const item of report.suggestions) {
            console.log(`- ${item.reason}`);
            console.log(`  ${item.command}`);
        }
    }
}

createStatusReport(ROOT, CONFIG, {
    logLimit: numberFrom(argValue('--log-limit'), 20)
}).then(report => {
    if (SHOULD_JSON) console.log(JSON.stringify(report));
    else printHuman(report);

    if (!report.ok) process.exitCode = 1;
}).catch(err => {
    if (SHOULD_JSON) console.log(JSON.stringify({ ok: false, failed: 1, error: err.message }));
    else console.error(err.stack || err.message || err);
    process.exitCode = 1;
});
