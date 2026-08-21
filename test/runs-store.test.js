const assert = require('node:assert/strict');
const test = require('node:test');
const {
    RunValidationError,
    mergeRunCollections,
    normalizeShortcutRun,
    normalizeShortcutRuns
} = require('../netlify/lib/runs-store');

const now = new Date('2026-08-20T18:00:00.000Z');
const shortcutRun = {
    duration: 1800,
    distance: 3.1,
    start: '2026-08-20T07:00:00-05:00',
    end: '2026-08-20T07:30:00-05:00',
    source: 'Strava'
};

test('normalizes the Shortcut payload into the runs page schema', () => {
    const run = normalizeShortcutRun(shortcutRun, 0, now);

    assert.match(run.id, /^run_[a-f0-9]{24}$/);
    assert.equal(run.distanceMiles, 3.1);
    assert.equal(run.movingTime, 1800);
    assert.equal(run.startDate, '2026-08-20T12:00:00.000Z');
    assert.equal(run.localDate, '2026-08-20');
    assert.equal(run.endDate, '2026-08-20T12:30:00.000Z');
    assert.equal(run.source, 'Strava');
});

test('derives elapsed seconds from the dates instead of the formatted Shortcut duration', () => {
    const run = normalizeShortcutRun({
        duration: 1,
        distance: 7.137318062514913,
        start: '2026-08-18T01:12:20-05:00',
        end: '2026-08-18T02:14:16-05:00',
        source: 'Strava'
    }, 0, now);

    assert.equal(run.movingTime, 3716);
});

test('repeated batches are counted as duplicates instead of inserted again', () => {
    const run = normalizeShortcutRun(shortcutRun, 0, now);
    const firstMerge = mergeRunCollections([], [run]);
    const secondMerge = mergeRunCollections(firstMerge.runs, [run]);

    assert.deepEqual(firstMerge.stats, {
        inserted: 1,
        updated: 0,
        duplicates: 0
    });
    assert.deepEqual(secondMerge.stats, {
        inserted: 0,
        updated: 0,
        duplicates: 1
    });
    assert.equal(secondMerge.runs.length, 1);
});

test('a corrected record with the same start time updates the existing run', () => {
    const original = normalizeShortcutRun(shortcutRun, 0, now);
    const corrected = normalizeShortcutRun({
        ...shortcutRun,
        distance: 3.2,
        duration: 30,
        end: '2026-08-20T07:30:15-05:00'
    }, 0, new Date('2026-08-20T19:00:00.000Z'));
    const result = mergeRunCollections([original], [corrected]);

    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].distanceMiles, 3.2);
    assert.equal(result.runs[0].movingTime, 1815);
    assert.equal(result.stats.updated, 1);
});

test('a near-identical historical record enriches rather than duplicates a run', () => {
    const healthRun = normalizeShortcutRun(shortcutRun, 0, now);
    const historicalRun = {
        id: 123456,
        name: 'Morning Run',
        description: 'Easy miles',
        distanceMiles: 3.12,
        movingTime: 1775,
        startDate: '2026-08-20T12:00:45.000Z',
        elevationGain: 42
    };
    const result = mergeRunCollections([healthRun], [historicalRun]);

    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].name, 'Morning Run');
    assert.equal(result.runs[0].description, 'Easy miles');
    assert.equal(result.runs[0].elevationGain, 42);
    assert.equal(result.runs[0].distanceMiles, 3.1);
});

test('nearby but distinct runs are kept separate', () => {
    const first = normalizeShortcutRun(shortcutRun, 0, now);
    const second = normalizeShortcutRun({
        ...shortcutRun,
        start: '2026-08-20T07:03:00-05:00',
        end: '2026-08-20T07:33:00-05:00'
    }, 1, now);
    const result = mergeRunCollections([first], [second]);

    assert.equal(result.runs.length, 2);
    assert.equal(result.stats.inserted, 1);
});

test('rejects malformed values before anything is stored', () => {
    assert.throws(
        () => normalizeShortcutRuns([{ ...shortcutRun, duration: 1800.5 }], now),
        RunValidationError
    );
    assert.throws(
        () => normalizeShortcutRuns([{ ...shortcutRun, start: '2026-08-20T12:00:00' }], now),
        /timezone/
    );
    assert.throws(
        () => normalizeShortcutRuns([{ ...shortcutRun, distance: -1 }], now),
        /positive number of miles/
    );
});
