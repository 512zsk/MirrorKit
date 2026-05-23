const fs = require('fs');
const path = require('path');
const { MAGIC_BYTES } = require('./constants');
const { walk } = require('./files');
const { isHtmlLike, hasMagic } = require('./validation');
const { summarizeMirrorManifest } = require('./manifest');

const JSON_EXTS = new Set(['.json']);
const TEXT_EXTS = new Set(['.html', '.js', '.css', '.svg', '.txt']);
const COMPATIBLE_FALLBACKS = new Set([]);

function validateCachedFile(filePath, { rootDir = process.cwd() } = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const buffer = fs.readFileSync(filePath);
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');

    if (!TEXT_EXTS.has(ext) && isHtmlLike(buffer)) {
        return 'html-fallback';
    }

    if (JSON_EXTS.has(ext)) {
        try {
            JSON.parse(buffer.toString('utf8'));
        } catch {
            return 'invalid-json';
        }
    }

    const magic = MAGIC_BYTES[ext];
    if (magic && COMPATIBLE_FALLBACKS.has(relativePath)) {
        return null;
    }

    if (magic && !hasMagic(buffer, magic)) {
        return 'bad-magic';
    }

    return null;
}

function emptyReport(scanDir) {
    return {
        scanDir,
        exists: false,
        files: 0,
        bytes: 0,
        byExtension: {},
        invalid: [],
        invalidCount: 0,
        manifests: [],
        manifestCount: 0,
        progressFiles: [],
        progressCount: 0,
        largestFiles: []
    };
}

function createMirrorReport(scanDir, { rootDir = process.cwd(), largestLimit = 10 } = {}) {
    if (!fs.existsSync(scanDir)) return emptyReport(scanDir);

    const report = emptyReport(scanDir);
    report.exists = true;

    for (const filePath of walk(scanDir)) {
        const stat = fs.statSync(filePath);
        const relativePath = path.relative(scanDir, filePath).replace(/\\/g, '/');
        const ext = path.extname(filePath).toLowerCase() || '(none)';

        report.files++;
        report.bytes += stat.size;
        report.byExtension[ext] = (report.byExtension[ext] || 0) + 1;

        if (path.basename(filePath).startsWith('.mirror-progress')) {
            report.progressFiles.push(relativePath);
        }

        if (/^\.mirror-manifest.*\.json$/.test(path.basename(filePath))) {
            report.manifests.push(summarizeMirrorManifest(filePath, { rootDir: scanDir }));
        }

        const reason = validateCachedFile(filePath, { rootDir });
        if (reason) {
            report.invalid.push({ reason, path: relativePath });
        }

        report.largestFiles.push({ path: relativePath, bytes: stat.size });
    }

    report.largestFiles.sort((a, b) => b.bytes - a.bytes);
    report.largestFiles = report.largestFiles.slice(0, largestLimit);
    report.invalidCount = report.invalid.length;
    report.manifestCount = report.manifests.length;
    report.progressCount = report.progressFiles.length;

    return report;
}

module.exports = { createMirrorReport, validateCachedFile };
