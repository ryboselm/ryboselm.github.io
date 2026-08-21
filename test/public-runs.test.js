const assert = require('node:assert/strict');
const test = require('node:test');
const { createPublicRunsPayload } = require('../netlify/lib/public-runs');

test('public run payload contains only fields displayed by the dashboard', () => {
    const payload = createPublicRunsPayload({
        updatedAt: '2026-08-21T05:01:00.000Z',
        source: 'database+legacy-cache',
        runs: [{
            id: 'private-id',
            name: 'Home route',
            description: 'Private notes',
            distanceMiles: 5.5,
            movingTime: 2700,
            startDate: '2026-08-20T12:00:00.000Z',
            localDate: '2026-08-20',
            endDate: '2026-08-20T12:45:00.000Z',
            elevationGain: 100,
            source: 'Strava',
            sources: ['Strava'],
            ingestedAt: '2026-08-21T05:01:00.000Z'
        }]
    });

    assert.deepEqual(payload, {
        runs: [{
            distanceMiles: 5.5,
            movingTime: 2700,
            date: '2026-08-20',
            elevationGain: 100
        }],
        updatedAt: '2026-08-21T05:01:00.000Z'
    });
    assert.equal(JSON.stringify(payload).includes('Home route'), false);
    assert.equal(JSON.stringify(payload).includes('Private notes'), false);
    assert.equal(JSON.stringify(payload).includes('private-id'), false);
    assert.equal(JSON.stringify(payload).includes('12:00:00'), false);
});
