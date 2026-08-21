const crypto = require('crypto');
const { connectBlobs } = require('../lib/strava-cache');
const {
    RunValidationError,
    upsertShortcutRuns
} = require('../lib/runs-store');

const MAX_BODY_BYTES = 1024 * 1024;
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
};

const jsonResponse = (statusCode, body, headers = {}) => ({
    statusCode,
    headers: {
        ...jsonHeaders,
        ...headers
    },
    body: JSON.stringify(body)
});

const getHeader = (headers, name) => {
    const target = name.toLowerCase();
    const entry = Object.entries(headers || {})
        .find(([key]) => key.toLowerCase() === target);
    return entry ? entry[1] : '';
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

const isAuthorized = (event, expectedToken) => {
    const authorization = getHeader(event.headers, 'authorization');
    const match = typeof authorization === 'string'
        ? authorization.match(/^Bearer\s+(.+)$/i)
        : null;
    const suppliedToken = match ? match[1].trim() : '';

    return crypto.timingSafeEqual(
        sha256(suppliedToken),
        sha256(expectedToken)
    );
};

const parseRequestBody = (event) => {
    const encodedBody = event.body || '';
    const body = event.isBase64Encoded
        ? Buffer.from(encodedBody, 'base64').toString('utf8')
        : encodedBody;

    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        throw new RunValidationError('Request body is too large');
    }

    let payload;
    try {
        payload = JSON.parse(body);
    } catch (error) {
        throw new RunValidationError('Request body must be valid JSON');
    }

    return Array.isArray(payload) ? payload : payload && payload.runs;
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'POST' });
    }

    const expectedToken = process.env.HEALTH_RUNS_INGEST_TOKEN;
    if (!expectedToken) {
        console.error('HEALTH_RUNS_INGEST_TOKEN is not configured');
        return jsonResponse(500, { error: 'Run ingestion is not configured' });
    }

    if (!isAuthorized(event, expectedToken)) {
        return jsonResponse(
            401,
            { error: 'Unauthorized' },
            { 'WWW-Authenticate': 'Bearer' }
        );
    }

    try {
        const runs = parseRequestBody(event);
        await connectBlobs(event);

        const { database, stats } = await upsertShortcutRuns(runs);

        return jsonResponse(200, {
            ok: true,
            accepted: runs.length,
            ...stats,
            totalRuns: database.runs.length,
            updatedAt: database.updatedAt
        });
    } catch (error) {
        if (error instanceof RunValidationError) {
            return jsonResponse(400, { error: error.message });
        }

        console.error('Health runs ingestion failed:', error);
        return jsonResponse(500, { error: 'Could not save runs' });
    }
};
