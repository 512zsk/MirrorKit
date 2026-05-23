const path = require('path');
const { spawnSync } = require('child_process');
const { loadMirrorConfig, printConfigProblems, validateMirrorConfig } = require('../lib/config');
const { defaultStandaloneOutDir, exportStandaloneProject } = require('../lib/standalone-export');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = loadMirrorConfig(ROOT);
const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    console.log(`MirrorKit standalone exporter

Usage:
  node tools\\export-standalone.js [--config <file>] [--out <folder>] [--force] [--check]

Options:
  --config <file> Use a config file other than mirror.config.json.
  --out <folder>  Output folder. Defaults to exports\\<mirrorName>-offline.
  --force         Replace the output folder if it is empty or a previous standalone export.
  --check         Run the exported project's self-check after exporting.
  -h, --help      Show this help.

The exported folder contains only the offline project runtime and mirrored files.
It does not include MirrorKit crawler tools, tests, or library source.
`);
    process.exit(0);
}

function argValue(argv, name) {
    const eqPrefix = `${name}=`;
    const eqValue = argv.find(arg => arg.startsWith(eqPrefix));
    if (eqValue) return eqValue.slice(eqPrefix.length);

    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1];
    return null;
}

function runStandaloneCheck(outDir) {
    return spawnSync(process.execPath, ['server.js', '--check'], {
        cwd: outDir,
        encoding: 'utf8'
    });
}

function main() {
    const problems = validateMirrorConfig(CONFIG);
    if (problems.length) {
        printConfigProblems(problems);
        process.exitCode = 1;
        return;
    }

    const outArg = argValue(args, '--out');
    const outDir = outArg ? path.resolve(ROOT, outArg) : defaultStandaloneOutDir(ROOT, CONFIG.mirrorName);

    try {
        const result = exportStandaloneProject({
            rootDir: ROOT,
            config: CONFIG,
            outDir,
            force: argSet.has('--force')
        });

        console.log(`Standalone offline project exported: ${result.outDir}`);
        console.log(`Mirror entry: ${result.entryPath}`);
        console.log('Run it with:');
        console.log(`  cd ${path.relative(ROOT, result.outDir) || '.'}`);
        console.log('  start-windows.bat');
        console.log('  # or: sh start.sh');

        if (argSet.has('--check')) {
            const check = runStandaloneCheck(result.outDir);
            if (check.stdout.trim()) console.log(check.stdout.trim());
            if (check.stderr.trim()) console.error(check.stderr.trim());
            if (check.status !== 0) {
                process.exitCode = check.status || 1;
                return;
            }
            console.log('Standalone self-check passed.');
        }
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
    }
}

main();
