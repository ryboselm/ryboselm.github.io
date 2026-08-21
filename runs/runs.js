(() => {
    // Update this to your deployed Netlify function URL when using GitHub Pages.
    const PROXY_ENDPOINT = 'https://benevolent-pony-8b208c.netlify.app/.netlify/functions/strava?schema=3';
    const CACHE_KEY = 'runsCache_v3';
    const LEGACY_CACHE_KEYS = ['stravaRunsCache_v2'];
    const CACHE_TTL_MS = 1000 * 60 * 15;
    const UNIT_STORAGE_KEY = 'stravaRunsUnit_v1';
    const PACE_FLOOR_SECONDS_PER_MILE = 223; // 3:43 / mi
    const METER_TO_FEET = 3.28084;
    const MILES_TO_KM = 1.60934;
    const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
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
    const binSizeSelect = document.getElementById('bin-size');
    const binSizeLabel = document.querySelector('label[for="bin-size"]');
    const yearFilterSelect = document.getElementById('year-filter');
    const unitToggleButtons = document.querySelectorAll('.unit-toggle button');
    const runCalendarEl = document.getElementById('run-calendar');
    const runCalendarNoteEl = document.getElementById('run-calendar-note');
    const runCalendarPeriodEl = document.getElementById('run-calendar-period');
    const weeklyMileageEl = document.getElementById('weekly-mileage');
    const weeklyMileageNoteEl = document.getElementById('weekly-mileage-note');
    const weeklyMileagePeriodEl = document.getElementById('weekly-mileage-period');
    const histogramEl = document.getElementById('histogram');
    const histogramNoteEl = document.getElementById('histogram-note');
    const histogramPeriodEl = document.getElementById('histogram-period');

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

    const clearLegacyCaches = () => {
        try {
            LEGACY_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch (error) {
            // ignore localStorage failures
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
            .map((run) => toLocalDay(run.date))
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

    const getRunYear = (run) => toLocalDay(run.date).getFullYear();

    const getFilteredRuns = (runs) => {
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

    const toLocalDay = (value) => {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [year, month, day] = value.split('-').map(Number);
            return new Date(year, month - 1, day, 12);
        }
        const date = value instanceof Date ? value : new Date(value);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    };

    const addDays = (date, days) => {
        const result = toLocalDay(date);
        result.setDate(result.getDate() + days);
        return result;
    };

    const getStartOfWeek = (date) => addDays(date, -toLocalDay(date).getDay());

    const getCalendarDayDifference = (first, second) => {
        const firstUtc = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
        const secondUtc = Date.UTC(second.getFullYear(), second.getMonth(), second.getDate());
        return Math.round((firstUtc - secondUtc) / MILLISECONDS_PER_DAY);
    };

    const getDateKey = (date) => [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');

    const scrollChartToDate = (container, range, date, itemCount) => {
        const dayOffset = Math.max(0, getCalendarDayDifference(date, range.start));
        const itemIndex = Math.min(itemCount - 1, Math.floor(dayOffset / 7));

        window.requestAnimationFrame(() => {
            if (container.scrollWidth <= container.clientWidth) {
                return;
            }
            const target = ((itemIndex + 1) / itemCount) * container.scrollWidth;
            container.scrollLeft = Math.max(0, target - container.clientWidth + 24);
        });
    };

    const getChartDateRange = () => {
        const selectedYear = yearFilterSelect.value;
        if (selectedYear !== 'all') {
            const year = Number(selectedYear);
            const firstDay = new Date(year, 0, 1, 12);
            const lastDay = new Date(year, 11, 31, 12);
            return {
                start: getStartOfWeek(firstDay),
                end: addDays(getStartOfWeek(lastDay), 6),
                selectedYear: year,
                label: year.toString()
            };
        }

        const today = toLocalDay(new Date());
        const currentWeekStart = getStartOfWeek(today);
        return {
            start: addDays(currentWeekStart, -52 * 7),
            end: addDays(currentWeekStart, 6),
            selectedYear: null,
            label: 'the last 12 months'
        };
    };

    const updateChartPeriodLabels = () => {
        const selectedYear = yearFilterSelect.value;
        const timelineLabel = selectedYear === 'all' ? 'Last 12 months' : selectedYear;
        runCalendarPeriodEl.textContent = timelineLabel;
        weeklyMileagePeriodEl.textContent = timelineLabel;
        histogramPeriodEl.textContent = selectedYear === 'all' ? 'All years' : selectedYear;
    };

    const isDateInChartRange = (date, range) => {
        if (date < range.start || date > range.end) {
            return false;
        }
        if (range.selectedYear !== null && date.getFullYear() !== range.selectedYear) {
            return false;
        }
        return range.selectedYear !== null || date <= toLocalDay(new Date());
    };

    const getDailyMileage = (runs, range) => {
        const dailyMileage = new Map();

        runs.forEach((run) => {
            const date = toLocalDay(run.date);
            if (!Number.isFinite(date.getTime()) || !isDateInChartRange(date, range)) {
                return;
            }

            const key = getDateKey(date);
            const current = dailyMileage.get(key) || { distanceMiles: 0, runs: 0 };
            current.distanceMiles += Number(run.distanceMiles) || 0;
            current.runs += 1;
            dailyMileage.set(key, current);
        });

        return dailyMileage;
    };

    const getMileageThresholds = (dailyMileage) => {
        const values = [...dailyMileage.values()]
            .map((day) => day.distanceMiles)
            .filter((distance) => distance > 0)
            .sort((first, second) => first - second);

        if (!values.length) {
            return [];
        }

        return [0.25, 0.5, 0.75].map((percentile) => (
            values[Math.min(values.length - 1, Math.floor(values.length * percentile))]
        ));
    };

    const getCalendarLevel = (distanceMiles, thresholds) => {
        if (distanceMiles <= 0) {
            return 0;
        }

        let level = 1;
        thresholds.forEach((threshold) => {
            if (distanceMiles > threshold) {
                level += 1;
            }
        });
        return Math.min(level, 4);
    };

    const renderRunCalendar = (runs) => {
        runCalendarEl.innerHTML = '';
        const range = getChartDateRange();
        const dayCount = getCalendarDayDifference(range.end, range.start) + 1;
        const weekCount = Math.ceil(dayCount / 7);
        const dailyMileage = getDailyMileage(runs, range);
        const thresholds = getMileageThresholds(dailyMileage);
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        grid.style.gridTemplateColumns = `28px repeat(${weekCount}, 12px)`;
        grid.style.gridTemplateRows = '18px repeat(7, 12px)';

        [
            { label: 'Mon', day: 1 },
            { label: 'Wed', day: 3 },
            { label: 'Fri', day: 5 }
        ].forEach(({ label, day }) => {
            const weekday = document.createElement('span');
            weekday.className = 'calendar-weekday';
            weekday.textContent = label;
            weekday.style.gridColumn = '1';
            weekday.style.gridRow = `${day + 2}`;
            grid.appendChild(weekday);
        });

        let lastMonth = null;
        let lastMonthWeek = -2;
        for (let offset = 0; offset < dayCount; offset += 1) {
            const date = addDays(range.start, offset);
            const weekIndex = Math.floor(offset / 7);
            const dateMonth = `${date.getFullYear()}-${date.getMonth()}`;
            const isVisibleMonth = range.selectedYear === null
                || date.getFullYear() === range.selectedYear;

            if (isVisibleMonth && dateMonth !== lastMonth && weekIndex - lastMonthWeek >= 2) {
                const month = document.createElement('span');
                month.className = 'calendar-month';
                month.textContent = date.toLocaleDateString('en-US', { month: 'short' });
                month.style.gridColumn = `${weekIndex + 2} / span 2`;
                month.style.gridRow = '1';
                grid.appendChild(month);
                lastMonthWeek = weekIndex;
            }
            lastMonth = dateMonth;

            const key = getDateKey(date);
            const daySummary = dailyMileage.get(key) || { distanceMiles: 0, runs: 0 };
            const cell = document.createElement('span');
            const isOutside = !isDateInChartRange(date, range);
            const runLabel = daySummary.runs === 1 ? 'run' : 'runs';
            const dateLabel = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            cell.className = `calendar-day${isOutside ? ' is-outside' : ''}`;
            cell.dataset.level = isOutside
                ? '0'
                : getCalendarLevel(daySummary.distanceMiles, thresholds).toString();
            cell.style.gridColumn = `${weekIndex + 2}`;
            cell.style.gridRow = `${date.getDay() + 2}`;
            cell.title = daySummary.runs
                ? `${dateLabel}: ${formatDistance(daySummary.distanceMiles)} across ${daySummary.runs} ${runLabel}`
                : `${dateLabel}: no runs`;
            grid.appendChild(cell);
        }

        const legend = document.createElement('div');
        legend.className = 'calendar-legend';
        const lessLabel = document.createElement('span');
        lessLabel.textContent = 'Less';
        legend.appendChild(lessLabel);
        for (let level = 0; level <= 4; level += 1) {
            const swatch = document.createElement('span');
            swatch.className = 'calendar-legend-swatch';
            swatch.dataset.level = level.toString();
            legend.appendChild(swatch);
        }
        const moreLabel = document.createElement('span');
        moreLabel.textContent = 'More';
        legend.appendChild(moreLabel);

        runCalendarEl.appendChild(grid);
        runCalendarEl.appendChild(legend);

        const today = toLocalDay(new Date());
        const focusDate = today >= range.start && today <= range.end ? today : range.end;
        scrollChartToDate(runCalendarEl, range, focusDate, weekCount);

        const visibleRuns = runs.filter((run) => isDateInChartRange(toLocalDay(run.date), range));
        const totalDistance = visibleRuns.reduce((sum, run) => sum + (Number(run.distanceMiles) || 0), 0);
        runCalendarEl.setAttribute(
            'aria-label',
            `${range.label} running calendar: ${visibleRuns.length} runs totaling ${formatDistance(totalDistance)}.`
        );
        runCalendarNoteEl.textContent = visibleRuns.length
            ? `${formatCount.format(visibleRuns.length)} runs totaling ${formatDistance(totalDistance)} in ${range.label}.`
            : `No runs found in ${range.label}.`;
    };

    const getWeeklyMileage = (runs, range) => {
        const dayCount = getCalendarDayDifference(range.end, range.start) + 1;
        const weekCount = Math.ceil(dayCount / 7);
        const weeks = Array.from({ length: weekCount }, (_, index) => ({
            start: addDays(range.start, index * 7),
            distanceMiles: 0,
            runs: 0
        }));

        runs.forEach((run) => {
            const date = toLocalDay(run.date);
            if (!Number.isFinite(date.getTime()) || !isDateInChartRange(date, range)) {
                return;
            }
            const weekIndex = Math.floor(getCalendarDayDifference(date, range.start) / 7);
            if (!weeks[weekIndex]) {
                return;
            }
            weeks[weekIndex].distanceMiles += Number(run.distanceMiles) || 0;
            weeks[weekIndex].runs += 1;
        });

        return weeks;
    };

    const renderWeeklyMileage = (runs) => {
        weeklyMileageEl.innerHTML = '';
        const range = getChartDateRange();
        const weeks = getWeeklyMileage(runs, range);
        const activeWeeks = weeks.filter((week) => week.runs > 0);

        if (!activeWeeks.length) {
            const empty = document.createElement('div');
            empty.className = 'chart-empty';
            empty.textContent = `No weekly mileage found in ${range.label}.`;
            weeklyMileageEl.appendChild(empty);
            weeklyMileageNoteEl.textContent = `No runs found in ${range.label}.`;
            return;
        }

        const unitConfig = getUnitConfig();
        const width = 900;
        const height = 300;
        const padding = { top: 18, right: 18, bottom: 48, left: 58 };
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;
        const distances = weeks.map((week) => week.distanceMiles * unitConfig.distanceScale);
        const peakDistance = Math.max(...distances);
        const gridCount = 4;
        const gridStep = Math.max(1, Math.ceil(peakDistance / gridCount));
        const axisMaximum = gridStep * gridCount;
        const slotWidth = innerWidth / weeks.length;
        const barWidth = Math.min(12, Math.max(4, slotWidth * 0.68));
        const svg = createSvgElement('svg', {
            viewBox: `0 0 ${width} ${height}`,
            role: 'presentation'
        });

        for (let index = 0; index <= gridCount; index += 1) {
            const value = gridStep * index;
            const y = padding.top + innerHeight - (value / axisMaximum) * innerHeight;
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
            label.textContent = value.toString();
            svg.appendChild(label);
        }

        weeks.forEach((week, index) => {
            const distance = distances[index];
            const barHeight = (distance / axisMaximum) * innerHeight;
            const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
            const y = padding.top + innerHeight - barHeight;
            const rect = createSvgElement('rect', {
                x,
                y,
                width: barWidth,
                height: barHeight,
                rx: 3,
                fill: '#344d8d'
            });
            const title = createSvgElement('title');
            const weekLabel = week.start.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            title.textContent = `Week of ${weekLabel}: ${formatDistance(week.distanceMiles)} across ${week.runs} ${week.runs === 1 ? 'run' : 'runs'}`;
            rect.appendChild(title);
            svg.appendChild(rect);
        });

        const labelStep = Math.max(1, Math.ceil(weeks.length / 7));
        weeks.forEach((week, index) => {
            if (index % labelStep !== 0 && index !== weeks.length - 1) {
                return;
            }
            const x = padding.left + index * slotWidth + slotWidth / 2;
            const label = createSvgElement('text', {
                x,
                y: height - 18,
                'text-anchor': 'middle',
                fill: '#4f5a70',
                'font-size': '11'
            });
            label.textContent = week.start.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
            svg.appendChild(label);
        });

        weeklyMileageEl.appendChild(svg);
        const today = toLocalDay(new Date());
        const focusDate = today >= range.start && today <= range.end ? today : range.end;
        scrollChartToDate(weeklyMileageEl, range, focusDate, weeks.length);
        const totalDistance = weeks.reduce((sum, week) => sum + week.distanceMiles, 0);
        const peakWeek = activeWeeks.reduce((peak, week) => (
            week.distanceMiles > peak.distanceMiles ? week : peak
        ));
        weeklyMileageEl.setAttribute(
            'aria-label',
            `${range.label} weekly mileage chart. Peak week: ${formatDistance(peakWeek.distanceMiles)}.`
        );
        weeklyMileageNoteEl.textContent = `${formatDistance(totalDistance)} across ${activeWeeks.length} active weeks; peak ${formatDistance(peakWeek.distanceMiles)}.`;
    };

    const renderHistogram = (runs) => {
        histogramEl.innerHTML = '';

        if (!runs.length) {
            histogramNoteEl.textContent = 'Add Strava data to populate the chart.';
            return;
        }

        const filteredRuns = getFilteredRuns(runs);
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

        const gridCount = Math.min(maxCount, 8);
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
        updateChartPeriodLabels();
        const filteredRuns = getFilteredRuns(runs);
        const summary = computeSummary(filteredRuns);
        updateStats(summary, filteredRuns.length > 0);
        renderRunCalendar(filteredRuns);
        renderWeeklyMileage(filteredRuns);
        renderHistogram(runs);
    };

    const formatUpdatedAt = (updatedAt) => {
        if (!updatedAt) {
            return null;
        }

        const date = new Date(updatedAt);
        if (!Number.isFinite(date.getTime())) {
            return null;
        }

        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const buildLoadedStatus = (updatedAt) => {
        const updatedLabel = formatUpdatedAt(updatedAt);
        return updatedLabel
            ? `Updated ${updatedLabel}.`
            : 'Loaded cached data.';
    };

    const saveCache = ({ runs, updatedAt }) => {
        const cachePayload = {
            timestamp: Date.now(),
            runs,
            updatedAt
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cachePayload));
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
            return {
                runs: parsed.runs,
                updatedAt: parsed.updatedAt || null
            };
        } catch (error) {
            return null;
        }
    };

    const loadData = async () => {
        const cachedPayload = loadCache();
        if (cachedPayload) {
            renderDashboard(cachedPayload.runs);
            setStatus(buildLoadedStatus(cachedPayload.updatedAt), 'success');
            return;
        }

        renderDashboard([]);
        setStatus('Loading Strava data...', 'loading');

        try {
            const response = await fetch(PROXY_ENDPOINT);
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || 'Unable to fetch Strava data');
            }
            if (data && data.error) {
                throw new Error(data.error);
            }
            if (!data || !Array.isArray(data.runs)) {
                throw new Error('Strava proxy response missing runs');
            }
            const payload = {
                runs: data.runs,
                updatedAt: data.updatedAt || null
            };
            saveCache(payload);
            renderDashboard(data.runs);
            setStatus(buildLoadedStatus(data.updatedAt), 'success');
        } catch (error) {
            setStatus(error.message || 'Something went wrong loading Strava data.', 'error');
        }
    };

    binSizeSelect.addEventListener('change', () => {
        renderHistogram(currentRuns);
    });

    yearFilterSelect.addEventListener('change', () => {
        renderDashboard(currentRuns);
    });

    unitToggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setUnit(button.dataset.unit);
        });
    });

    clearLegacyCaches();
    loadUnitPreference();
    updateUnitButtons();
    updateBinOptions(false);

    loadData();
})();
