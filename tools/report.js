const path = require('path');
const { loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { isInsidePath, mirrorRoot } = require('../lib/paths');
const { createMirrorReport } = require('../lib/report');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);
const args = new Set(process.argv.slice(2));
const SHOULD_JSON = args.has('--json') || args.has('--json-log');

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit mirror report

Usage:
  node tools\\report.js [--config <file>] [--json] [mirror-folder]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --json          Print machine-readable JSON output.
  -h, --help      Show this help.

By default, this reports on the folder configured by mirrorName.
`);
    process.exit(0);
}

function positionalArgs(argv) {
    const output = [];
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--config') {
            index++;
            continue;
        }
        if (arg.startsWith('--config=')) continue;
        if (!arg.startsWith('--')) output.push(arg);
    }
    return output;
}

function printHuman(report) {
    if (!report.exists) {
        console.log(`Mirror folder not found: ${report.scanDir}`);
        return;
    }

    console.log(`Mirror folder: ${report.scanDir}`);
    console.log(`Files: ${report.files}`);
    console.log(`Bytes: ${report.bytes}`);
    console.log(`Invalid cached assets: ${report.invalidCount}`);
    console.log(`Manifests: ${report.manifestCount}`);
    console.log(`Progress files: ${report.progressCount}`);

    if (report.manifests.length) {
        console.log('\nManifests:');
        for (const manifest of report.manifests) {
            if (!manifest.ok) {
                console.log(`invalid\t${manifest.path}\t${manifest.error}`);
                continue;
            }

            console.log(`${manifest.tool || 'unknown'}\t${manifest.generatedAt || 'unknown'}\tresources=${manifest.resourceCount ?? 'unknown'}\tpending=${manifest.pendingCount ?? 'unknown'}\tfiles=${manifest.fileCount ?? 'unknown'}\tbytes=${manifest.fileBytes ?? 'unknown'}`);
        }
    }

    console.log('\nFile types:');
    for (const [ext, count] of Object.entries(report.byExtension).sort((a, b) => b[1] - a[1])) {
        console.log(`${ext}\t${count}`);
    }

    if (report.invalid.length) {
        console.log('\nInvalid assets:');
        for (const item of report.invalid.slice(0, 50)) {
            console.log(`${item.reason}\t${item.path}`);
        }
    }

    if (report.largestFiles.length) {
        console.log('\nLargest files:');
        for (const item of report.largestFiles) {
            console.log(`${item.bytes}\t${item.path}`);
        }
    }
}

function main() {
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    const targetArg = positionalArgs(process.argv.slice(2))[0];
    const scanDir = targetArg ? path.resolve(ROOT, targetArg) : mirrorRoot(ROOT, CONFIG.mirrorName);
    if (!isInsidePath(ROOT, scanDir)) {
        console.error(`Refusing to report outside project: ${scanDir}`);
        process.exitCode = 1;
        return;
    }

    const report = createMirrorReport(scanDir, { rootDir: ROOT });
    if (SHOULD_JSON) {
        console.log(JSON.stringify(report));
    } else {
        printHuman(report);
    }

    if (!report.exists || report.invalidCount > 0) {
        process.exitCode = report.exists ? 2 : 1;
    }
}

main();
