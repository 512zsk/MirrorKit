const { fetchWithTimeout } = require('./fetch');

function shouldRetryStatus(status) {
    return status === 429 || status >= 500;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetries(url, {
    timeoutMs = 30000,
    referer,
    cookie,
    retries = 2,
    baseDelayMs = 250,
    fetchFn = fetchWithTimeout,
    waitFn = wait,
    method,
    body,
    headers,
    duplex,
    redirect
} = {}) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetchFn(url, { timeoutMs, referer, cookie, method, body, headers, duplex, redirect });
            if (response.ok || !shouldRetryStatus(response.status) || attempt === retries) {
                return response;
            }
        } catch (err) {
            lastError = err;
            if (attempt === retries) throw err;
        }

        await waitFn(baseDelayMs * Math.pow(2, attempt));
    }

    throw lastError || new Error('fetch failed');
}

module.exports = { fetchWithRetries, shouldRetryStatus, wait };
