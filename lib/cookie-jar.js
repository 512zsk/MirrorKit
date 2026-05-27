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
        hostOnly: true,
        path: '/',
        expires: null,
        maxAge: null,
        secure: false,
        httpOnly: false,
        sameSite: null
    };

    let hasDomainAttr = false;

    for (let i = 1; i < parts.length; i++) {
        const [attrName, ...attrValueParts] = parts[i].split('=');
        const attr = attrName.trim().toLowerCase();
        const attrValue = attrValueParts.join('=').trim();

        switch (attr) {
            case 'domain':
                hasDomainAttr = true;
                cookie.domain = (attrValue || '').replace(/^\./, '').toLowerCase();
                break;
            case 'path':
                cookie.path = attrValue || '/';
                break;
            case 'expires':
                if (attrValue) {
                    const parsed = new Date(attrValue);
                    cookie.expires = isNaN(parsed.getTime()) ? null : parsed.toISOString();
                }
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

    // RFC 6265 §5.3: if Domain attribute was explicitly set, cookie is not host-only
    if (hasDomainAttr) {
        cookie.hostOnly = false;
    }

    if (cookie.maxAge !== null) {
        // RFC 6265 §5.2.2: max-age <= 0 means "expire immediately"
        cookie.expires = cookie.maxAge > 0
            ? new Date(Date.now() + cookie.maxAge * 1000).toISOString()
            : new Date(0).toISOString();
    }

    cookies.push(cookie);
    return cookies;
}

const MAX_COOKIES = 500;

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

    _evictExpired() {
        for (const [key, cookie] of this.cookies) {
            if (this._isExpired(cookie)) this.cookies.delete(key);
        }
    }

    addCookie(cookie) {
        if (this._isExpired(cookie)) return;
        if (this.cookies.size >= MAX_COOKIES) {
            this._evictExpired();
            if (this.cookies.size >= MAX_COOKIES) {
                // Evict oldest entry if still at limit
                const firstKey = this.cookies.keys().next().value;
                if (firstKey) this.cookies.delete(firstKey);
            }
        }
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

            // RFC 6265 §5.4: domain matching
            if (cookie.hostOnly) {
                // Host-only cookies match only the exact hostname
                if (hostname !== cookie.domain) continue;
            } else {
                // Domain cookies match the domain and all subdomains
                const cd = cookie.domain;
                if (hostname !== cd && !hostname.endsWith('.' + cd)) continue;
            }

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
        try {
            fs.renameSync(tmp, filePath);
        } catch {
            fs.copyFileSync(tmp, filePath);
            try { fs.unlinkSync(tmp); } catch {}
        }
    }
}

/**
 * Extract Set-Cookie values from a fetch Response.
 * Uses getSetCookie() when available (returns array), falls back to get('set-cookie').
 */
function getSetCookieValues(response) {
    if (typeof response.headers.getSetCookie === 'function') {
        return response.headers.getSetCookie();
    }
    const single = response.headers.get('set-cookie');
    return single ? [single] : [];
}

module.exports = { CookieJar, parseCookies, getSetCookieValues };
