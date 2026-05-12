const { refreshRunsCache } = require('../lib/strava-cache');

exports.handler = async () => {
    try {
        const payload = await refreshRunsCache();
        console.log(`Refreshed Strava cache with ${payload.runs.length} runs at ${payload.updatedAt}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                ok: true,
                runs: payload.runs.length,
                updatedAt: payload.updatedAt
            })
        };
    } catch (error) {
        console.error('Scheduled Strava cache refresh failed:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({
                ok: false,
                error: error.message || 'Unexpected error'
            })
        };
    }
};
