const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_FILES = [
    path.join('logs', 'mirrorkit-server.log.1'),
    path.join('logs', 'mirrorkit-server.log'),
    path.join('logs', 'mirrorkit-tools.log.1'),
    path.join('logs', 'mirrorkit-tools.log')
];

function normalizeSeverity(event) {
    const value = String(event.level || event.type || '').toLowerCase();
    if (value === 'error') return 'error';
    if (value === 'warn' || value === 'warning') return 'warn';
    if (value === 'success') return 'success';
    if (value === 'cache') return 'cache';
    if (value === 'info' || value === 'status' || value === 'summary' || value === 'dry-run' || value === 'result' || value === 'log') return value;
    return value || 'unknown';
}

function eventTime(event) {
    const time = Date.parse(event.timestamp || event.time || event.savedAt || '');
    return Number.isFinite(time) ? time : 0;
}

function summarizeEvent(event, source, lineNumber) {
    const severity = normalizeSeverity(event);
    return {
        timestamp: event.timestamp || null,
        severity,
        source,
        lineNumber,
        message: event.message || event.assetPath || event.type || event.level || '',
        details: event.details || null,
        type: event.type || null,
        level: event.level || null
    };
}

function readLogFile(filePath, { source = filePath } = {}) {
    const result = {
        filePath,
        source,
        exists: fs.existsSync(filePath),
        events: [],
        parseErrors: []
    };

    if (!result.exists) return result;

    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line) continue;

        try {
            const event = JSON.parse(line);
            result.events.push(summarizeEvent(event, source, index + 1));
        } catch (err) {
            result.parseErrors.push({
                lineNumber: index + 1,
                message: err.message
            });
        }
    }

    return result;
}

function createLogReport({
    rootDir = process.cwd(),
    files = DEFAULT_LOG_FILES,
    limit = 20
} = {}) {
    const resolvedFiles = files.map(file => ({
        source: file,
        filePath: path.resolve(rootDir, file)
    }));

    const fileReports = resolvedFiles.map(file => readLogFile(file.filePath, { source: file.source }));
    const events = fileReports.flatMap(file => file.events);
    const parseErrors = fileReports.flatMap(file => file.parseErrors.map(error => ({ ...error, source: file.source })));
    const bySeverity = {};

    for (const event of events) {
        bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    }

    const important = events
        .filter(event => event.severity === 'error' || event.severity === 'warn')
        .sort((a, b) => eventTime(a) - eventTime(b));

    const recent = events
        .slice()
        .sort((a, b) => eventTime(a) - eventTime(b))
        .slice(-limit);

    return {
        ok: parseErrors.length === 0,
        files: fileReports.map(file => ({
            path: file.source,
            exists: file.exists,
            events: file.events.length,
            parseErrors: file.parseErrors.length
        })),
        eventCount: events.length,
        parseErrorCount: parseErrors.length,
        bySeverity,
        errors: important.filter(event => event.severity === 'error').slice(-limit),
        warnings: important.filter(event => event.severity === 'warn').slice(-limit),
        recent,
        parseErrors
    };
}

module.exports = {
    DEFAULT_LOG_FILES,
    createLogReport,
    normalizeSeverity,
    readLogFile
};
