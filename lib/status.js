const path = require('path');
const { runDoctor } = require('./doctor');
const { createLogReport } = require('./log-report');
const { verifyMirrorManifest } = require('./manifest');
const { mirrorRoot } = require('./paths');
const { createMirrorReport } = require('./report');

function makeCheck(name, status, message, details = {}) {
    return { name, status, message, details };
}

function statusFromBoolean(ok, passMessage, failMessage) {
    return ok
        ? { status: 'pass', message: passMessage }
        : { status: 'fail', message: failMessage };
}

function verifyManifests(scanDir, manifests) {
    return manifests
        .filter(manifest => manifest.ok)
        .map(manifest => verifyMirrorManifest(path.join(scanDir, manifest.path), { scanDir }));
}

function commandWithConfig(config, command) {
    return config.configPath ? `${command} --config "${config.configPath}"` : command;
}

function createSuggestions({ config, checks, mirror, logs, manifestVerifications }) {
    const suggestions = [];
    const byName = new Map(checks.map(check => [check.name, check]));

    if (byName.get('doctor')?.status === 'fail') {
        suggestions.push({
            reason: 'Environment or configuration check failed.',
            command: commandWithConfig(config, 'node tools\\doctor.js')
        });
    }

    if (byName.get('mirror-folder')?.status === 'warn') {
        suggestions.push({
            reason: 'Mirror folder is missing; run a dry run first to confirm targets.',
            command: commandWithConfig(config, 'node tools\\mirror-assets.js --dry-run')
        });
    }

    if (mirror.exists && mirror.invalidCount > 0) {
        suggestions.push({
            reason: 'Invalid cached assets were found.',
            command: commandWithConfig(config, 'node tools\\validate-assets.js')
        });
        suggestions.push({
            reason: 'Retry invalid cached assets after reviewing validation output.',
            command: commandWithConfig(config, 'node tools\\mirror-assets.js --retry-bad')
        });
    }

    if (mirror.exists && mirror.manifestCount === 0) {
        suggestions.push({
            reason: 'No manifest exists yet; run a complete mirror pass to create one.',
            command: commandWithConfig(config, 'node tools\\mirror-assets.js')
        });
    }

    if (manifestVerifications.some(report => !report.ok)) {
        suggestions.push({
            reason: 'Manifest does not match current files.',
            command: commandWithConfig(config, 'node tools\\verify-manifest.js')
        });
    }

    if (logs.parseErrorCount > 0 || (logs.bySeverity.error || 0) > 0 || (logs.bySeverity.warn || 0) > 0) {
        suggestions.push({
            reason: 'Logs contain warnings, errors, or malformed lines.',
            command: 'node tools\\logs.js'
        });
    }

    const exportReady = suggestions.length === 0
        && mirror.exists
        && mirror.invalidCount === 0
        && mirror.manifestCount > 0
        && manifestVerifications.length > 0
        && manifestVerifications.every(report => report.ok)
        && byName.get('doctor')?.status === 'pass';

    if (exportReady) {
        suggestions.push({
            reason: 'Mirror looks ready; export a self-contained offline project.',
            command: commandWithConfig(config, 'node tools\\export-standalone.js --check')
        });
    }

    return suggestions;
}

async function createStatusReport(rootDir, config, { logLimit = 20 } = {}) {
    const doctor = await runDoctor(rootDir, config, { createMirrorDir: false });
    const scanDir = mirrorRoot(rootDir, config.mirrorName);
    const mirror = createMirrorReport(scanDir, { rootDir });
    const logs = createLogReport({ rootDir, limit: logLimit });
    const manifestVerifications = mirror.exists ? verifyManifests(scanDir, mirror.manifests) : [];

    const checks = [];
    checks.push(makeCheck(
        'doctor',
        doctor.ok ? 'pass' : 'fail',
        doctor.ok ? 'Environment checks passed.' : `Doctor failed: ${doctor.failed} failed check(s).`,
        { failed: doctor.failed, warned: doctor.warned }
    ));

    checks.push(makeCheck(
        'mirror-folder',
        mirror.exists ? 'pass' : 'warn',
        mirror.exists ? `Mirror folder exists: ${scanDir}` : `Mirror folder does not exist yet: ${scanDir}`
    ));

    if (mirror.exists) {
        const invalid = statusFromBoolean(
            mirror.invalidCount === 0,
            'No invalid cached assets found.',
            `Invalid cached assets found: ${mirror.invalidCount}`
        );
        checks.push(makeCheck('invalid-assets', invalid.status, invalid.message, {
            invalid: mirror.invalid.slice(0, 20)
        }));

        checks.push(makeCheck(
            'manifest-present',
            mirror.manifestCount > 0 ? 'pass' : 'warn',
            mirror.manifestCount > 0 ? `Manifest files found: ${mirror.manifestCount}` : 'No manifest file found yet.'
        ));

        const brokenManifests = mirror.manifests.filter(manifest => !manifest.ok);
        if (brokenManifests.length) {
            checks.push(makeCheck('manifest-parse', 'fail', `Invalid manifest files: ${brokenManifests.length}`, {
                manifests: brokenManifests
            }));
        }

        if (manifestVerifications.length) {
            const failed = manifestVerifications.filter(item => !item.ok);
            checks.push(makeCheck(
                'manifest-verify',
                failed.length ? 'fail' : 'pass',
                failed.length ? `Manifest verification failed: ${failed.length}` : 'Manifest verification passed.',
                { failed }
            ));
        }
    }

    checks.push(makeCheck(
        'logs-parse',
        logs.parseErrorCount ? 'warn' : 'pass',
        logs.parseErrorCount ? `Malformed log lines found: ${logs.parseErrorCount}` : 'Logs parsed successfully.',
        { parseErrors: logs.parseErrors.slice(0, 20) }
    ));

    const logErrorCount = logs.bySeverity.error || 0;
    checks.push(makeCheck(
        'logs-errors',
        logErrorCount ? 'warn' : 'pass',
        logErrorCount ? `Log errors found: ${logErrorCount}` : 'No error events found in logs.',
        { errors: logs.errors.slice(-20) }
    ));

    const failed = checks.filter(check => check.status === 'fail').length;
    const warned = checks.filter(check => check.status === 'warn').length;
    const suggestions = createSuggestions({ config, checks, mirror, logs, manifestVerifications });

    return {
        ok: failed === 0,
        failed,
        warned,
        config: {
            configPath: config.configPath,
            targetHost: config.targetHost,
            mirrorName: config.mirrorName,
            startPath: config.startPath,
            port: config.port,
            autoPort: config.autoPort
        },
        checks,
        doctor,
        mirror,
        logs,
        manifestVerifications,
        suggestions
    };
}

module.exports = {
    createStatusReport,
    createSuggestions,
    makeCheck,
    verifyManifests
};
