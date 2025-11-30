(() => {
    const scriptUrl = document.currentScript
        ? new URL(document.currentScript.src, window.location.href)
        : new URL('scripts/critter-layer.js', window.location.href);
    const critterBase = new URL('../assets/animal/', scriptUrl);

    const critterImages = [
        'raspberry.jpeg',
        'IMG_2499.JPG',
        'IMG_2294.JPG',
        'longdayfactory.jpeg',
        '1000009442.JPG',
        'IMG_3764.JPG',
        'wooper.jpeg',
        'IMG_2234.JPG',
        'IMG_2395.JPG',
        '02328.webp'
    ].map((name) => new URL(name, critterBase).href);

    const slots = [
        { top: 16, right: 16 }
    ];

    const jitter = () => Math.round((Math.random() - 0.5) * 18);
    const randomRotation = () => (Math.random() * 10 - 5).toFixed(2);
    const randomSize = () => Math.round(158 + Math.random() * 12); // keep them small in their slots

    const pickImages = (count) => {
        const pool = [...critterImages];
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count);
    };

    const placeCritters = () => {
        const layer = document.createElement('div');
        layer.className = 'critter-layer';
        document.body.appendChild(layer);

        const picks = pickImages(slots.length);

        slots.forEach((slot, index) => {
            const img = document.createElement('img');
            img.className = 'critter';
            img.decoding = 'async';
            img.loading = 'lazy';
            img.src = picks[index];
            img.alt = 'background animal';
            img.style.width = `${randomSize().toFixed(0)}px`;
            img.style.height = 'auto';
            img.style.top = `calc(${slot.top}% + ${jitter()}px)`;
            if (slot.left !== undefined) {
                img.style.left = `calc(${slot.left}% + ${jitter()}px)`;
            } else {
                img.style.right = `calc(${slot.right}% + ${jitter()}px)`;
            }
            img.style.transform = `rotate(${randomRotation()}deg)`;
            layer.appendChild(img);
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', placeCritters);
    } else {
        placeCritters();
    }
})();
