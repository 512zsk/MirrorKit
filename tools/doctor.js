const path = require('path');
const { loadMirrorConfig } = require('../lib/config');
const { runDoctor } = require('../lib/doctor');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const CONFIG = loadMirrorConfig(ROOT);
const SHOULD_JSON = args.has('--json') || args.has('--json-log');

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit doctor

Usage:
  node tools\\doctor.js [--config <file>] [--auto-port] [--json]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --auto-port     Treat an occupied configured port as a warning.
  --json          Print machine-readable JSON output.
  -h, --help      Show this help.

Checks:
  Node.js version, configuration, required files, mirror folder write access,
  and local server port availability.
`);
    process.exit(0);
}

function printHuman(report) {
    for (const check of report.checks) {
        const icon = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL';
        console.log(`${icon} ${check.name}: ${check.message}`);
        if (check.details?.problems) {
            for (const problem of check.details.problems) {
                console.log(`  - ${problem}`);
            }
        }
        if (check.details?.missing) {
            for (const missing of check.details.missing) {
                console.log(`  - missing: ${missing}`);
            }
        }
        if (check.details?.error) {
            console.log(`  - ${check.details.error}`);
        }
    }

    console.log('');
    console.log(report.ok ? 'Doctor passed.' : `Doctor failed: ${report.failed} failed check(s).`);
}

runDoctor(ROOT, CONFIG).then(report => {
    if (SHOULD_JSON) {
        console.log(JSON.stringify(report));
    } else {
        printHuman(report);
    }

    if (!report.ok) process.exitCode = 1;
}).catch(err => {
    if (SHOULD_JSON) {
        console.log(JSON.stringify({ ok: false, failed: 1, error: err.message }));
    } else {
        console.error(err.stack || err.message || err);
    }
    process.exitCode = 1;
});
