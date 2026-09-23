const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/waves-background.js'), 'utf8');

function createPage() {
    const element = (properties = {}) => {
        const attributes = new Map();
        const classes = new Set();
        return Object.assign(new EventTarget(), {
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name)
            },
            getAttribute: (name) => attributes.get(name) ?? null,
            setAttribute: (name, value) => attributes.set(name, value),
            removeAttribute: (name) => attributes.delete(name)
        }, properties);
    };
    const videoFrames = new Map();
    const paints = new Map();
    let nextId = 0;
    const schedule = (queue, callback) => {
        const id = ++nextId;
        queue.set(id, callback);
        return id;
    };
    const flush = (queue) => {
        const callbacks = [...queue.values()];
        queue.clear();
        callbacks.forEach((callback) => callback());
    };
    const button = element();
    const background = element();
    const video = element({
        dataset: { src: 'assets/video/aerial-surf.mp4' },
        play: async () => {},
        load: () => {},
        pause: () => {},
        requestVideoFrameCallback: (callback) => schedule(videoFrames, callback),
        cancelVideoFrameCallback: (id) => videoFrames.delete(id)
    });
    Object.defineProperty(video, 'src', {
        set: (value) => video.setAttribute('src', value)
    });
    const elements = { 'waves-toggle': button, 'waves-background': background,
        'waves-video': video, 'waves-status': element() };
    vm.runInNewContext(source, {
        document: element({ hidden: false, getElementById: (id) => elements[id] }),
        window: element(),
        getComputedStyle: () => ({ transitionDuration: '0.8s' }),
        setTimeout: () => 0,
        clearTimeout: () => {},
        requestAnimationFrame: (callback) => schedule(paints, callback),
        cancelAnimationFrame: (id) => paints.delete(id)
    });
    return {
        button, video, paints,
        visible: () => background.classList.contains('is-visible'),
        videoFrame: () => flush(videoFrames),
        paint: () => flush(paints),
        async click() {
            button.dispatchEvent(new Event('click'));
            await new Promise(setImmediate);
        }
    };
}

test('first click waits for a video frame and a transparent paint before fading in', async () => {
    const page = createPage();
    assert.equal(page.video.getAttribute('src'), null);
    await page.click();
    assert.equal(page.visible(), false, 'starting playback must not reveal an unpainted video');
    page.paint();
    assert.equal(page.visible(), false);
    page.videoFrame();
    page.paint();
    assert.equal(page.visible(), false, 'the first paint stays transparent');
    page.paint();
    assert.equal(page.visible(), true);
    assert.equal(page.button.getAttribute('aria-busy'), null);
});

test('switching off cancels a pending reveal, and the next click still works', async () => {
    const page = createPage();
    await page.click();
    page.videoFrame();
    page.paint();
    const pendingPaint = [...page.paints.values()][0];
    await page.click();
    assert.equal(page.paints.size, 0);
    pendingPaint();
    assert.equal(page.visible(), false, 'an already queued callback must not turn waves back on');
    await page.click();
    page.videoFrame();
    page.paint();
    page.paint();
    assert.equal(page.visible(), true);
});
