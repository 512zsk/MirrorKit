const path = require('path');
const { MAGIC_BYTES, IMAGE_EXTS } = require('./constants');

function isHtmlLike(buffer) {
    const limit = Math.min(buffer.length, 2048);
    const head = buffer.subarray(0, limit).toString('utf8').trimStart().toLowerCase();
    return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body');
}

function hasMagic(buffer, magic) {
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

function hasExpectedMagic(filePath, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    const magic = MAGIC_BYTES[ext];
    if (!magic) return true;
    if (buffer.length < magic.length) return false;
    return magic.every((byte, index) => buffer[index] === byte);
}

function isValidDownload(localPath, response, buffer, options = {}) {
    const {
        strictTextHtmlFallback = false,
        imageExts = IMAGE_EXTS,
        magicBytes = MAGIC_BYTES
    } = options;

    const ext = path.extname(localPath).toLowerCase();
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (isHtmlLike(buffer) && ext !== '.html' && ext !== '' && ext !== '.svg') {
        return false;
    }

    if (ext === '.json') {
        try {
            JSON.parse(buffer.toString('utf8'));
            return true;
        } catch {
            return false;
        }
    }

    if (ext === '.js' || ext === '.mjs') {
        if (contentType.includes('text/html')) return false;
        if (isHtmlLike(buffer)) return false;
        return true;
    }

    if (ext === '.css') {
        if (contentType.includes('text/html')) return false;
        if (isHtmlLike(buffer)) return false;
        return true;
    }

    if (imageExts.has(ext) && contentType.startsWith('image/')) {
        return true;
    }

    const magic = magicBytes[ext];
    if (magic) return hasMagic(buffer, magic);

    if (strictTextHtmlFallback) {
        return !contentType.includes('text/html');
    }

    return true;
}

module.exports = { isHtmlLike, hasMagic, hasExpectedMagic, isValidDownload };
