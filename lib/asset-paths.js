const path = require('path');
const { safeDecodeURIComponent, safeJoin, mirrorRoot } = require('./paths');

function targetHostName(targetHost) {
    return new URL(targetHost).hostname;
}

function isAbsoluteHttpUrl(value) {
    return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

function localPathForAsset(assetPath, {
    rootDir,
    mirrorName,
    targetHost,
    routeToIndex = false
}) {
    const root = mirrorRoot(rootDir, mirrorName);

    if (isAbsoluteHttpUrl(assetPath)) {
        let url;
        try {
            url = new URL(assetPath);
        } catch {
            return null;
        }

        const pathname = safeDecodeURIComponent(url.pathname.replace(/^\/+/, ''));
        if (pathname === null) return null;

        const relativePath = url.hostname === targetHostName(targetHost)
            ? (pathname || 'index.html')
            : path.posix.join(url.hostname, pathname || 'index.html');

        return safeJoin(root, relativePath);
    }

    const cleanPath = safeDecodeURIComponent(String(assetPath || '').replace(/^\/+/, ''));
    if (cleanPath === null) return null;

    const finalPath = routeToIndex && !path.extname(cleanPath)
        ? path.posix.join(cleanPath, 'index.html')
        : cleanPath;

    return safeJoin(root, finalPath || 'index.html');
}

function remoteUrlForAsset(assetPath, targetHost) {
    if (isAbsoluteHttpUrl(assetPath)) {
        return assetPath;
    }
    return `${targetHost}/${String(assetPath || '').replace(/^\/+/, '')}`;
}

module.exports = { isAbsoluteHttpUrl, localPathForAsset, remoteUrlForAsset, targetHostName };
