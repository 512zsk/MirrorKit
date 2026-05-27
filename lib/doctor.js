const fs = require('fs');
const net = require('net');
const path = require('path');
const { validateMirrorConfig } = require('./config');
const { mirrorRoot } = require('./paths');

function makeCheck(name, status, message, details = {}) {
    return { name, status, message, details };
}

function nodeVersionCheck(version = process.versions.node) {
    const major = Number(String(version).replace(/^v/, '').split('.')[0]);
    if (Number.isFinite(major) && major >= 18) {
        return makeCheck('node-version', 'pass', `Node.js ${version}`);
    }
    return makeCheck('node-version', 'fail', `Node.js ${version || 'unknown'} is too old. MirrorKit requires Node.js 18 or newer.`);
}

function configCheck(config) {
    const problems = validateMirrorConfig(config);
    if (!problems.length) {
        return makeCheck('config', 'pass', `Config OK: ${config.configPath}`);
    }
    return makeCheck('config', 'fail', 'Configuration has problems.', { problems });
}

function requiredFilesCheck(rootDir, files = ['index.html', 'server.js', 'tools/mirror-assets.js']) {
    const missing = files.filter(file => !fs.existsSync(path.join(rootDir, file)));
    if (!missing.length) {
        return makeCheck('required-files', 'pass', 'Required project files exist.');
    }
    return makeCheck('required-files', 'fail', 'Required project files are missing.', { missing });
}

function firstExistingParent(dir) {
    let current = path.resolve(dir);
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
    return current;
}

function mirrorWriteCheck(rootDir, config, { create = true } = {}) {
    const dir = mirrorRoot(rootDir, config.mirrorName);
    const probeDir = create ? dir : firstExistingParent(dir);

    if (!probeDir) {
        return makeCheck('mirror-write', 'fail', `No existing parent folder found for mirror folder: ${dir}`);
    }

    const probe = path.join(probeDir, `.mirrorkit-doctor-${process.pid}.tmp`);

    try {
        if (create) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(probe, 'ok');
        fs.rmSync(probe, { force: true });
        if (fs.existsSync(dir)) {
            return makeCheck('mirror-write', 'pass', `Mirror folder is writable: ${dir}`);
        }
        return makeCheck('mirror-write', 'warn', `Mirror folder does not exist yet; parent folder is writable: ${probeDir}`);
    } catch (err) {
        return makeCheck('mirror-write', 'fail', `Mirror folder is not writable: ${dir}`, { error: err.message });
    }
}

function portAvailable(port, host = '127.0.0.1') {
    return new Promise(resolve => {
        if (!Number.isFinite(Number(port)) || Number(port) <= 0) {
            resolve(false);
            return;
        }

        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(Number(port), host);
    });
}

async function portCheck(config) {
    const host = config.host || '127.0.0.1';
    const available = await portAvailable(config.port, host);
    if (available) {
        return makeCheck('port', 'pass', `Port ${config.port} is available on ${host}.`);
    }
    if (config.autoPort) {
        return makeCheck('port', 'warn', `Port ${config.port} is not available on ${host}; auto-port is enabled and startup will try the next available port.`);
    }
    return makeCheck('port', 'fail', `Port ${config.port} is not available on ${host}.`);
}

async function runDoctor(rootDir, config, options = {}) {
    const checks = [
        nodeVersionCheck(options.nodeVersion),
        configCheck(config),
        requiredFilesCheck(rootDir, options.requiredFiles),
        mirrorWriteCheck(rootDir, config, { create: options.createMirrorDir !== false }),
        await portCheck(config)
    ];

    const failed = checks.filter(check => check.status === 'fail').length;
    const warned = checks.filter(check => check.status === 'warn').length;

    return {
        ok: failed === 0,
        failed,
        warned,
        checks
    };
}

module.exports = {
    configCheck,
    makeCheck,
    mirrorWriteCheck,
    nodeVersionCheck,
    portAvailable,
    portCheck,
    requiredFilesCheck,
    runDoctor
};
