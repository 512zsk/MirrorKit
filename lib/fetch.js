const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchWithTimeout(url, { timeoutMs = 30000, referer, userAgent = DEFAULT_USER_AGENT } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': userAgent,
                Referer: referer || url
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { fetchWithTimeout };
