const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { walk } = require('./files');

const MANIFEST_SCHEMA_VERSION = 1;

function sortedUnique(values = []) {
    return [...new Set(values)].sort();
}

function hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function hashFileAsync(filePath) {
    const data = await fs.promises.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
}

function shouldIncludeFile(relativePath) {
    const name = path.basename(relativePath);
    if (/^\.mirror-manifest.*\.json(?:\.tmp)?$/.test(name)) return false;
    if (/^\.mirror-progress.*\.json(?:\.tmp)?$/.test(name)) return false;
    return true;
}

function createFileInventory(scanDir) {
    if (!fs.existsSync(scanDir)) return [];

    return walk(scanDir)
        .map(filePath => {
            const relativePath = path.relative(scanDir, filePath).replace(/\\/g, '/');
            if (!shouldIncludeFile(relativePath)) return null;

            const stat = fs.statSync(filePath);
            return {
                path: relativePath,
                bytes: stat.size,
                sha256: hashFile(filePath)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.path.localeCompare(b.path));
}

async function createFileInventoryAsync(scanDir, { concurrency = 32 } = {}) {
    try {
        await fs.promises.access(scanDir);
    } catch {
        return [];
    }

    const allFiles = walk(scanDir);
    const results = [];
    for (let i = 0; i < allFiles.length; i += concurrency) {
        const chunk = allFiles.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
            chunk.map(async filePath => {
                const relativePath = path.relative(scanDir, filePath).replace(/\\/g, '/');
                if (!shouldIncludeFile(relativePath)) return null;
                const stat = await fs.promises.stat(filePath);
                const sha256 = await hashFileAsync(filePath);
                return { path: relativePath, bytes: stat.size, sha256 };
            })
        );
        results.push(...chunkResults);
    }

    return results
        .filter(Boolean)
        .sort((a, b) => a.path.localeCompare(b.path));
}

function createMirrorManifest({
    tool,
    targetHost,
    mirrorName,
    startPath,
    cmsMediaHost,
    completed = true,
    stats = {},
    resources = [],
    pending = [],
    files = [],
    scannedUniqueResources = 0,
    generatedAt = new Date().toISOString()
}) {
    const resourceList = sortedUnique(resources);
    const pendingList = sortedUnique(pending);
    const fileList = [...files].sort((a, b) => String(a.path).localeCompare(String(b.path)));
    const fileBytes = fileList.reduce((sum, file) => sum + (Number.isFinite(file.bytes) ? file.bytes : 0), 0);

    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        generatedAt,
        tool,
        completed,
        targetHost,
        mirrorName,
        startPath,
        cmsMediaHost,
        stats,
        scannedUniqueResources,
        resourceCount: resourceList.length,
        pendingCount: pendingList.length,
        fileCount: fileList.length,
        fileBytes,
        resources: resourceList,
        pending: pendingList,
        files: fileList
    };
}

function writeMirrorManifest(filePath, manifest) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    try {
        fs.renameSync(tmp, filePath);
    } catch {
        fs.copyFileSync(tmp, filePath);
        try { fs.unlinkSync(tmp); } catch {}
    }
}

function summarizeMirrorManifest(filePath, { rootDir = path.dirname(filePath) } = {}) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');

    try {
        const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            path: relativePath,
            ok: true,
            schemaVersion: manifest.schemaVersion,
            generatedAt: manifest.generatedAt,
            tool: manifest.tool,
            completed: manifest.completed === true,
            targetHost: manifest.targetHost,
            mirrorName: manifest.mirrorName,
            resourceCount: Number.isFinite(manifest.resourceCount) ? manifest.resourceCount : null,
            pendingCount: Number.isFinite(manifest.pendingCount) ? manifest.pendingCount : null,
            fileCount: Number.isFinite(manifest.fileCount) ? manifest.fileCount : null,
            fileBytes: Number.isFinite(manifest.fileBytes) ? manifest.fileBytes : null,
            scannedUniqueResources: Number.isFinite(manifest.scannedUniqueResources) ? manifest.scannedUniqueResources : null,
            stats: manifest.stats && typeof manifest.stats === 'object' ? manifest.stats : {}
        };
    } catch (err) {
        return {
            path: relativePath,
            ok: false,
            error: err.message
        };
    }
}

function verifyMirrorManifest(filePath, { scanDir = path.dirname(filePath) } = {}) {
    const report = {
        manifestPath: filePath,
        scanDir,
        ok: false,
        checked: 0,
        missing: [],
        changed: [],
        extra: [],
        error: null
    };

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        report.error = err.message;
        return report;
    }

    if (!Array.isArray(manifest.files)) {
        report.error = 'manifest does not contain a files array';
        return report;
    }

    const currentFiles = createFileInventory(scanDir);
    const currentByPath = new Map(currentFiles.map(file => [file.path, file]));
    const expectedByPath = new Map();

    for (const file of manifest.files) {
        if (!file || typeof file.path !== 'string') continue;
        expectedByPath.set(file.path, file);
        const current = currentByPath.get(file.path);
        if (!current) {
            report.missing.push({ path: file.path });
            continue;
        }

        report.checked++;
        if (current.bytes !== file.bytes || current.sha256 !== file.sha256) {
            report.changed.push({
                path: file.path,
                expectedBytes: file.bytes,
                actualBytes: current.bytes,
                expectedSha256: file.sha256,
                actualSha256: current.sha256
            });
        }
    }

    for (const file of currentFiles) {
        if (!expectedByPath.has(file.path)) {
            report.extra.push(file);
        }
    }

    report.ok = !report.error && report.missing.length === 0 && report.changed.length === 0 && report.extra.length === 0;
    return report;
}

module.exports = {
    MANIFEST_SCHEMA_VERSION,
    createFileInventory,
    createFileInventoryAsync,
    createMirrorManifest,
    summarizeMirrorManifest,
    verifyMirrorManifest,
    writeMirrorManifest
};
