const MAGIC_BYTES = {
    '.png': [0x89, 0x50, 0x4e, 0x47],
    '.jpg': [0xff, 0xd8, 0xff],
    '.jpeg': [0xff, 0xd8, 0xff],
    '.gif': [0x47, 0x49, 0x46],
    '.webp': [0x52, 0x49, 0x46, 0x46],
    '.wasm': [0x00, 0x61, 0x73, 0x6d],
    '.woff': [0x77, 0x4f, 0x46, 0x46],
    '.woff2': [0x77, 0x4f, 0x46, 0x32],
    '.ktx': [0xab, 0x4b, 0x54, 0x58],
    '.ktx2': [0xab, 0x4b, 0x54, 0x58]
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

const TEXT_EXTS = new Set(['.html', '.js', '.mjs', '.json', '.css', '.txt']);

const DEFAULT_ASSET_EXTS = [
    'avif', 'bin', 'css', 'eot', 'gif', 'html', 'ico', 'jpg', 'jpeg', 'js', 'json',
    'ktx', 'ktx2', 'map', 'mjs', 'mov', 'mp3', 'mp4', 'mpd', 'otf', 'pdf', 'png',
    'svg', 'ttf', 'vtt', 'wasm', 'wav', 'webm', 'webp', 'woff', 'woff2', 'xml', 'zip'
];

const CMS_ASSET_EXTS = [
    ...DEFAULT_ASSET_EXTS,
    'm3u8',
    'm4s',
    'ts'
];

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.otf': 'font/opentype',
    '.ttf': 'font/ttf',
    '.bin': 'application/octet-stream',
    '.ktx': 'image/ktx',
    '.ktx2': 'image/ktx2',
    '.zip': 'application/zip',
    '.xml': 'application/xml',
    '.pdf': 'application/pdf',
    '.vtt': 'text/vtt',
    '.map': 'application/json',
    '.eot': 'application/vnd.ms-fontobject',
    '.mpd': 'application/dash+xml'
};

module.exports = { MAGIC_BYTES, IMAGE_EXTS, TEXT_EXTS, DEFAULT_ASSET_EXTS, CMS_ASSET_EXTS, MIME_TYPES };
