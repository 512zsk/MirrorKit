const fs = require('fs');
const path = require('path');

function parseCookies(setCookieHeader, requestUrl) {
    const cookies = [];
    if (!setCookieHeader) return cookies;

    const url = new URL(requestUrl);
    const parts = setCookieHeader.split(';').map(s => s.trim());
    if (!parts[0] || !parts[0].includes('=')) return cookies;

    const [name, ...valueParts] = parts[0].split('=');
    const cookie = {
        name: name.trim(),
        value: valueParts.join('=').trim(),
        domain: url.hostname,
        path: '/',
        expires: null,
        maxAge: null,
        secure: false,
        httpOnly: false,
        sameSite: null
    };

    for (let i = 1; i < parts.length; i++) {
        const [attrName, ...attrValueParts] = parts[i].split('=');
        const attr = attrName.trim().toLowerCase();
        const attrValue = attrValueParts.join('=').trim();

        switch (attr) {
            case 'domain':
                cookie.domain = (attrValue || '').replace(/^\./, '').toLowerCase();
                break;
            case 'path':
                cookie.path = attrValue || '/';
                break;
            case 'expires':
                cookie.expires = attrValue ? new Date(attrValue).toISOString() : null;
                break;
            case 'max-age':
                cookie.maxAge = attrValue ? parseInt(attrValue, 10) : null;
                break;
            case 'secure':
                cookie.secure = true;
                break;
            case 'httponly':
                cookie.httpOnly = true;
                break;
            case 'samesite':
                cookie.sameSite = attrValue || null;
                break;
        }
    }

    if (cookie.maxAge !== null && cookie.maxAge > 0) {
        cookie.expires = new Date(Date.now() + cookie.maxAge * 1000).toISOString();
    }

    cookies.push(cookie);
    return cookies;
}

class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    _key(cookie) {
        return `${cookie.domain};${cookie.path};${cookie.name}`;
    }

    _isExpired(cookie) {
        if (!cookie.expires) return false;
        return new Date(cookie.expires).getTime() <= Date.now();
    }

    addCookie(cookie) {
        if (this._isExpired(cookie)) return;
        this.cookies.set(this._key(cookie), { ...cookie });
    }

    getCookiesForUrl(url) {
        const parsed = new URL(url);
        const hostname = parsed.hostname;
        const pathname = parsed.pathname;
        const isSecure = parsed.protocol === 'https:';
        const now = Date.now();
        const matched = [];

        for (const cookie of this.cookies.values()) {
            if (cookie.expires && new Date(cookie.expires).getTime() <= now) continue;
            if (cookie.secure && !isSecure) continue;

            const domain = cookie.domain;
            const domainMatch = domain.startsWith('.')
                ? (hostname === domain.slice(1) || hostname.endsWith(domain))
                : hostname === domain;
            if (!domainMatch) continue;

            if (!pathname.startsWith(cookie.path)) continue;

            matched.push(`${cookie.name}=${cookie.value}`);
        }

        return matched.join('; ');
    }

    loadFromFile(filePath) {
        if (!fs.existsSync(filePath)) return;
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(data)) return;
            for (const cookie of data) {
                if (cookie && cookie.name && cookie.domain) {
                    this.addCookie(cookie);
                }
            }
        } catch {
            // ignore corrupt jar file
        }
    }

    saveToFile(filePath) {
        const cookies = [];
        for (const cookie of this.cookies.values()) {
            if (!this._isExpired(cookie)) {
                cookies.push(cookie);
            }
        }
        const tmp = filePath + '.tmp';
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(cookies, null, 2));
        fs.renameSync(tmp, filePath);
    }
}

module.exports = { CookieJar, parseCookies };
