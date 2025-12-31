(() => {
    // Update this to your deployed Netlify function URL when using GitHub Pages.
    const PROXY_ENDPOINT = 'https://benevolent-pony-8b208c.netlify.app/.netlify/functions/strava';
    const CACHE_KEY = 'stravaRunsCache_v1';
    const CACHE_TTL_MS = 1000 * 60 * 15;

    const statusEl = document.getElementById('status');
    const loadButton = document.getElementById('load-data');
    const clearButton = document.getElementById('clear-cache');
    const binSizeSelect = document.getElementById('bin-size');
    const histogramEl = document.getElementById('histogram');
    const histogramNoteEl = document.getElementById('histogram-note');
    const recentListEl = document.getElementById('recent-list');

    const statTotalRunsEl = document.getElementById('stat-total-runs');
    const statTotalMilesEl = document.getElementById('stat-total-miles');
    const statAverageDistanceEl = document.getElementById('stat-average-distance');
    const statAveragePaceEl = document.getElementById('stat-average-pace');

    let currentRuns = [];

    const formatNumber = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 1
    });

    const formatCount = new Intl.NumberFormat('en-US');

    const setStatus = (message, state) => {
        statusEl.textContent = message;
        statusEl.className = 'status-pill';
        if (state) {
            statusEl.classList.add(`is-${state}`);
        }
    };

    const computeSummary = (runs) => {
        const totalRuns = runs.length;
        const totalMiles = runs.reduce((sum, run) => sum + run.distanceMiles, 0);
        const totalTime = runs.reduce((sum, run) => sum + run.movingTime, 0);
        const averageDistance = totalRuns ? totalMiles / totalRuns : 0;
        const averagePace = totalMiles ? totalTime / totalMiles : 0;

        return {
            totalRuns,
            totalMiles,
            averageDistance,
            averagePace
        };
    };

    const formatPace = (secondsPerMile) => {
        if (!secondsPerMile || !Number.isFinite(secondsPerMile)) {
            return '--';
        }

        let minutes = Math.floor(secondsPerMile / 60);
        let seconds = Math.round(secondsPerMile % 60);
        if (seconds === 60) {
            minutes += 1;
            seconds = 0;
        }
        const paddedSeconds = seconds.toString().padStart(2, '0');
        return `${minutes}:${paddedSeconds} / mi`;
    };

    const formatRunMeta = (run) => {
        const date = new Date(run.startDate);
        const dateLabel = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        return `${formatNumber.format(run.distanceMiles)} mi | ${dateLabel}`;
    };

    const updateStats = (summary, hasData) => {
        if (!hasData) {
            statTotalRunsEl.textContent = '--';
            statTotalMilesEl.textContent = '--';
            statAverageDistanceEl.textContent = '--';
            statAveragePaceEl.textContent = '--';
            return;
        }

        statTotalRunsEl.textContent = formatCount.format(summary.totalRuns || 0);
        statTotalMilesEl.textContent = `${formatNumber.format(summary.totalMiles || 0)} mi`;
        statAverageDistanceEl.textContent = `${formatNumber.format(summary.averageDistance || 0)} mi`;
        statAveragePaceEl.textContent = formatPace(summary.averagePace);
    };

    const updateRecentRuns = (runs) => {
        recentListEl.innerHTML = '';

        if (!runs.length) {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = 'No runs loaded yet.';
            recentListEl.appendChild(emptyItem);
            return;
        }

        const recentRuns = [...runs]
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
            .slice(0, 6);

        recentRuns.forEach((run) => {
            const item = document.createElement('li');
            const title = document.createElement('div');
            title.className = 'recent-title';
            title.textContent = run.name;
            const meta = document.createElement('div');
            meta.className = 'recent-meta';
            meta.textContent = formatRunMeta(run);
            item.appendChild(title);
            item.appendChild(meta);
            recentListEl.appendChild(item);
        });
    };

    const buildHistogramBins = (runs, binSize) => {
        if (!runs.length) {
            return [];
        }

        const maxDistance = Math.max(...runs.map((run) => run.distanceMiles));
        const binCount = Math.max(1, Math.ceil(maxDistance / binSize));
        const bins = Array.from({ length: binCount }, (_, index) => ({
            start: index * binSize,
            end: (index + 1) * binSize,
            count: 0
        }));

        runs.forEach((run) => {
            const index = Math.min(Math.floor(run.distanceMiles / binSize), binCount - 1);
            bins[index].count += 1;
        });

        return bins;
    };

    const createSvgElement = (tag, attributes = {}) => {
        const svgElement = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attributes).forEach(([key, value]) => {
            svgElement.setAttribute(key, value);
        });
        return svgElement;
    };

    const renderHistogram = (runs) => {
        histogramEl.innerHTML = '';

        if (!runs.length) {
            histogramNoteEl.textContent = 'Add Strava data to populate the chart.';
            return;
        }

        const binSize = parseFloat(binSizeSelect.value);
        const bins = buildHistogramBins(runs, binSize);
        const maxCount = Math.max(...bins.map((bin) => bin.count), 1);

        const width = 800;
        const height = 320;
        const padding = { top: 20, right: 20, bottom: 48, left: 52 };
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;

        const svg = createSvgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'presentation'
        });

        const gridCount = 4;
        for (let i = 0; i <= gridCount; i += 1) {
            const y = padding.top + innerHeight - (innerHeight * (i / gridCount));
            const line = createSvgElement('line', {
                x1: padding.left,
                x2: width - padding.right,
                y1: y,
                y2: y,
                stroke: '#e0e4f0'
            });
            svg.appendChild(line);

            const label = createSvgElement('text', {
                x: padding.left - 10,
                y: y + 4,
                'text-anchor': 'end',
                fill: '#5c667c',
                'font-size': '12'
            });
            label.textContent = Math.round(maxCount * (i / gridCount));
            svg.appendChild(label);
        }

        const slotWidth = innerWidth / bins.length;
        const barWidth = Math.max(8, slotWidth - 6);

        bins.forEach((bin, index) => {
            const barHeight = (bin.count / maxCount) * innerHeight;
            const x = padding.left + (slotWidth * index) + (slotWidth - barWidth) / 2;
            const y = padding.top + innerHeight - barHeight;

            const rect = createSvgElement('rect', {
                x,
                y,
                width: barWidth,
                height: barHeight,
                rx: 4,
                fill: '#344d8d'
            });
            svg.appendChild(rect);

            const labelStep = bins.length <= 12 ? 1 : bins.length <= 24 ? 2 : 3;
            if (index % labelStep === 0) {
                const label = createSvgElement('text', {
                    x: x + barWidth / 2,
                    y: height - padding.bottom + 18,
                    'text-anchor': 'middle',
                    fill: '#4f5a70',
                    'font-size': '11'
                });
                const start = bin.start.toFixed(binSize < 1 ? 1 : 0);
                const end = bin.end.toFixed(binSize < 1 ? 1 : 0);
                label.textContent = `${start}-${end}`;
                svg.appendChild(label);
            }
        });

        const axis = createSvgElement('line', {
            x1: padding.left,
            x2: width - padding.right,
            y1: padding.top + innerHeight,
            y2: padding.top + innerHeight,
            stroke: '#b6bfd3'
        });
        svg.appendChild(axis);

        const yAxis = createSvgElement('line', {
            x1: padding.left,
            x2: padding.left,
            y1: padding.top,
            y2: padding.top + innerHeight,
            stroke: '#b6bfd3'
        });
        svg.appendChild(yAxis);

        histogramEl.appendChild(svg);
        histogramNoteEl.textContent = `${formatCount.format(runs.length)} runs across ${bins.length} bins.`;
    };

    const renderDashboard = (runs) => {
        currentRuns = runs;
        const summary = computeSummary(runs);
        updateStats(summary, runs.length > 0);
        updateRecentRuns(runs);
        renderHistogram(runs);
    };

    const saveCache = (runs) => {
        const payload = {
            timestamp: Date.now(),
            runs
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    };

    const loadCache = () => {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) {
            return null;
        }

        try {
            const parsed = JSON.parse(cached);
            if (!parsed.timestamp || !Array.isArray(parsed.runs)) {
                return null;
            }
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
                return null;
            }
            return parsed.runs;
        } catch (error) {
            return null;
        }
    };

    const clearCache = () => {
        localStorage.removeItem(CACHE_KEY);
    };

    const loadData = async ({ preferCache }) => {
        const cachedRuns = preferCache ? loadCache() : null;
        if (cachedRuns) {
            renderDashboard(cachedRuns);
            setStatus('Loaded cached data.', 'success');
            if (preferCache) {
                return;
            }
        }

        setStatus('Fetching Strava activities...', 'loading');

        try {
            const response = await fetch(PROXY_ENDPOINT);
            if (!response.ok) {
                throw new Error('Unable to fetch Strava data');
            }
            const data = await response.json();
            if (data && data.error) {
                throw new Error(data.error);
            }
            if (!data || !Array.isArray(data.runs)) {
                throw new Error('Strava proxy response missing runs');
            }
            saveCache(data.runs);
            renderDashboard(data.runs);
            setStatus('Strava data loaded.', 'success');
        } catch (error) {
            setStatus(error.message || 'Something went wrong loading Strava data.', 'error');
        }
    };

    loadButton.addEventListener('click', () => {
        loadData({ preferCache: false });
    });

    clearButton.addEventListener('click', () => {
        clearCache();
        renderDashboard([]);
        setStatus('Cache cleared.', 'success');
    });

    binSizeSelect.addEventListener('change', () => {
        renderHistogram(currentRuns);
    });

    renderDashboard([]);
    const cachedRuns = loadCache();
    if (cachedRuns) {
        renderDashboard(cachedRuns);
        setStatus('Loaded cached data.', 'success');
    } else {
        setStatus('Ready to load Strava data.', null);
    }
})();
