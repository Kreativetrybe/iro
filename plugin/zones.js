// Focus lighting: the part of the panel you are using (categories, sound list or waveform) is
// lit and the other two are dark. Only sets main[data-zone]; the look is in zones.css.
(() => {
    const main = document.querySelector('main');
    const PARTS = { cats: '#cats', edit: '#editor', list: '#toolbar, #listArea' };
    const zoneOf = (el) => Object.keys(PARTS).find((z) => el.closest && el.closest(PARTS[z]));
    let timer = null, next = 'list';

    function setZone(z) {
        clearTimeout(timer);
        next = z;
        if (main.dataset.zone !== z) main.dataset.zone = z;
    }

    // The pointer has to settle in a part before the light moves there, so passing through one
    // on the way to another changes nothing.
    function soon(z) {
        if (z === next) return;
        next = z;
        clearTimeout(timer);
        timer = setTimeout(() => setZone(z), 160);
    }

    // One part is always lit: over the search bar, footer, sidebar edge or a menu, and when the
    // pointer leaves for Resolve, the light stays where it was.
    document.addEventListener('mousemove', (e) => {
        if (e.buttons) return;  // mid-drag: a section, the sidebar edge or a sound
        const z = zoneOf(e.target);
        if (z) soon(z);
    });
    document.addEventListener('mousedown', (e) => {
        const z = zoneOf(e.target);
        if (z) setZone(z);
    });

    // Keyboard: searching and arrowing through sounds light the list, and Tab follows the focus.
    document.getElementById('search').addEventListener('input', () => setZone('list'));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setZone('list');
    });
    document.addEventListener('focusin', (e) => {
        const z = zoneOf(e.target);
        if (z) setZone(z);
    });

    new ResizeObserver(([r]) => main.style.setProperty('--cats-w', `${r.target.offsetWidth}px`)).observe(document.getElementById('cats'));
    setZone('list');
})();
