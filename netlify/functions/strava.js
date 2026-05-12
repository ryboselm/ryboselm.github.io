const {
    readCachedRuns,
    refreshRunsCache
} = require('../lib/strava-cache');

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
        let payload = await readCachedRuns();
        let source = 'cache';

        if (!payload) {
            payload = await refreshRunsCache();
            source = 'strava';
        }

        return {
            statusCode: 200,
            headers: {
                ...jsonHeaders,
                'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
            },
            body: JSON.stringify({
                ...payload,
                source
            })
        };
    } catch (error) {
        console.error('Strava function error:', error);
        return {
            statusCode: 500,
            headers: jsonHeaders,
            body: JSON.stringify({ error: error.message || 'Unexpected error' })
        };
    }
};
