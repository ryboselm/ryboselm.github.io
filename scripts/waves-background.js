(() => {
    const button = document.getElementById('waves-toggle');
    const background = document.getElementById('waves-background');
    const video = document.getElementById('waves-video');
    const status = document.getElementById('waves-status');
    if (!button || !background || !video || !status) return;

    let enabled = false;
    let playAttempt = 0;
    let pauseTimer;
    let videoFrame = null;
    let paintFrame = null;
    let loadedDataListener = null;

    const cancelReveal = () => {
        if (videoFrame !== null) video.cancelVideoFrameCallback(videoFrame);
        if (paintFrame !== null) cancelAnimationFrame(paintFrame);
        if (loadedDataListener) video.removeEventListener('loadeddata', loadedDataListener);
        videoFrame = null;
        paintFrame = null;
        loadedDataListener = null;
    };

    const revealWhenPainted = (attempt) => {
        const isCurrent = () => attempt === playAttempt && enabled && !document.hidden;
        const afterVideoFrame = () => {
            if (!isCurrent()) return;
            videoFrame = null;
            if (loadedDataListener) video.removeEventListener('loadeddata', loadedDataListener);
            loadedDataListener = null;

            // Playback can begin before its first picture has been painted.
            // Leave a transparent paint between that picture and the fade.
            paintFrame = requestAnimationFrame(() => {
                if (!isCurrent()) return;
                paintFrame = requestAnimationFrame(() => {
                    if (!isCurrent()) return;
                    paintFrame = null;
                    background.classList.add('is-visible');
                    button.removeAttribute('aria-busy');
                });
            });
        };

        if (typeof video.requestVideoFrameCallback === 'function') {
            videoFrame = video.requestVideoFrameCallback(afterVideoFrame);
        } else if (video.readyState >= 2) {
            afterVideoFrame();
        } else {
            loadedDataListener = afterVideoFrame;
            video.addEventListener('loadeddata', loadedDataListener);
        }
    };

    const pauseWhenOff = () => {
        if (!enabled) video.pause();
    };

    const showError = () => {
        setEnabled(false);
        status.textContent = 'Waves couldn’t load. Try turning them on again.';
    };

    const play = async () => {
        const attempt = ++playAttempt;
        cancelReveal();
        button.setAttribute('aria-busy', 'true');

        try {
            await video.play();
            if (attempt !== playAttempt || !enabled || document.hidden) return;
            revealWhenPainted(attempt);
        } catch {
            // A later click or a hidden tab can cancel an earlier play request.
            if (attempt === playAttempt && enabled && !document.hidden) showError();
        }
    };

    const setEnabled = (nextEnabled, immediately = false) => {
        enabled = nextEnabled;
        playAttempt += 1;
        cancelReveal();
        clearTimeout(pauseTimer);
        status.textContent = '';
        button.setAttribute('aria-pressed', String(enabled));
        button.title = enabled ? 'Turn off ocean waves' : 'Turn on ocean waves';
        button.removeAttribute('aria-busy');

        if (enabled) {
            // No source (and no download) until the visitor explicitly opts in.
            if (!video.getAttribute('src') || video.error) {
                video.src = video.dataset.src;
                video.load();
            }
            video.muted = true;
            if (!document.hidden) play();
        } else {
            background.classList.remove('is-visible');
            const fadeDuration = parseFloat(getComputedStyle(background).transitionDuration) * 1000;
            if (immediately || document.hidden || !fadeDuration) {
                video.pause();
            } else {
                // Let the moving picture finish fading before pausing it.
                pauseTimer = setTimeout(pauseWhenOff, fadeDuration + 50);
            }
        }
    };

    button.addEventListener('click', () => setEnabled(!enabled));
    background.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'opacity') pauseWhenOff();
    });
    video.addEventListener('error', () => {
        if (enabled) showError();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            playAttempt += 1;
            cancelReveal();
            clearTimeout(pauseTimer);
            video.pause();
            background.classList.remove('is-visible');
        } else if (enabled) {
            play();
        }
    });

    // Returning through the back/forward cache should also start with waves off.
    window.addEventListener('pagehide', () => setEnabled(false, true));
    button.hidden = false;
})();
