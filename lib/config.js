const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
    port: 3000,
    autoPort: false,
    targetHost: 'https://example.com',
    mirrorName: 'example.com',
    startPath: '/',
    requestTimeoutMs: 30000,
    concurrency: 6,
    maxPasses: 4,
    downloadRetries: 2,
    cmsMediaHost: 'https://storage.example.com/example-bucket',
    remoteMirrors: [],
    remoteAssetPrefixes: [],
    ignoredPathPrefixes: ['/.well-known/', '/bb-mcp'],
    sitePathPrefixes: ['content', 'etc.clientlibs', 'experiment', 'webui', 'auth', 'graphql']
};

function argValue(argv, name) {
    const eqPrefix = `${name}=`;
    const eqValue = argv.find(arg => arg.startsWith(eqPrefix));
    if (eqValue) return eqValue.slice(eqPrefix.length);

    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('-')) {
        return argv[index + 1];
    }

    return null;
}

function resolveConfigPath(rootDir, argv = process.argv.slice(2), env = process.env) {
    const value = argValue(argv, '--config') || env.MIRRORKIT_CONFIG || 'mirror.config.json';
    return path.resolve(rootDir, value);
}

function readConfigFile(configPath) {
    if (!fs.existsSync(configPath)) return { config: {}, exists: false, error: null };

    try {
        return { config: JSON.parse(fs.readFileSync(configPath, 'utf8')), exists: true, error: null };
    } catch (err) {
        return { config: {}, exists: true, error: err };
    }
}

function numberFrom(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function arrayFrom(value, fallback) {
    return Array.isArray(value) ? value : fallback;
}

function booleanFrom(value, fallback = false) {
    if (value === true || value === 'true' || value === '1' || value === 1) return true;
    if (value === false || value === 'false' || value === '0' || value === 0) return false;
    return fallback;
}

function loadMirrorConfig(rootDir, env = process.env, options = {}) {
    const argv = options.argv || process.argv.slice(2);
    const configPath = options.configPath ? path.resolve(rootDir, options.configPath) : resolveConfigPath(rootDir, argv, env);
    const isExplicitConfig = Boolean(options.configPath || argValue(argv, '--config') || env.MIRRORKIT_CONFIG);
    const fileState = readConfigFile(configPath);
    const fileConfig = fileState.config;

    return {
        configPath,
        configFileMissing: isExplicitConfig && !fileState.exists,
        configFileError: fileState.error ? fileState.error.message : null,
        port: numberFrom(env.PORT || argValue(argv, '--port') || fileConfig.port, DEFAULT_CONFIG.port),
        autoPort: argv.includes('--auto-port') || booleanFrom(env.MIRRORKIT_AUTO_PORT ?? fileConfig.autoPort, DEFAULT_CONFIG.autoPort),
        targetHost: env.TARGET_HOST || fileConfig.targetHost || DEFAULT_CONFIG.targetHost,
        mirrorName: env.MIRROR_NAME || fileConfig.mirrorName || DEFAULT_CONFIG.mirrorName,
        startPath: env.START_PATH || fileConfig.startPath || DEFAULT_CONFIG.startPath,
        requestTimeoutMs: numberFrom(
            env.PROXY_TIMEOUT_MS || env.MIRROR_TIMEOUT_MS || fileConfig.requestTimeoutMs,
            DEFAULT_CONFIG.requestTimeoutMs
        ),
        concurrency: numberFrom(env.MIRROR_CONCURRENCY || fileConfig.concurrency, DEFAULT_CONFIG.concurrency),
        maxPasses: numberFrom(env.MIRROR_MAX_PASSES || fileConfig.maxPasses, DEFAULT_CONFIG.maxPasses),
        downloadRetries: numberFrom(env.MIRROR_RETRIES || fileConfig.downloadRetries, DEFAULT_CONFIG.downloadRetries),
        cmsMediaHost: env.CMS_MEDIA_HOST || fileConfig.cmsMediaHost || DEFAULT_CONFIG.cmsMediaHost,
        remoteMirrors: arrayFrom(fileConfig.remoteMirrors, DEFAULT_CONFIG.remoteMirrors),
        remoteAssetPrefixes: arrayFrom(fileConfig.remoteAssetPrefixes, DEFAULT_CONFIG.remoteAssetPrefixes),
        ignoredPathPrefixes: arrayFrom(fileConfig.ignoredPathPrefixes, DEFAULT_CONFIG.ignoredPathPrefixes),
        sitePathPrefixes: arrayFrom(fileConfig.sitePathPrefixes, DEFAULT_CONFIG.sitePathPrefixes)
    };
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function validateMirrorConfig(config) {
    const problems = [];

    if (config.configFileMissing) {
        problems.push(`config file not found: ${config.configPath}`);
    }

    if (config.configFileError) {
        problems.push(`config file is not valid JSON: ${config.configPath}`);
    }

    if (!isHttpUrl(config.targetHost)) {
        problems.push('targetHost must be a valid http(s) URL.');
    }

    if (!config.mirrorName || /[\\/\0]/.test(config.mirrorName) || config.mirrorName === '.' || config.mirrorName === '..') {
        problems.push('mirrorName must be a folder name without slashes.');
    }

    if (!config.startPath || !config.startPath.startsWith('/')) {
        problems.push('startPath must start with "/".');
    }

    if (config.cmsMediaHost && !isHttpUrl(config.cmsMediaHost)) {
        problems.push('cmsMediaHost must be a valid http(s) URL.');
    }

    for (const [index, mirror] of config.remoteMirrors.entries()) {
        if (!mirror || typeof mirror !== 'object') {
            problems.push(`remoteMirrors[${index}] must be an object.`);
            continue;
        }
        if (!mirror.prefix || !mirror.prefix.startsWith('/')) {
            problems.push(`remoteMirrors[${index}].prefix must start with "/".`);
        }
        if (!isHttpUrl(mirror.origin)) {
            problems.push(`remoteMirrors[${index}].origin must be a valid http(s) URL.`);
        }
    }

    for (const [index, prefix] of config.ignoredPathPrefixes.entries()) {
        if (typeof prefix !== 'string' || !prefix.startsWith('/')) {
            problems.push(`ignoredPathPrefixes[${index}] must start with "/".`);
        }
    }

    for (const [index, prefix] of config.remoteAssetPrefixes.entries()) {
        if (typeof prefix !== 'string' || !isHttpUrl(prefix)) {
            problems.push(`remoteAssetPrefixes[${index}] must be a valid http(s) URL.`);
        }
    }

    return problems;
}

function printConfigProblems(problems, output = console.error) {
    if (!problems.length) return;
    output('Invalid MirrorKit configuration:');
    for (const problem of problems) {
        output(`- ${problem}`);
    }
}

module.exports = {
    DEFAULT_CONFIG,
    argValue,
    resolveConfigPath,
    readConfigFile,
    loadMirrorConfig,
    numberFrom,
    booleanFrom,
    validateMirrorConfig,
    printConfigProblems
};
