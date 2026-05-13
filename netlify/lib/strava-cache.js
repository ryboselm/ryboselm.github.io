const API_BASE = 'https://www.strava.com/api/v3';
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const METER_TO_MILE = 0.000621371;
const MAX_ACTIVITIES = 2000;
const TOKEN_EXPIRY_BUFFER_SECONDS = 120;
const CACHE_STORE = 'strava';
const CACHE_KEY = 'runs';

let cachedToken = null;
let cachedExpiresAt = 0;

const getEnv = (key) => process.env[key];

const truncateBody = (value, maxLength = 500) => {
    if (!value || typeof value !== 'string') {
        return '';
    }
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength)}...`;
};

const readResponseBody = async (response) => {
    try {
        const data = await response.json();
        return truncateBody(JSON.stringify(data));
    } catch (error) {
        try {
            const text = await response.text();
            return truncateBody(text);
        } catch (innerError) {
            return '';
        }
    }
};

const getAccessToken = async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedExpiresAt - TOKEN_EXPIRY_BUFFER_SECONDS > nowSeconds) {
        return cachedToken;
    }

    const clientId = getEnv('STRAVA_CLIENT_ID');
    const clientSecret = getEnv('STRAVA_CLIENT_SECRET');
    const refreshToken = getEnv('STRAVA_REFRESH_TOKEN');

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, or STRAVA_REFRESH_TOKEN');
    }

    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const body = await readResponseBody(response);
        throw new Error(`Strava token refresh failed (${response.status}): ${body || response.statusText}`);
    }

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('Strava token response missing access_token');
    }

    cachedToken = data.access_token;
    cachedExpiresAt = data.expires_at || nowSeconds + 3600;

    return data.access_token;
};

const fetchActivities = async (accessToken) => {
    let page = 1;
    const perPage = 200;
    const activities = [];

    while (activities.length < MAX_ACTIVITIES) {
        const response = await fetch(
            `${API_BASE}/athlete/activities?per_page=${perPage}&page=${page}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        if (!response.ok) {
            const body = await readResponseBody(response);
            throw new Error(`Strava activities failed (${response.status}): ${body || response.statusText}`);
        }

        const pageData = await response.json();
        activities.push(...pageData);

        if (pageData.length < perPage) {
            break;
        }

        page += 1;
    }

    return activities;
};

const normalizeRuns = (activities) => activities
    .filter((activity) => RUN_TYPES.has(activity.type))
    .map((activity) => ({
        id: activity.id,
        name: activity.name || 'Untitled Run',
        description: activity.description || '',
        distanceMiles: (activity.distance || 0) * METER_TO_MILE,
        movingTime: activity.moving_time || 0,
        startDate: activity.start_date,
        elevationGain: activity.total_elevation_gain || 0
    }));

const connectBlobs = async (event) => {
    if (!event || !event.blobs) {
        return;
    }

    const { connectLambda } = await import('@netlify/blobs');
    connectLambda(event);
};

const getCacheStore = async () => {
    const { getStore } = await import('@netlify/blobs');
    return getStore(CACHE_STORE);
};

const readCachedRuns = async () => {
    const store = await getCacheStore();
    const cached = await store.get(CACHE_KEY, { type: 'json' });

    if (!cached || !Array.isArray(cached.runs)) {
        return null;
    }

    return cached;
};

const writeCachedRuns = async (payload) => {
    const store = await getCacheStore();
    await store.setJSON(CACHE_KEY, payload);
    return payload;
};

const fetchFreshRuns = async () => {
    const accessToken = await getAccessToken();
    const activities = await fetchActivities(accessToken);
    const runs = normalizeRuns(activities);

    return {
        runs,
        updatedAt: new Date().toISOString()
    };
};

const refreshRunsCache = async () => {
    const payload = await fetchFreshRuns();
    await writeCachedRuns(payload);
    return payload;
};

module.exports = {
    connectBlobs,
    fetchFreshRuns,
    readCachedRuns,
    refreshRunsCache,
    writeCachedRuns
};
