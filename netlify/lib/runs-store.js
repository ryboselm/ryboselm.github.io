const crypto = require('crypto');

const STORE_NAME = 'runs-database';
const DATABASE_KEY = 'runs';
const SCHEMA_VERSION = 1;
const MAX_BATCH_SIZE = 500;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_DISTANCE_MILES = 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const GENERIC_RUN_NAMES = new Set(['', 'Run', 'Untitled Run']);

class RunValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RunValidationError';
    }
}

const createEmptyDatabase = () => ({
    schemaVersion: SCHEMA_VERSION,
    runs: [],
    updatedAt: null
});

const getRunsStore = async () => {
    const { getStore } = await import('@netlify/blobs');
    return getStore({
        name: STORE_NAME,
        consistency: 'strong'
    });
};

const readRunsDatabase = async () => {
    const store = await getRunsStore();
    const database = await store.get(DATABASE_KEY, {
        type: 'json',
        consistency: 'strong'
    });

    if (!database) {
        return createEmptyDatabase();
    }

    if (!Array.isArray(database.runs)) {
        throw new Error('Stored runs database is invalid');
    }

    return {
        schemaVersion: database.schemaVersion || SCHEMA_VERSION,
        runs: database.runs,
        updatedAt: database.updatedAt || null
    };
};

const writeRunsDatabase = async (database) => {
    const store = await getRunsStore();
    await store.setJSON(DATABASE_KEY, database);
    return database;
};

const parseIsoDate = (value, fieldName) => {
    if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
        throw new RunValidationError(`${fieldName} must be an ISO 8601 date with a timezone`);
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new RunValidationError(`${fieldName} is not a valid date`);
    }

    return new Date(timestamp).toISOString();
};

const makeRunId = (startDate) => {
    const hash = crypto
        .createHash('sha256')
        .update(`run|${startDate}`)
        .digest('hex')
        .slice(0, 24);

    return `run_${hash}`;
};

const normalizeShortcutRun = (run, index, now = new Date()) => {
    const label = `runs[${index}]`;

    if (!run || typeof run !== 'object' || Array.isArray(run)) {
        throw new RunValidationError(`${label} must be an object`);
    }

    if (!Number.isInteger(run.duration)
        || run.duration <= 0) {
        throw new RunValidationError(`${label}.duration must be a positive integer`);
    }

    if (typeof run.distance !== 'number'
        || !Number.isFinite(run.distance)
        || run.distance <= 0
        || run.distance > MAX_DISTANCE_MILES) {
        throw new RunValidationError(`${label}.distance must be a positive number of miles`);
    }

    if (typeof run.source !== 'string'
        || run.source.trim().length === 0
        || run.source.trim().length > 100) {
        throw new RunValidationError(`${label}.source must be between 1 and 100 characters`);
    }

    const startDate = parseIsoDate(run.start, `${label}.start`);
    const endDate = parseIsoDate(run.end, `${label}.end`);

    if (Date.parse(endDate) <= Date.parse(startDate)) {
        throw new RunValidationError(`${label}.end must be after its start`);
    }

    const elapsedSeconds = Math.round(
        (Date.parse(endDate) - Date.parse(startDate)) / 1000
    );
    if (elapsedSeconds > MAX_DURATION_SECONDS) {
        throw new RunValidationError(`${label} cannot span more than 7 days`);
    }

    const source = run.source.trim();

    return {
        id: makeRunId(startDate),
        name: 'Run',
        description: '',
        distanceMiles: run.distance,
        movingTime: elapsedSeconds,
        startDate,
        localDate: run.start.slice(0, 10),
        endDate,
        elevationGain: 0,
        source,
        sources: [source],
        ingestedAt: now.toISOString()
    };
};

const getSources = (run) => {
    const sources = Array.isArray(run.sources) ? [...run.sources] : [];
    if (typeof run.source === 'string' && run.source.trim()) {
        sources.push(run.source.trim());
    }
    return [...new Set(sources.filter((source) => typeof source === 'string' && source.trim()))];
};

const getMatchType = (existing, incoming) => {
    if (String(existing.id) === String(incoming.id)) {
        return 'exact';
    }

    const existingStart = Date.parse(existing.startDate);
    const incomingStart = Date.parse(incoming.startDate);
    if (!Number.isFinite(existingStart) || !Number.isFinite(incomingStart)) {
        return null;
    }

    const startDifferenceSeconds = Math.abs(existingStart - incomingStart) / 1000;
    if (startDifferenceSeconds === 0) {
        return 'exact';
    }

    if (startDifferenceSeconds > 120) {
        return null;
    }

    const existingDistance = Number(existing.distanceMiles);
    const incomingDistance = Number(incoming.distanceMiles);
    const distanceTolerance = Math.max(
        0.1,
        Math.max(existingDistance, incomingDistance) * 0.03
    );
    if (!Number.isFinite(existingDistance)
        || !Number.isFinite(incomingDistance)
        || Math.abs(existingDistance - incomingDistance) > distanceTolerance) {
        return null;
    }

    const existingDuration = Number(existing.movingTime);
    const incomingDuration = Number(incoming.movingTime);
    const durationTolerance = Math.max(
        300,
        Math.max(existingDuration, incomingDuration) * 0.1
    );
    if (!Number.isFinite(existingDuration)
        || !Number.isFinite(incomingDuration)
        || Math.abs(existingDuration - incomingDuration) > durationTolerance) {
        return null;
    }

    return 'fuzzy';
};

const chooseRunName = (existing, incoming) => {
    const existingName = typeof existing.name === 'string' ? existing.name : '';
    const incomingName = typeof incoming.name === 'string' ? incoming.name : '';

    if (!GENERIC_RUN_NAMES.has(existingName)) {
        return existingName;
    }
    if (!GENERIC_RUN_NAMES.has(incomingName)) {
        return incomingName;
    }
    return existingName || incomingName || 'Run';
};

const mergeRunRecords = (existing, incoming, matchType) => {
    const useIncomingCore = matchType === 'exact';
    const core = useIncomingCore ? incoming : existing;
    const sources = [...new Set([...getSources(existing), ...getSources(incoming)])];
    const existingDescription = typeof existing.description === 'string'
        ? existing.description
        : '';
    const incomingDescription = typeof incoming.description === 'string'
        ? incoming.description
        : '';

    return {
        ...existing,
        distanceMiles: core.distanceMiles,
        movingTime: core.movingTime,
        startDate: core.startDate,
        localDate: core.localDate || existing.localDate || incoming.localDate,
        endDate: core.endDate || existing.endDate || incoming.endDate,
        name: chooseRunName(existing, incoming),
        description: existingDescription || incomingDescription,
        elevationGain: Number(existing.elevationGain) || Number(incoming.elevationGain) || 0,
        source: existing.source || incoming.source,
        sources,
        ingestedAt: existing.ingestedAt || incoming.ingestedAt
    };
};

const comparableRun = (run) => JSON.stringify({
    id: run.id,
    name: run.name,
    description: run.description,
    distanceMiles: run.distanceMiles,
    movingTime: run.movingTime,
    startDate: run.startDate,
    localDate: run.localDate,
    endDate: run.endDate,
    elevationGain: run.elevationGain,
    source: run.source,
    sources: run.sources,
    ingestedAt: run.ingestedAt
});

const mergeRunCollections = (existingRuns, incomingRuns) => {
    const runs = existingRuns.map((run) => ({ ...run }));
    const stats = {
        inserted: 0,
        updated: 0,
        duplicates: 0
    };

    incomingRuns.forEach((incoming) => {
        let matchIndex = -1;
        let matchType = null;

        for (let index = 0; index < runs.length; index += 1) {
            const candidateMatchType = getMatchType(runs[index], incoming);
            if (candidateMatchType) {
                matchIndex = index;
                matchType = candidateMatchType;
                if (candidateMatchType === 'exact') {
                    break;
                }
            }
        }

        if (matchIndex === -1) {
            runs.push(incoming);
            stats.inserted += 1;
            return;
        }

        const merged = mergeRunRecords(runs[matchIndex], incoming, matchType);
        if (comparableRun(merged) === comparableRun(runs[matchIndex])) {
            stats.duplicates += 1;
        } else {
            runs[matchIndex] = merged;
            stats.updated += 1;
        }
    });

    runs.sort((first, second) => Date.parse(second.startDate) - Date.parse(first.startDate));

    return { runs, stats };
};

const normalizeShortcutRuns = (rawRuns, now = new Date()) => {
    if (!Array.isArray(rawRuns)) {
        throw new RunValidationError('The request must contain a runs array');
    }
    if (rawRuns.length === 0) {
        throw new RunValidationError('The runs array cannot be empty');
    }
    if (rawRuns.length > MAX_BATCH_SIZE) {
        throw new RunValidationError(`A request can contain at most ${MAX_BATCH_SIZE} runs`);
    }

    return rawRuns.map((run, index) => normalizeShortcutRun(run, index, now));
};

const upsertShortcutRuns = async (rawRuns, now = new Date()) => {
    const normalizedRuns = normalizeShortcutRuns(rawRuns, now);
    const database = await readRunsDatabase();
    const { runs, stats } = mergeRunCollections(database.runs, normalizedRuns);

    const nextDatabase = {
        schemaVersion: SCHEMA_VERSION,
        runs,
        updatedAt: now.toISOString()
    };

    if (stats.inserted > 0 || stats.updated > 0) {
        await writeRunsDatabase(nextDatabase);
    }

    return {
        database: stats.inserted > 0 || stats.updated > 0 ? nextDatabase : database,
        stats
    };
};

module.exports = {
    MAX_BATCH_SIZE,
    RunValidationError,
    getMatchType,
    makeRunId,
    mergeRunCollections,
    normalizeShortcutRun,
    normalizeShortcutRuns,
    readRunsDatabase,
    upsertShortcutRuns,
    writeRunsDatabase
};
