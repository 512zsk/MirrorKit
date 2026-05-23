const fs = require('fs');
const path = require('path');
const { loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { isInsidePath, mirrorRoot } = require('../lib/paths');
const { verifyMirrorManifest } = require('../lib/manifest');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);
const args = new Set(process.argv.slice(2));
const SHOULD_JSON = args.has('--json') || args.has('--json-log');
const SHOULD_CMS = args.has('--cms');

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit manifest verifier

Usage:
  node tools\\verify-manifest.js [--config <file>] [--cms] [--json] [manifest-file-or-mirror-folder]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --cms           Verify .mirror-manifest-cms.json for the configured mirror folder.
  --json          Print machine-readable JSON output.
  -h, --help      Show this help.

By default, this verifies <mirrorName>\\.mirror-manifest.json.
Pass a manifest file path to verify a specific manifest.
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

function resolveManifestPath(targetArg) {
    if (!targetArg) {
        return path.join(mirrorRoot(ROOT, CONFIG.mirrorName), SHOULD_CMS ? '.mirror-manifest-cms.json' : '.mirror-manifest.json');
    }

    const resolved = path.resolve(ROOT, targetArg);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        return path.join(resolved, '.mirror-manifest.json');
    }

    return resolved;
}

function printHuman(report) {
    if (report.error) {
        console.error(`Manifest verification failed: ${report.error}`);
        return;
    }

    console.log(`Manifest: ${report.manifestPath}`);
    console.log(`Mirror folder: ${report.scanDir}`);
    console.log(`Checked files: ${report.checked}`);
    console.log(`Missing files: ${report.missing.length}`);
    console.log(`Changed files: ${report.changed.length}`);
    console.log(`Extra files: ${report.extra.length}`);

    if (report.missing.length) {
        console.log('\nMissing files:');
        for (const item of report.missing.slice(0, 50)) console.log(item.path);
    }

    if (report.changed.length) {
        console.log('\nChanged files:');
        for (const item of report.changed.slice(0, 50)) {
            console.log(`${item.path}\texpected=${item.expectedSha256}\tactual=${item.actualSha256}`);
        }
    }

    if (report.extra.length) {
        console.log('\nExtra files:');
        for (const item of report.extra.slice(0, 50)) console.log(item.path);
    }

    console.log('');
    console.log(report.ok ? 'Manifest verification passed.' : 'Manifest verification failed.');
}

function main() {
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    const manifestPath = resolveManifestPath(positionalArgs(process.argv.slice(2))[0]);
    const scanDir = path.dirname(manifestPath);
    if (!isInsidePath(ROOT, manifestPath) || !isInsidePath(ROOT, scanDir)) {
        console.error(`Refusing to verify outside project: ${manifestPath}`);
        process.exitCode = 1;
        return;
    }

    if (!fs.existsSync(manifestPath)) {
        const report = {
            manifestPath,
            scanDir,
            ok: false,
            checked: 0,
            missing: [],
            changed: [],
            extra: [],
            error: 'manifest file not found'
        };
        if (SHOULD_JSON) console.log(JSON.stringify(report));
        else printHuman(report);
        process.exitCode = 1;
        return;
    }

    const report = verifyMirrorManifest(manifestPath, { scanDir });
    if (SHOULD_JSON) console.log(JSON.stringify(report));
    else printHuman(report);

    if (!report.ok) process.exitCode = report.error ? 1 : 2;
}

main();
