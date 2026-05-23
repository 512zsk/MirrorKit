const path = require('path');

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

function isInsidePath(rootDir, candidatePath) {
    const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeJoin(rootDir, unsafePath) {
    if (typeof unsafePath !== 'string') return null;
    if (unsafePath.includes('\0')) return null;

    let normalized = unsafePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')) return null;

    const parts = normalized.split('/').filter(Boolean);
    if (parts.some(part => part === '..')) return null;

    const localPath = path.join(rootDir, ...parts);
    return isInsidePath(rootDir, localPath) ? localPath : null;
}

function mirrorRoot(rootDir, mirrorName) {
    return path.join(rootDir, mirrorName);
}

module.exports = { safeDecodeURIComponent, isInsidePath, safeJoin, mirrorRoot };
