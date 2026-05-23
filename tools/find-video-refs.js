const fs = require('fs');
const path = require('path');
const { TEXT_EXTS } = require('../lib/constants');
const { walk } = require('../lib/files');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
    console.log(`MirrorKit video reference finder

Usage:
  node tools\\find-video-refs.js

Options:
  -h, --help      Show this help.

This scans local text files and prints video references. It does not download files.
`);
    process.exit(0);
}

const VIDEO_RE = /["'`]([^"'`]+?\.(?:mp4|webm|mov|m3u8)(?:\?[^"'`]*)?)["'`]/gi;

for (const filePath of walk(ROOT)) {
    if (filePath.includes(`${path.sep}tools${path.sep}`)) continue;
    if (!TEXT_EXTS.has(path.extname(filePath).toLowerCase())) continue;

    const text = fs.readFileSync(filePath, 'utf8');
    const matches = [...new Set([...text.matchAll(VIDEO_RE)].map(match => match[1]))];
    if (!matches.length) continue;

    console.log(`\n${path.relative(ROOT, filePath)}: ${matches.length}`);
    for (const item of matches.slice(0, 200)) {
        console.log(item);
    }
}
