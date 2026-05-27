const path = require('path');

function isAssetUrl(value, assetExts) {
    try {
        const url = new URL(value);
        const ext = path.extname(decodeURIComponent(url.pathname)).toLowerCase().slice(1);
        return assetExts.includes(ext);
    } catch {
        return false;
    }
}

function normalizeAssetPath(rawPath, assetExts) {
    if (!rawPath) return null;

    let value = rawPath
        .replace(/\\\//g, '/')
        .replace(/^['"`]+|['"`]+$/g, '')
        .trim();

    if (!value || value.includes('${') || value.includes('`') || value.includes('\n') || value.includes('\r')) {
        return null;
    }

    if (value.startsWith('./') || value.startsWith('../')) return null;

    if (value.startsWith('//')) value = `https:${value}`;
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return isAssetUrl(value, assetExts) ? value : null;
    }

    if (value.startsWith('/')) value = value.slice(1);

    const clean = value.split('#')[0].split('?')[0];
    const ext = path.extname(clean).toLowerCase().slice(1);
    if (!assetExts.includes(ext)) return null;

    return clean;
}

function extractAssetPathsFromText(text, { assetExts = [], loosePrefixes = [] } = {}) {
    const output = new Set();
    const extGroup = assetExts.join('|');

    const patterns = [
        new RegExp('["\'`]([^"\'`]+?\\.(?:' + extGroup + ')(?:\\?[^"\'`]*)?)["\'`]', 'gi'),
        new RegExp('url\\(([^)]+?\\.(?:' + extGroup + ')(?:\\?[^)]*)?)\\)', 'gi'),
        new RegExp('(?:https?:\\/\\/[^"\'`\\s)]+|\\/[A-Za-z0-9_./%~@+\\-=]+)\\.(?:' + extGroup + ')(?:\\?[^"\'`\\s)]*)?', 'gi')
    ];

    for (const regex of patterns) {
        for (const match of text.matchAll(regex)) {
            const candidate = normalizeAssetPath(match[1] || match[0], assetExts);
            if (candidate) output.add(candidate);
        }
    }

    for (const prefix of loosePrefixes) {
        let cursor = 0;
        while (true) {
            const start = text.indexOf(prefix, cursor);
            if (start === -1) break;

            let end = start;
            while (end < text.length && !['"', "'", '<', '>', '\n', '\r'].includes(text[end])) {
                end++;
            }

            const candidate = text.slice(start, end).trim();
            if (isAssetUrl(candidate, assetExts)) output.add(candidate);
            cursor = end + 1;
        }
    }

    return output;
}

function extractAssetPathsFromJson(value, { assetExts = [], loosePrefixes = [] } = {}) {
    const output = new Set();

    function recurse(v) {
        if (Array.isArray(v)) {
            for (const item of v) recurse(item);
            return;
        }

        if (v && typeof v === 'object') {
            for (const item of Object.values(v)) recurse(item);
            return;
        }

        if (typeof v !== 'string') return;

        const direct = normalizeAssetPath(v, assetExts);
        if (direct) output.add(direct);

        for (const item of extractAssetPathsFromText(v, { assetExts, loosePrefixes })) {
            output.add(item);
        }
    }

    recurse(value);
    return output;
}

module.exports = { isAssetUrl, normalizeAssetPath, extractAssetPathsFromText, extractAssetPathsFromJson };
