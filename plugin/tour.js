// The five-screen tour shown the first time the panel opens (prefs.tourSeen), and again from
// "Show the tour". The name, the logo and the first screen's extra line come from #tour's data attributes,
// so the same file works for any copy of the panel. Loaded before renderer.js, which calls tourOnce().

// A drawn waveform: one bar per value (0 to 1). Bars between from and to are in the accent colour.
function tourWave(values, from = -1, to = -1) {
    const bars = values.map((v, i) => {
        const h = Math.max(2, v * 60);
        return `<rect x="${i * 4}" y="${(64 - h) / 2}" width="2.6" height="${h}" rx="1.3" class="${from < 0 ? 'idle' : i >= from && i <= to ? 'on' : 'dim'}"/>`;
    }).join('');
    return `<svg class="tWave" viewBox="0 0 ${values.length * 4} 64" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

// Repeatable wobble, so the pictures look the same every time.
const tourNoise = (i) => 0.72 + 0.28 * Math.abs(Math.sin(i * 12.9898) * Math.cos(i * 4.1414));
const TOUR_SWELL = Array.from({ length: 96 }, (_, i) => Math.pow(Math.sin((i / 95) * Math.PI), 2.2) * tourNoise(i));
const TOUR_RISE = Array.from({ length: 30 }, (_, i) => Math.pow(i / 29, 1.6) * tourNoise(i));
const TOUR_HIT = Array.from({ length: 30 }, (_, i) => Math.exp(-i / 7) * tourNoise(i));
const TOUR_WHOOSH = Array.from({ length: 30 }, (_, i) => Math.pow(Math.sin((i / 29) * Math.PI), 2) * tourNoise(i + 9));

const tourRow = (name, sub, wave, extra = '', cls = '') =>
    `<div class="tRow ${cls}"><span class="tPlay">&#9654;</span><span class="tName"><span>${name}${extra}</span><small>${sub}</small></span>${wave ? tourWave(wave) : ''}</div>`;

const TOUR = [
    {
        title: (d) => `Welcome to ${d.name}`,
        text: (d) => `Your sound effects, sorted into categories, inside Resolve. Your files stay where they are.${d.lead ? ' ' + d.lead : ''}`,
        art: (d) => `${d.logo ? `<img class="tLogo" src="${d.logo}" alt="">` : ''}<div class="tPills">${['Whooshes', 'Risers', 'Impacts', 'Pops', 'Ticks', 'Glitches', 'Ambience', 'Musical', 'Foley']
            .map((c, i) => `<span class="${i === 1 ? 'on' : ''}">${c}</span>`).join('')}</div>`,
    },
    {
        title: () => 'Find it fast',
        text: () => 'Search by name or filter by length. Click a sound to hear it, or use the arrow keys to go through the list.',
        art: () => `<div class="tSearch"><b>whoosh</b><span>Any length</span></div>`
            + tourRow('Whoosh deep', 'Transitions', TOUR_WHOOSH, '', 'sel')
            + tourRow('Whoosh fast', 'Transitions', TOUR_WHOOSH.slice().reverse())
            + tourRow('Whoosh soft', 'Transitions', TOUR_WHOOSH.map((v) => v * 0.7)),
    },
    {
        title: () => 'Use just the part you need',
        text: () => 'Drag across the waveform to pick a section. Double-click the sound to place it at the playhead, or drag it onto the timeline.',
        art: () => `<div class="tHead"><b>Whoosh deep</b><span class="tDrag">Drag section</span></div><div class="tEdit">${tourWave(TOUR_SWELL, 26, 70)}</div>`,
    },
    {
        title: () => 'Match your music',
        text: () => 'Put the playhead over your music and click Read music key. The key filter can then show only the sounds that fit.',
        art: () => `<div class="tSearch"><span class="tBtn">Read music key</span><em>C major</em></div>`
            + tourRow('Bell tone', 'Musical', TOUR_HIT, '<i class="tag fit">note G</i>')
            + tourRow('Chime', 'Musical', TOUR_HIT.map((v) => v * 0.8), '<i class="tag fit">note E</i>')
            + tourRow('Pad swell', 'Musical', TOUR_RISE, '<i class="tag fit">C major</i>'),
    },
    {
        title: () => 'Make it yours',
        text: () => 'Press F to star a favourite. Right-click a sound to move it, or make your own categories. Add more folders any time.',
        art: () => `<div class="tSide"><p>My categories<u>+ New</u></p><div class="on">Intro hits<s>12</s></div><div>Logo stings<s>7</s></div><p>Yours</p><div>&#9733; Favourites<s>24</s></div><p>Folders<u>+ Add</u></p><div>My sound effects<s>860</s></div></div>`,
    },
];

const tour = { at: 0, open: false, back: null };
// Everything behind the tour: out of reach of clicks, Tab and shortcuts while it is open.
const tourBehind = () => document.querySelectorAll('body > header, #musicbar, body > main, body > footer, #firstRun');

function tourOnce() {
    if (!state.prefs.tourSeen) openTour();
}

function openTour() {
    if (tour.open) return;
    tour.open = true;
    tour.at = 0;
    tour.back = document.activeElement;
    stop();  // no sound playing behind it
    tourBehind().forEach((el) => { el.inert = true; });
    $('tour').classList.remove('kb');
    $('tour').hidden = false;
    drawTour();
}

function closeTour(pickFolders) {
    tour.open = false;
    tourBehind().forEach((el) => { el.inert = false; });
    $('tour').hidden = true;
    state.prefs.tourSeen = true;
    savePrefs();
    if (tour.back && tour.back.focus) tour.back.focus();
    if (pickFolders) addFolders(true);
}

// True until the first library folder is chosen: the last screen then leads to the folder picker.
const tourNeedsFolders = () => !state.folders.length;

function drawTour() {
    const el = $('tour');
    const s = TOUR[tour.at];
    const last = tour.at === TOUR.length - 1;
    el.innerHTML = `
        <button class="tSkip" data-t="skip">Skip</button>
        <div class="tCard">
            <div class="tArt" aria-hidden="true">${s.art(el.dataset)}</div>
            <h2 id="tourTitle">${s.title(el.dataset)}</h2>
            <p class="muted">${s.text(el.dataset)}</p>
            <div class="tNav">
                <span class="tDots" role="img" aria-label="Screen ${tour.at + 1} of ${TOUR.length}">${TOUR.map((_, i) => `<i class="${i === tour.at ? 'on' : ''}"></i>`).join('')}</span>
                <span class="grow"></span>
                <button data-t="back" ${tour.at ? '' : 'hidden'}>Back</button>
                <button data-t="next" class="primary">${!last ? 'Next' : tourNeedsFolders() ? 'Choose folders' : 'Done'}</button>
            </div>
        </div>`;
    el.querySelector('[data-t="next"]').focus({ preventScroll: true });
}

function tourGo(step) {
    if (step > 0 && tour.at === TOUR.length - 1) return closeTour(tourNeedsFolders());
    tour.at = Math.max(0, tour.at + step);
    drawTour();
}

document.getElementById('tour').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    if (b.dataset.t === 'skip') closeTour(false);
    else tourGo(b.dataset.t === 'next' ? 1 : -1);
});

// Capture phase, so the panel's own shortcuts never see these keys. Enter and Space press the
// focused button, and Tab moves between the tour's buttons, as usual.
document.addEventListener('keydown', (e) => {
    if (!tour.open) return;
    e.stopPropagation();
    if (e.key === 'Tab') $('tour').classList.add('kb');
    if (e.key === 'Escape') closeTour(false);
    else if (e.key === 'ArrowLeft') tourGo(-1);
    else if (e.key === 'ArrowRight' && tour.at < TOUR.length - 1) tourGo(1);
}, true);
