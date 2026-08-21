const toPublicRun = (run) => ({
    distanceMiles: run.distanceMiles,
    movingTime: run.movingTime,
    date: run.localDate || run.startDate.slice(0, 10),
    elevationGain: run.elevationGain || 0
});

const createPublicRunsPayload = (payload) => ({
    runs: payload.runs.map(toPublicRun),
    updatedAt: payload.updatedAt || null
});

module.exports = {
    createPublicRunsPayload,
    toPublicRun
};
