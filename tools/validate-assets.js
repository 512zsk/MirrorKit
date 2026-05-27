const fs = require('fs');
const path = require('path');
const { walk } = require('../lib/files');
const { loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { isInsidePath, mirrorRoot } = require('../lib/paths');
const { validateCachedFile } = require('../lib/report');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit cache validator

Usage:
  node tools\\validate-assets.js [--config <file>] [mirror-folder]

Options:
  --config <file> Use a config file other than mirror.config.json.
  -h, --help      Show this help.

By default, this checks the folder configured by mirrorName.
`);
    process.exit(0);
}

function validateFile(filePath) {
    return validateCachedFile(filePath, { rootDir: ROOT });
}

function main() {
    if (CONFIG.configFileError) {
        console.error(`Config error: ${CONFIG.configFileError}`);
        process.exitCode = 1;
        return;
    }
    if (CONFIG.configFileMissing) {
        console.error(`Config file not found: ${CONFIG.configPath}`);
        process.exitCode = 1;
        return;
    }
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    const positional = [];
    const rawArgs = process.argv.slice(2);
    for (let index = 0; index < rawArgs.length; index++) {
        const arg = rawArgs[index];
        if (arg === '--config') {
            index++;
            continue;
        }
        if (arg.startsWith('--config=')) continue;
        if (!arg.startsWith('--')) positional.push(arg);
    }
    const targetArg = positional[0];
    const scanDir = targetArg ? path.resolve(ROOT, targetArg) : mirrorRoot(ROOT, CONFIG.mirrorName);

    if (!isInsidePath(ROOT, scanDir)) {
        console.error(`Refusing to scan outside project: ${scanDir}`);
        process.exit(1);
    }

    if (!fs.existsSync(scanDir)) {
        console.error(`scan directory not found: ${path.relative(ROOT, scanDir) || scanDir}`);
        process.exit(1);
    }

    const bad = [];
    for (const filePath of walk(scanDir)) {
        const reason = validateFile(filePath);
        if (reason) {
            bad.push({ reason, filePath });
        }
    }

    if (!bad.length) {
        console.log(`No invalid cached assets found in ${path.relative(ROOT, scanDir) || '.'}.`);
        return;
    }

    for (const item of bad) {
        console.log(`${item.reason}\t${path.relative(ROOT, item.filePath)}`);
    }
    console.log(`\nInvalid cached assets: ${bad.length}`);
    process.exitCode = 2;
}

main();
