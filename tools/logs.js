const path = require('path');
const { DEFAULT_LOG_FILES, createLogReport } = require('../lib/log-report');
const { isInsidePath } = require('../lib/paths');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const SHOULD_JSON = args.has('--json') || args.has('--json-log');

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit log viewer

Usage:
  node tools\\logs.js [--json] [--limit <number>] [log-file ...]

Options:
  --json           Print machine-readable JSON output.
  --limit <number> Number of recent warnings/errors/events to show. Default: 20.
  -h, --help       Show this help.

By default, this reads:
  ${DEFAULT_LOG_FILES.join('\n  ')}
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

function positionalArgs() {
    const output = [];
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--limit') {
            index++;
            continue;
        }
        if (arg.startsWith('--limit=')) continue;
        if (!arg.startsWith('--')) output.push(arg);
    }
    return output;
}

function numberFrom(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validateFiles(files) {
    for (const file of files) {
        const resolved = path.resolve(ROOT, file);
        if (!isInsidePath(ROOT, resolved)) {
            throw new Error(`Refusing to read log outside project: ${resolved}`);
        }
    }
}

function printEvent(event) {
    const timestamp = event.timestamp || 'unknown-time';
    const detail = event.details ? ` ${JSON.stringify(event.details)}` : '';
    console.log(`${timestamp}\t${event.severity}\t${event.source}:${event.lineNumber}\t${event.message}${detail}`);
}

function printHuman(report) {
    console.log('Log files:');
    for (const file of report.files) {
        const status = file.exists ? `${file.events} event(s), ${file.parseErrors} parse error(s)` : 'missing';
        console.log(`${file.path}\t${status}`);
    }

    console.log('');
    console.log(`Events: ${report.eventCount}`);
    console.log(`Parse errors: ${report.parseErrorCount}`);
    console.log(`Errors: ${report.bySeverity.error || 0}`);
    console.log(`Warnings: ${report.bySeverity.warn || 0}`);

    if (report.errors.length) {
        console.log('\nRecent errors:');
        for (const event of report.errors) printEvent(event);
    }

    if (report.warnings.length) {
        console.log('\nRecent warnings:');
        for (const event of report.warnings) printEvent(event);
    }

    if (report.recent.length) {
        console.log('\nRecent events:');
        for (const event of report.recent) printEvent(event);
    }

    if (report.parseErrors.length) {
        console.log('\nParse errors:');
        for (const error of report.parseErrors) {
            console.log(`${error.source}:${error.lineNumber}\t${error.message}`);
        }
    }
}

function main() {
    const files = positionalArgs();
    const selectedFiles = files.length ? files : DEFAULT_LOG_FILES;
    const limit = numberFrom(argValue('--limit'), 20);

    try {
        validateFiles(selectedFiles);
        const report = createLogReport({ rootDir: ROOT, files: selectedFiles, limit });
        if (SHOULD_JSON) console.log(JSON.stringify(report));
        else printHuman(report);
        if (report.parseErrorCount > 0) process.exitCode = 2;
    } catch (err) {
        if (SHOULD_JSON) console.log(JSON.stringify({ ok: false, error: err.message }));
        else console.error(err.message);
        process.exitCode = 1;
    }
}

main();
