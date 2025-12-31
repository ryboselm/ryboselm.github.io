(() => {
    // Update this to your deployed Netlify function URL when using GitHub Pages.
    const PROXY_ENDPOINT = 'https://benevolent-pony-8b208c.netlify.app/.netlify/functions/strava';
    const CACHE_KEY = 'stravaRunsCache_v1';
    const CACHE_TTL_MS = 1000 * 60 * 15;
    const UNIT_STORAGE_KEY = 'stravaRunsUnit_v1';
    const PACE_FLOOR_SECONDS_PER_MILE = 223; // 3:43 / mi
    const METER_TO_FEET = 3.28084;
    const MILES_TO_KM = 1.60934;
    const UNIT_CONFIG = {
        imperial: {
            distanceLabel: 'mi',
            paceLabel: 'mi',
            elevationLabel: 'ft',
            distanceScale: 1,
            elevationScale: METER_TO_FEET,
            binOptions: [0.5, 1, 2, 5]
        },
        metric: {
            distanceLabel: 'km',
            paceLabel: 'km',
            elevationLabel: 'm',
            distanceScale: MILES_TO_KM,
            elevationScale: 1,
            binOptions: [1, 2, 5, 10]
        }
    };

    const statusEl = document.getElementById('status');
    const loadButton = document.getElementById('load-data');
    const clearButton = document.getElementById('clear-cache');
    const binSizeSelect = document.getElementById('bin-size');
    const binSizeLabel = document.querySelector('label[for="bin-size"]');
    const yearFilterSelect = document.getElementById('year-filter');
    const unitToggleButtons = document.querySelectorAll('.unit-toggle button');
    const histogramEl = document.getElementById('histogram');
    const histogramNoteEl = document.getElementById('histogram-note');
    const recentListEl = document.getElementById('recent-list');

    const statTotalRunsEl = document.getElementById('stat-total-runs');
    const statTotalMilesEl = document.getElementById('stat-total-miles');
    const statAverageDistanceEl = document.getElementById('stat-average-distance');
    const statAveragePaceEl = document.getElementById('stat-average-pace');
    const statLongestRunEl = document.getElementById('stat-longest-run');
    const statFastestPaceEl = document.getElementById('stat-fastest-pace');
    const statTotalElevationEl = document.getElementById('stat-total-elevation');
    const statRunsPerWeekEl = document.getElementById('stat-runs-per-week');

    let currentRuns = [];

    const formatNumber = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 1
    });

    const formatCount = new Intl.NumberFormat('en-US');
    const formatElevation = new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
    });

    let currentUnit = 'imperial';

    const setStatus = (message, state) => {
        statusEl.textContent = message;
        statusEl.className = 'status-pill';
        if (state) {
            statusEl.classList.add(`is-${state}`);
        }
    };

    const loadUnitPreference = () => {
        try {
            const stored = localStorage.getItem(UNIT_STORAGE_KEY);
            if (stored && UNIT_CONFIG[stored]) {
                currentUnit = stored;
            }
        } catch (error) {
            currentUnit = 'imperial';
        }
    };

    const getUnitConfig = () => UNIT_CONFIG[currentUnit];

    const updateUnitButtons = () => {
        unitToggleButtons.forEach((button) => {
            const isActive = button.dataset.unit === currentUnit;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    const updateBinOptions = (preserveValue = true) => {
        const unitConfig = getUnitConfig();
        const previousUnit = binSizeSelect.dataset.unit;
        const currentValue = parseFloat(binSizeSelect.value);
        let desiredValue = currentValue;

        if (preserveValue && previousUnit && UNIT_CONFIG[previousUnit]) {
            const previousScale = UNIT_CONFIG[previousUnit].distanceScale;
            desiredValue = currentValue * previousScale / unitConfig.distanceScale;
        }

        binSizeSelect.innerHTML = '';
        unitConfig.binOptions.forEach((value) => {
            const option = document.createElement('option');
            option.value = value.toString();
            option.textContent = `${value} ${unitConfig.distanceLabel}`;
            binSizeSelect.appendChild(option);
        });

        const closest = unitConfig.binOptions.reduce((best, value) => {
            if (desiredValue === undefined || Number.isNaN(desiredValue)) {
                return best;
            }
            return Math.abs(value - desiredValue) < Math.abs(best - desiredValue) ? value : best;
        }, unitConfig.binOptions[0]);

        binSizeSelect.value = closest.toString();
        binSizeSelect.dataset.unit = currentUnit;
        if (binSizeLabel) {
            binSizeLabel.textContent = `Bin size (${unitConfig.distanceLabel})`;
        }
    };

    const setUnit = (unit, { persist = true } = {}) => {
        if (!UNIT_CONFIG[unit]) {
            return;
        }
        currentUnit = unit;
        updateUnitButtons();
        updateBinOptions(true);
        if (persist) {
            try {
                localStorage.setItem(UNIT_STORAGE_KEY, unit);
            } catch (error) {
                // ignore localStorage failures
            }
        }
        renderDashboard(currentRuns);
    };

    const formatDistanceValue = (distanceMiles) => {
        const unitConfig = getUnitConfig();
        return formatNumber.format(distanceMiles * unitConfig.distanceScale);
    };

    const formatDistance = (distanceMiles) => {
        const unitConfig = getUnitConfig();
        return `${formatDistanceValue(distanceMiles)} ${unitConfig.distanceLabel}`;
    };

    const formatElevationValue = (elevationMeters) => {
        const unitConfig = getUnitConfig();
        return `${formatElevation.format(elevationMeters * unitConfig.elevationScale)} ${unitConfig.elevationLabel}`;
    };

    const formatPaceSeconds = (secondsPerUnit) => {
        if (!secondsPerUnit || !Number.isFinite(secondsPerUnit)) {
            return '--';
        }

        let minutes = Math.floor(secondsPerUnit / 60);
        let seconds = Math.round(secondsPerUnit % 60);
        if (seconds === 60) {
            minutes += 1;
            seconds = 0;
        }
        const paddedSeconds = seconds.toString().padStart(2, '0');
        return `${minutes}:${paddedSeconds} / ${getUnitConfig().paceLabel}`;
    };

    const formatPace = (secondsPerMile) => {
        const unitConfig = getUnitConfig();
        return formatPaceSeconds(secondsPerMile / unitConfig.distanceScale);
    };

    const computeSummary = (runs) => {
        const totalRuns = runs.length;
        const totalDistanceMiles = runs.reduce((sum, run) => sum + run.distanceMiles, 0);
        const totalElevationGain = runs.reduce((sum, run) => sum + (run.elevationGain || 0), 0);
        const averageDistance = totalRuns ? totalDistanceMiles / totalRuns : 0;
        const longestRun = totalRuns ? Math.max(...runs.map((run) => run.distanceMiles || 0)) : 0;

        const paceRuns = runs.filter((run) => {
            if (run.distanceMiles <= 0 || run.movingTime <= 0) {
                return false;
            }
            const paceSeconds = run.movingTime / run.distanceMiles;
            return paceSeconds >= PACE_FLOOR_SECONDS_PER_MILE;
        });
        const paceDistanceMiles = paceRuns.reduce((sum, run) => sum + run.distanceMiles, 0);
        const paceTime = paceRuns.reduce((sum, run) => sum + run.movingTime, 0);
        const averagePace = paceDistanceMiles ? paceTime / paceDistanceMiles : 0;
        const fastestPace = paceRuns.length
            ? Math.min(...paceRuns.map((run) => run.movingTime / run.distanceMiles))
            : null;

        const dates = runs
            .map((run) => new Date(run.startDate))
            .filter((date) => Number.isFinite(date.getTime()))
            .sort((a, b) => a - b);
        let runsPerWeek = 0;
        if (totalRuns) {
            const earliest = dates[0];
            const latest = dates[dates.length - 1];
            const weeks = earliest && latest
                ? Math.max(1, (latest - earliest) / (1000 * 60 * 60 * 24 * 7))
                : 1;
            runsPerWeek = totalRuns / weeks;
        }

        return {
            totalRuns,
            totalDistanceMiles,
            averageDistance,
            averagePace,
            longestRun,
            fastestPace,
            totalElevationGain,
            runsPerWeek
        };
    };

    const formatRunMeta = (run) => {
        const date = new Date(run.startDate);
        const dateLabel = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        return `${formatDistance(run.distanceMiles)} | ${dateLabel}`;
    };

    const truncateText = (text, maxLength) => {
        if (!text) {
            return '';
        }
        if (text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength - 3).trimEnd()}...`;
    };

    const updateStats = (summary, hasData) => {
        if (!hasData) {
            statTotalRunsEl.textContent = '--';
            statTotalMilesEl.textContent = '--';
            statAverageDistanceEl.textContent = '--';
            statAveragePaceEl.textContent = '--';
            statLongestRunEl.textContent = '--';
            statFastestPaceEl.textContent = '--';
            statTotalElevationEl.textContent = '--';
            statRunsPerWeekEl.textContent = '--';
            return;
        }

        statTotalRunsEl.textContent = formatCount.format(summary.totalRuns || 0);
        statTotalMilesEl.textContent = formatDistance(summary.totalDistanceMiles || 0);
        statAverageDistanceEl.textContent = formatDistance(summary.averageDistance || 0);
        statAveragePaceEl.textContent = formatPace(summary.averagePace);
        statLongestRunEl.textContent = formatDistance(summary.longestRun || 0);
        statFastestPaceEl.textContent = formatPace(summary.fastestPace);
        statTotalElevationEl.textContent = formatElevationValue(summary.totalElevationGain || 0);
        statRunsPerWeekEl.textContent = `${formatNumber.format(summary.runsPerWeek || 0)} / wk`;
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
            if (run.description) {
                const description = document.createElement('div');
                description.className = 'recent-description';
                description.textContent = truncateText(run.description, 140);
                item.appendChild(description);
            }
            recentListEl.appendChild(item);
        });
    };

    const buildHistogramBins = (runs, binSize) => {
        if (!runs.length) {
            return [];
        }

        const maxDistance = Math.max(...runs.map((run) => run.distanceMiles * getUnitConfig().distanceScale));
        const binCount = Math.max(1, Math.ceil(maxDistance / binSize));
        const bins = Array.from({ length: binCount }, (_, index) => ({
            start: index * binSize,
            end: (index + 1) * binSize,
            count: 0
        }));

        runs.forEach((run) => {
            const distance = run.distanceMiles * getUnitConfig().distanceScale;
            const index = Math.min(Math.floor(distance / binSize), binCount - 1);
            bins[index].count += 1;
        });

        return bins;
    };

    const getRunYear = (run) => new Date(run.startDate).getFullYear();

    const getHistogramRuns = (runs) => {
        const selectedYear = yearFilterSelect.value;
        if (selectedYear === 'all') {
            return runs;
        }
        return runs.filter((run) => getRunYear(run).toString() === selectedYear);
    };

    const populateYearFilter = (runs) => {
        const existingValue = yearFilterSelect.value;
        const years = [...new Set(runs.map((run) => getRunYear(run)))]
            .filter((year) => Number.isFinite(year))
            .sort((a, b) => b - a);

        yearFilterSelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'All';
        yearFilterSelect.appendChild(allOption);

        years.forEach((year) => {
            const option = document.createElement('option');
            option.value = year.toString();
            option.textContent = year.toString();
            yearFilterSelect.appendChild(option);
        });

        if (existingValue && [...yearFilterSelect.options].some((opt) => opt.value === existingValue)) {
            yearFilterSelect.value = existingValue;
        }
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

        const filteredRuns = getHistogramRuns(runs);
        if (!filteredRuns.length) {
            histogramNoteEl.textContent = 'No runs found for this year.';
            return;
        }

        const unitConfig = getUnitConfig();
        const binSize = parseFloat(binSizeSelect.value);
        const bins = buildHistogramBins(filteredRuns, binSize);
        const maxCount = Math.max(...bins.map((bin) => bin.count), 1);

        const width = 800;
        const height = 320;
        const padding = { top: 20, right: 20, bottom: 58, left: 52 };
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;
        const maxDistanceValue = bins.length * binSize;
        const xForValue = (value) => padding.left + (value / maxDistanceValue) * innerWidth;

        const svg = createSvgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'presentation'
        });

        const gridCount = 8;
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
        const barWidth = Math.min(Math.max(6, slotWidth * 0.7), slotWidth);
        const minLabelSpacing = binSize < 1 ? 46 : 24;
        const isHalfUnit = Math.abs(binSize - 0.5) < 0.001;
        const labelStep = isHalfUnit ? 2 : Math.max(1, Math.ceil(minLabelSpacing / slotWidth));
        const decimals = binSize < 1 ? 1 : Number.isInteger(binSize) ? 0 : 1;

        bins.forEach((bin, index) => {
            const barHeight = (bin.count / maxCount) * innerHeight;
            const centerValue = bin.start + binSize / 2;
            const center = xForValue(centerValue);
            const x = center - barWidth / 2;
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
        });

        const axis = createSvgElement('line', {
            x1: padding.left,
            x2: width - padding.right,
            y1: padding.top + innerHeight,
            y2: padding.top + innerHeight,
            stroke: '#b6bfd3'
        });
        svg.appendChild(axis);

        for (let i = 0; i <= bins.length; i += labelStep) {
            const value = i * binSize;
            const x = xForValue(value);
            const y = height - padding.bottom + 24;
            const tick = createSvgElement('line', {
                x1: x,
                x2: x,
                y1: padding.top + innerHeight,
                y2: padding.top + innerHeight + 6,
                stroke: '#b6bfd3'
            });
            svg.appendChild(tick);

            const label = createSvgElement('text', {
                x,
                y,
                'text-anchor': 'middle',
                fill: '#4f5a70',
                'font-size': '11'
            });
            label.textContent = value.toFixed(decimals);
            label.setAttribute('transform', `rotate(-35 ${x} ${y})`);
            svg.appendChild(label);
        }

        const yAxis = createSvgElement('line', {
            x1: padding.left,
            x2: padding.left,
            y1: padding.top,
            y2: padding.top + innerHeight,
            stroke: '#b6bfd3'
        });
        svg.appendChild(yAxis);

        histogramEl.appendChild(svg);
        histogramNoteEl.textContent = `${formatCount.format(filteredRuns.length)} runs across ${bins.length} bins (${unitConfig.distanceLabel}).`;
    };

    const renderDashboard = (runs) => {
        currentRuns = runs;
        populateYearFilter(runs);
        const filteredRuns = getHistogramRuns(runs);
        const summary = computeSummary(filteredRuns);
        updateStats(summary, filteredRuns.length > 0);
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

    yearFilterSelect.addEventListener('change', () => {
        const filteredRuns = getHistogramRuns(currentRuns);
        const summary = computeSummary(filteredRuns);
        updateStats(summary, filteredRuns.length > 0);
        renderHistogram(currentRuns);
    });

    unitToggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setUnit(button.dataset.unit);
        });
    });

    loadUnitPreference();
    updateUnitButtons();
    updateBinOptions(false);

    renderDashboard([]);
    const cachedRuns = loadCache();
    if (cachedRuns) {
        renderDashboard(cachedRuns);
        setStatus('Loaded cached data.', 'success');
    } else {
        setStatus('Ready to load Strava data.', null);
    }
})();
