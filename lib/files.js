const fs = require('fs');
const path = require('path');

function walk(dir, { skipDirs = new Set(['node_modules']), output = [], visited = new Set() } = {}) {
    if (!fs.existsSync(dir)) return output;
    let stat;
    try {
        stat = fs.statSync(dir);
    } catch {
        return output;
    }
    const key = `${stat.dev}:${stat.ino}`;
    if (visited.has(key)) return output;
    visited.add(key);

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return output;
    }
    for (const entry of entries) {
        if (skipDirs.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath, { skipDirs, output, visited });
        else output.push(fullPath);
    }
    return output;
}

function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function ensureDirExists(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

module.exports = { walk, readTextIfExists, ensureDirExists };
