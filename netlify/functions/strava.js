const {
    connectBlobs,
    readCachedRuns,
    refreshRunsCache
} = require('../lib/strava-cache');
const {
    mergeRunCollections,
    readRunsDatabase
} = require('../lib/runs-store');
const { createPublicRunsPayload } = require('../lib/public-runs');

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
};

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: jsonHeaders,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        await connectBlobs(event);

        const database = await readRunsDatabase();
        const cachedPayload = await readCachedRuns();
        let payload;

        if (database.runs.length > 0) {
            const cachedRuns = cachedPayload ? cachedPayload.runs : [];
            const { runs } = mergeRunCollections(database.runs, cachedRuns);

            payload = {
                runs,
                updatedAt: database.updatedAt || (cachedPayload && cachedPayload.updatedAt)
            };
        } else if (cachedPayload) {
            payload = cachedPayload;
        } else {
            payload = await refreshRunsCache();
        }

        const publicPayload = createPublicRunsPayload(payload);

        return {
            statusCode: 200,
            headers: {
                ...jsonHeaders,
                'Cache-Control': 'public, max-age=60, must-revalidate'
            },
            body: JSON.stringify(publicPayload)
        };
    } catch (error) {
        console.error('Strava function error:', error);
        return {
            statusCode: 500,
            headers: jsonHeaders,
            body: JSON.stringify({ error: 'Unable to load run data' })
        };
    }
};
