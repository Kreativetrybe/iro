// IRO panel. Talks to main.js through window.sfx (see preload.js).
const ROW = 44;
const LENGTHS = { any: [0, Infinity] };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// How keys are usually written: flats for the major keys musicians spell that way.
const SPELL = { 'C# major': 'Db major', 'D# major': 'Eb major', 'G# major': 'Ab major', 'A# major': 'Bb major', 'A# minor': 'Bb minor', 'D# minor': 'Eb minor' };
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

const $ = (id) => document.getElementById(id);
// Paths are split on either slash so Windows paths work too; keys always use '/'.
const SEP = window.sfx.platform === 'win32' ? '\\' : '/';
const splitPath = (p) => p.split(/[\\/]/);
const FINDER = window.sfx.platform === 'win32' ? 'Show in Explorer' : 'Show in Finder';
const state = {
    sounds: [], categories: [], overrides: {}, prefs: {},
    view: 'all', query: '', length: 'any', shown: [], sel: -1,
    favOnly: false, keyFilter: 'any',
    ranges: {}, sections: {}, edit: null, detail: null, playTo: null,
    tree: [], nodes: new Map(), folders: [],
    music: null, musicClips: [], playing: null,
};
const KEYS = NAMES.flatMap((n) => [`${n} major`, `${n} minor`]);
const audio = new Audio();

// Canvas colours come from the CSS palette, so the look is set in one place (style.css).
const COL = {};
function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['accent', 'accent-wash', 'cream', 'wave', 'wave-sel', 'wave-idle', 'wave-dim']) COL[k] = cs.getPropertyValue(`--${k}`).trim();
}
readPalette();

// ---------------------------------------------------------------- loading

async function load() {
    const [{ index, folders, overrides, progress }, prefs] = await Promise.all([window.sfx.loadIndex(), window.sfx.loadPrefs()]);
    state.folders = folders || [];
    state.prefs = { favs: [], recent: [], searches: [], track: 'auto', onTop: true, view: 'all', volume: 0.8, ...prefs };
    state.overrides = overrides || {};
    $('onTop').checked = state.prefs.onTop !== false;
    if (state.prefs.sidebar) $('cats').style.width = `${state.prefs.sidebar}px`;
    $('volume').value = state.prefs.volume;
    audio.volume = state.prefs.volume;
    if (!state.folders.length) {
        welcome();
        return;
    }
    if (!index || (progress && !progress.finished && !index.sounds.length)) {
        firstRun(!index);
        return;
    }
    state.builtIn = index.categories;
    setCategories();
    state.sounds = index.sounds.map((s, i) => ({
        ...s, i,
        folder: tidy(packFolder(s.path)),
        title: tidy(s.name),
        hay: (s.name + ' ' + splitPath(s.path).slice(-4, -1).join(' ')).toLowerCase().replace(/[_\-.]+/g, ' '),
    }));
    // Natural order, so 2_whoosh comes before 10_whoosh.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    state.sounds.sort((a, b) => collator.compare(a.path, b.path));
    buildTree(state.folders);
    applyOverrides();
    state.view = state.prefs.view || 'all';
    if (state.view.startsWith('my:') && !state.categories.some((c) => c[0] === state.view)) state.view = 'all';
    render();
    refreshTracks();
}

// The library's own folders, as in Finder: one node per folder below each library root,
// with the stereo side folders (Left, Center, Right) folded into their parent. Each sound
// gets dirKeys, the keys of every folder it sits in, so a folder view includes subfolders.
function buildTree(folders) {
    const nodes = new Map();
    const tops = [];
    const bases = folders.map((f) => f.path.replace(/[\\/]+$/, ''));
    // Every library folder gets a node, even before it has been sorted or while its drive is out.
    for (const f of folders) {
        const key = 'dir:' + f.name;
        if (nodes.has(key)) continue;
        const node = { key, name: f.name, depth: 0, children: [], fsPath: f.path, root: true, online: f.online };
        nodes.set(key, node);
        tops.push(node);
    }
    for (const s of state.sounds) {
        const root = bases.find((r) => s.path.startsWith(r + SEP));
        if (!root) {
            s.dirKeys = [];
            continue;
        }
        const parts = [splitPath(root).pop(), ...splitPath(s.path.slice(root.length + 1)).slice(0, -1)]
            .filter((d, i) => i === 0 || !/^(left|right|center|centre)$/i.test(d));
        s.dirKeys = [];
        let parent = null;
        for (let d = 0; d < parts.length; d++) {
            const key = 'dir:' + parts.slice(0, d + 1).join('/');
            if (!nodes.has(key)) {
                const node = { key, name: d === 0 ? parts[0] : tidy(parts[d]), depth: d, children: [], fsPath: [root, ...parts.slice(1, d + 1)].join(SEP) };
                nodes.set(key, node);
                (parent ? parent.children : tops).push(node);
            }
            s.dirKeys.push(key);
            parent = nodes.get(key);
        }
    }
    state.tree = tops;
    state.nodes = nodes;
    if (!Array.isArray(state.prefs.open)) state.prefs.open = tops.map((n) => n.key);
}

function folderRows(counts, hideEmpty) {
    const open = new Set(state.prefs.open);
    const rows = [];
    const walk = (node) => {
        const n = counts[node.key] || 0;
        if (hideEmpty && !n && state.view !== node.key) return;
        const kids = node.children.length;
        const twisty = kids ? (open.has(node.key) ? '&#9662;' : '&#9656;') : '';
        const off = node.root && !node.online;
        const tip = off ? `${node.name} is not connected. Its sounds come back when the drive is plugged in.` : node.name;
        rows.push(`<div class="cat dir ${state.view === node.key ? 'on' : ''} ${off ? 'offline' : ''}" role="button" data-v="${esc(node.key)}" style="padding-left:${6 + node.depth * 11}px" title="${esc(tip)}">` +
            `<span class="tw" data-tw="${esc(node.key)}">${twisty}</span><span class="dn">${esc(node.name)}${off ? ' (not connected)' : ''}</span><span class="n">${n.toLocaleString()}</span></div>`);
        if (kids && open.has(node.key)) node.children.forEach(walk);
    };
    state.tree.forEach(walk);
    return rows.join('');
}

// The folder that names the sound. Packs like SYNERGY split by stereo side (Left, Center,
// Right), so for those show the folder above with the side after it.
function packFolder(p) {
    const parts = splitPath(p).slice(0, -1);
    const last = parts[parts.length - 1] || '';
    return /^(left|right|center|centre)$/i.test(last) ? `${parts[parts.length - 2]} (${last[0].toUpperCase()})` : last;
}

// Readable names: drop store prefixes (MA_Author_, Motionarray_Author_), pack ids and
// the _cinem8 tag, and turn underscores into spaces. Search still uses the full name.
function tidy(name) {
    const t = name
        .replace(/^MA_[^_]+_/, '')
        .replace(/^Motionarray_[^_]+_/i, '')
        .replace(/_cinem8$/i, '')
        .replace(/[_-]source[_-]\d+$|[-_ ]\d{5,}$/i, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();
    return t || name;
}

// The sorter's categories, then the ones you made (kept in prefs.json as [key, name] pairs).
function setCategories() {
    state.prefs.myCats = state.prefs.myCats || [];
    state.categories = [...state.builtIn, ...state.prefs.myCats];
}

function applyOverrides() {
    const known = new Set(state.categories.map((c) => c[0]));
    for (const s of state.sounds) {
        s.cat0 = s.cat0 || s.cat;
        const mine = state.overrides[s.path];
        s.cat = mine && known.has(mine) ? mine : s.cat0;
        if (mine && known.has(mine)) s.review = false;
    }
}

// Shown when no library folders are set yet, for example on a fresh install.
function welcome() {
    $('firstRun').hidden = false;
    $('frTitle').textContent = 'Choose your sound folders';
    $('frText').textContent = 'Pick the folders that hold your sound effects. IRO sorts them once, then they are ready to drag into Resolve.';
    $('frProgress').hidden = true;
    $('frAdd').hidden = false;
}

async function firstRun(start) {
    $('firstRun').hidden = false;
    $('frTitle').textContent = 'Sorting your sound library';
    $('frText').textContent = 'Starting…';
    $('frProgress').hidden = false;
    $('frAdd').hidden = true;
    if (start) await window.sfx.rescan();
    const timer = setInterval(async () => {
        const p = await window.sfx.progress();
        if (p.total) {
            $('frText').textContent = `${p.done.toLocaleString()} of ${p.total.toLocaleString()} sounds, about ${Math.max(1, Math.round(p.eta / 60))} min left`;
            $('frBar').style.width = `${Math.round((p.done / p.total) * 100)}%`;
        }
        if (p.finished && !p.running) {
            clearInterval(timer);
            $('firstRun').hidden = true;
            load();
        }
    }, 1000);
}

// ---------------------------------------------------------------- filtering

// Keys that sit well with a key: itself, its relative major or minor, and one step either
// way round the circle of fifths (same rule as compatible() in engine/analyse.js).
function compatible(key) {
    const [tonic, mode] = key.split(' ');
    const t = NAMES.indexOf(tonic);
    const rel = mode === 'major' ? `${NAMES[(t + 9) % 12]} minor` : `${NAMES[(t + 3) % 12]} major`;
    return [key, rel, `${NAMES[(t + 7) % 12]} ${mode}`, `${NAMES[(t + 5) % 12]} ${mode}`];
}

// true when the sound fits the key, false when it clashes, null when it has no clear pitch.
function fitsKey(s, key) {
    if (!key) return null;
    if (s.key) return compatible(key).includes(s.key);
    if (s.note) {
        const [tonic, mode] = key.split(' ');
        const step = (NAMES.indexOf(s.note) - NAMES.indexOf(tonic) + 12) % 12;
        return SCALES[mode].includes(step);
    }
    return null;
}

const keyFits = (s) => fitsKey(s, state.music && state.music.key);

function passesKeyFilter(s) {
    const f = state.keyFilter;
    if (f === 'any') return true;
    if (f === 'haskey') return !!(s.key || s.note);
    if (f === 'noclash') return keyFits(s) !== false;
    if (f === 'fits') return keyFits(s) === true;
    return fitsKey(s, f) === true;
}

// Search, length and key filters. Favourites only is applied too, so the sidebar counts
// show how many favourites each category holds while it is on.
function filtered() {
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const [lo, hi] = state.length === 'any' ? LENGTHS.any : state.length.split('-').map(Number);
    return state.sounds.filter((s) =>
        s.dur >= lo && s.dur < hi &&
        words.every((w) => s.hay.includes(w)) &&
        passesKeyFilter(s));
}

function keyOptions() {
    const m = state.music && state.music.key;
    const mk = m ? SPELL[m] || m : '';
    const opt = (v, text, dis = false) => `<option value="${v}" ${dis ? 'disabled' : ''}>${text}</option>`;
    $('keyFilter').innerHTML =
        opt('any', 'Any key') +
        opt('fits', m ? `Fits the music: ${mk}` : 'Fits the music (read key first)', !m) +
        opt('noclash', m ? `No clash with ${mk}` : 'No clash with the music', !m) +
        opt('haskey', 'Has a key or note') +
        `<optgroup label="Fits a key">${KEYS.map((k) => opt(k, SPELL[k] || k)).join('')}</optgroup>`;
    if (!m && (state.keyFilter === 'fits' || state.keyFilter === 'noclash')) state.keyFilter = 'any';
    $('keyFilter').value = state.keyFilter;
    $('keyFilter').classList.toggle('active', state.keyFilter !== 'any');
}

function inView(s) {
    const v = state.view;
    if (v === 'all') return true;
    if (v === 'fav') return state.prefs.favs.includes(s.path);
    if (v === 'review') return s.review;
    if (v === 'recent') return state.prefs.recent.includes(s.path);
    if (v.startsWith('dir:')) return s.dirKeys.includes(v);
    return s.cat === v;
}

// ---------------------------------------------------------------- rendering

function render() {
    const favs = new Set(state.prefs.favs);
    const unfav = filtered();
    const base = state.favOnly ? unfav.filter((s) => favs.has(s.path)) : unfav;
    const counts = {};
    for (const s of base) {
        counts[s.cat] = (counts[s.cat] || 0) + 1;
        for (const k of s.dirKeys) counts[k] = (counts[k] || 0) + 1;
    }
    // While a filter narrows the library, folders with nothing left in them are hidden.
    const narrowed = state.favOnly || state.query || state.length !== 'any' || state.keyFilter !== 'any';
    const special = [
        ['fav', 'Favourites', base.filter((s) => favs.has(s.path)).length],
        ['recent', 'Recently used', base.filter((s) => state.prefs.recent.includes(s.path)).length],
        ['review', 'Needs review', base.filter((s) => s.review).length],
    ];
    const cat = (key, label, n) => `<div class="cat ${state.view === key ? 'on' : ''}" role="button" data-v="${key}">${label}<span class="n">${n.toLocaleString()}</span></div>`;
    $('cats').innerHTML =
        cat('all', 'All sounds', base.length) +
        '<div class="group">Library</div>' + state.builtIn.map(([k, label]) => cat(k, label, counts[k] || 0)).join('') +
        '<div class="group">My categories <span class="gadd" data-newcat="1" role="button" title="Make your own category">+ New</span></div>' +
        state.prefs.myCats.map(([k, l]) => cat(k, esc(l), counts[k] || 0).replace('class="cat ', 'class="cat mine ')).join('') +
        '<div class="group">Yours</div>' + special.map(([k, l, n]) => cat(k, l, n)).join('') +
        '<div class="group">Folders <span class="gadd" data-add="1" role="button" title="Add a folder of sounds to the library">+ Add</span></div>' +
        folderRows(counts, narrowed);

    let shown = base.filter(inView);
    if (state.view === 'recent') {
        const order = new Map(state.prefs.recent.map((p, i) => [p, i]));
        shown.sort((a, b) => order.get(a.path) - order.get(b.path));
    }
    state.shown = shown;
    state.sel = Math.min(state.sel, shown.length - 1);
    $('spacer').style.height = `${shown.length * ROW}px`;
    $('empty').hidden = shown.length > 0;
    $('empty').textContent = emptyText();
    $('favN').textContent = unfav.filter((s) => favs.has(s.path) && inView(s)).length || '';
    $('showAll').classList.toggle('on', !state.favOnly);
    $('showFav').classList.toggle('on', state.favOnly);
    keyOptions();
    drawRows();
    openEditor();
}

function emptyText() {
    const where = state.view === 'all' ? 'your library' : label(state.view);
    if (state.query) {
        const elsewhere = state.view === 'all' ? 0 : filtered().length;
        return `No sounds match "${state.query}" in ${where}.${elsewhere ? ` All sounds has ${elsewhere.toLocaleString()}.` : ''}`;
    }
    if (state.favOnly) return `No favourites in ${where} yet. Star a sound, or press F, to add it.`;
    if (state.keyFilter !== 'any') return `Nothing in ${where} fits this key. Most whooshes and clicks have no clear pitch, so they only show with Any key.`;
    if (state.view.startsWith('my:')) return `${where} is empty. Right-click any sound › Move to category › ${where} to add it.`;
    return 'Nothing here yet.';
}

function drawRows() {
    const list = $('list');
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 4);
    const last = Math.min(state.shown.length, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + 4);
    const favs = new Set(state.prefs.favs);
    let html = '';
    for (let r = first; r < last; r++) {
        const s = state.shown[r];
        // Green tags fit the key picked in the filter, or else the music's key.
        const fit = fitsKey(s, KEYS.includes(state.keyFilter) ? state.keyFilter : state.music && state.music.key);
        const k = s.key ? (SPELL[s.key] || s.key) : s.note ? `note ${s.note}` : '';
        const tags = (k ? `<span class="tag ${fit ? 'fit' : ''}" title="${fit ? 'Fits the key' : 'Detected key'}">${k}</span>` : '') +
            (s.review ? '<span class="tag review" title="The sorter was not sure. Right-click to move it.">?</span>' : '') +
            (state.ranges[s.path] ? `<span class="tag sect" title="Only this section is placed">${state.ranges[s.path][0].toFixed(1)} to ${state.ranges[s.path][1].toFixed(1)} s</span>` : '');
        // Outside a single category, say which category each sound is in.
        const mixed = ['all', 'fav', 'recent', 'review'].includes(state.view) || state.view.startsWith('dir:');
        const sub = mixed ? `${label(s.cat)} · ${s.folder}` : s.folder;
        html += `<div class="row ${r === state.sel ? 'sel' : ''} ${state.playing === s.i ? 'playing' : ''}" style="top:${r * ROW}px" data-r="${r}" role="button" draggable="true">
            <div class="play">${state.playing === s.i ? '&#9632;' : '&#9654;&#xFE0E;'}</div>
            <div title="${esc(s.name)}"><div class="name"><span class="t">${esc(s.title)}</span>${tags}</div><div class="sub">${esc(sub)}</div></div>
            <canvas width="256" height="56" data-r="${r}"></canvas>
            <div class="dur">${fmt(s.dur)}</div>
            <div class="star ${favs.has(s.path) ? 'on' : ''}" data-star="${r}" title="Favourite (F)">★</div>
        </div>`;
    }
    $('rows').innerHTML = html;
    for (const c of $('rows').querySelectorAll('canvas')) wave(c, state.shown[+c.dataset.r]);
}

function wave(canvas, s, progress = -1) {
    const g = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height, n = s.peaks.length, bw = w / n;
    g.clearRect(0, 0, w, h);
    const range = state.ranges[s.path];
    if (range) {
        // Row waveforms cover the first 40 s of the sound.
        const span = Math.min(s.dur, 40);
        g.fillStyle = COL['accent-wash'];
        g.fillRect((range[0] / span) * w, 0, ((range[1] - range[0]) / span) * w, h);
    }
    for (let i = 0; i < n; i++) {
        const a = Math.max(0.04, s.peaks[i]) * (h / 2 - 2);
        g.fillStyle = progress >= 0 && i / n <= progress ? COL.accent : (state.shown[state.sel] === s ? COL['wave-sel'] : COL.wave);
        g.fillRect(i * bw, h / 2 - a, Math.max(1, bw - 1), a * 2);
    }
}

const label = (k) => k.startsWith('dir:') ? (state.nodes.get(k) || { name: k.split('/').pop() }).name
    : (state.categories.find((c) => c[0] === k) || [k, k])[1];
const fmt = (d) => (d < 10 ? d.toFixed(1) : d < 60 ? Math.round(d) : `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`) + (d < 60 ? ' s' : '');
const secs = (t) => `${t.toFixed(2)} s`;
const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- preview

function fileUrl(p) {
    // C:\Sounds\a.wav becomes file:///C:/Sounds/a.wav
    const parts = splitPath(p).map(encodeURIComponent);
    if (/^[A-Za-z]%3A$/.test(parts[0])) parts[0] = '/' + parts[0].replace('%3A', ':');
    return 'file://' + parts.join('/');
}

// With no start given this toggles: it plays the sound's section if it has one, else all of it.
function play(s, from = null, to = null) {
    if (from === null) {
        if (state.playing === s.i) {
            stop();
            return;
        }
        [from, to] = state.ranges[s.path] || [0, null];
    }
    audio.src = `${fileUrl(s.path)}#t=${from.toFixed(3)}`;
    audio.play().catch(() => toast('This file could not be previewed', true));
    state.playing = s.i;
    state.playTo = to;
    drawRows();
    tick();
}

function stop() {
    audio.pause();
    state.playing = null;
    drawRows();
    drawEditor();
}

function tick() {
    if (state.playing === null) return;
    if (state.playTo !== null && audio.currentTime >= state.playTo) {
        stop();
        return;
    }
    const r = state.shown.findIndex((s) => s.i === state.playing);
    const c = $('rows').querySelector(`canvas[data-r="${r}"]`);
    if (c && audio.duration) wave(c, state.shown[r], audio.currentTime / Math.min(audio.duration, 40));
    drawEditor();
    requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- section editor

const sectionKey = (p, r) => `${p}|${r[0]}|${r[1]}`;

async function openEditor() {
    const s = state.shown[state.sel] || null;
    $('editor').hidden = !s;
    if (!s) {
        state.edit = null;
        return;
    }
    if (state.edit !== s) {
        state.edit = s;
        // Show the index waveform at once, then the detailed one of the whole sound.
        state.detail = { path: s.path, peaks: s.peaks, seconds: Math.min(s.dur, 40) };
        drawEditor();
        const d = await window.sfx.peaks(s.path);
        if (d && state.edit === s) state.detail = { path: s.path, ...d };
    }
    drawEditor();
}

function drawEditor() {
    const s = state.edit, d = state.detail;
    if (!s || !d || $('editor').hidden) return;
    const c = $('edWave');
    const w = c.clientWidth * 2, h = c.clientHeight * 2;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g = c.getContext('2d');
    const n = d.peaks.length, span = d.seconds, bw = w / n;
    const range = state.ranges[s.path];
    g.clearRect(0, 0, w, h);
    if (range) {
        const x0 = (range[0] / span) * w, x1 = (range[1] / span) * w;
        g.fillStyle = COL['accent-wash'];
        g.fillRect(x0, 0, x1 - x0, h);
        g.fillStyle = COL.accent;
        g.fillRect(x0 - 1, 0, 2, h);
        g.fillRect(x1 - 1, 0, 2, h);
    }
    for (let i = 0; i < n; i++) {
        const t = (i / n) * span;
        const a = Math.max(0.03, d.peaks[i]) * (h / 2 - 4);
        g.fillStyle = !range ? COL['wave-idle'] : t >= range[0] && t <= range[1] ? COL.accent : COL['wave-dim'];
        g.fillRect(i * bw, h / 2 - a, Math.max(1, bw - 0.5), a * 2);
    }
    if (state.playing === s.i) {
        g.fillStyle = COL.cream;
        g.fillRect((audio.currentTime / span) * w - 1, 0, 2, h);
    }
    $('edName').textContent = s.title;
    $('edPlay').textContent = range ? 'Play section' : 'Play';
    $('edClear').hidden = !range;
    $('edDrag').textContent = range ? 'Drag section' : 'Drag';
    $('edRange').textContent = range
        ? `Section ${secs(range[0])} to ${secs(range[1])} (${secs(range[1] - range[0])}). Double-click, Enter or Drag places only this part.`
        : `Whole sound, ${fmt(s.dur)}. Drag across the waveform to pick a section.`;
}

function edPos(e) {
    const rect = $('edWave').getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    return { px, width: rect.width, t: (px / rect.width) * state.detail.seconds };
}

// Snap to hundredths, drop sections too short to hear, and write the section file for dragging.
function finishRange(s) {
    const r = state.ranges[s.path];
    if (!r) return;
    r[0] = Math.round(r[0] * 100) / 100;
    r[1] = Math.round(r[1] * 100) / 100;
    if (r[1] - r[0] < 0.03) {
        delete state.ranges[s.path];
    } else {
        const key = sectionKey(s.path, r);
        if (!state.sections[key]) {
            window.sfx.makeSection(s.path, r[0], r[1]).then((f) => { if (f) state.sections[key] = f; });
        }
        play(s, r[0], r[1]);
    }
    drawRows();
    drawEditor();
}

function clearRange(s) {
    delete state.ranges[s.path];
    stop();
}

// The file to drag: the section's own file when a section is picked, else the original.
function dragFile(s) {
    const r = state.ranges[s.path];
    if (!r) return s.path;
    const f = state.sections[sectionKey(s.path, r)];
    if (!f) {
        toast('Preparing the section. Try the drag again in a moment.');
        window.sfx.makeSection(s.path, r[0], r[1]).then((x) => { if (x) state.sections[sectionKey(s.path, r)] = x; });
    }
    return f || null;
}

let edDrag = null;
$('edWave').addEventListener('mousedown', (e) => {
    const s = state.edit;
    if (!s || !state.detail) return;
    e.preventDefault();
    const { px, width, t } = edPos(e);
    const r = state.ranges[s.path];
    const span = state.detail.seconds;
    edDrag = null;
    if (r) {
        if (Math.abs(px - (r[0] / span) * width) < 7) edDrag = { mode: 'in' };
        else if (Math.abs(px - (r[1] / span) * width) < 7) edDrag = { mode: 'out' };
    }
    if (!edDrag) edDrag = { mode: 'new', anchor: t, startPx: px, moved: false };
});

window.addEventListener('mousemove', (e) => {
    if (!edDrag || !state.edit) return;
    const s = state.edit;
    const { px, t } = edPos(e);
    if (edDrag.mode === 'new') {
        if (!edDrag.moved && Math.abs(px - edDrag.startPx) < 4) return;
        edDrag.moved = true;
        state.ranges[s.path] = [Math.min(edDrag.anchor, t), Math.max(edDrag.anchor, t)];
    } else {
        const r = state.ranges[s.path];
        if (edDrag.mode === 'in') r[0] = Math.min(t, r[1] - 0.03);
        else r[1] = Math.max(t, r[0] + 0.03);
    }
    drawEditor();
});

window.addEventListener('mouseup', (e) => {
    if (!edDrag || !state.edit) return;
    const s = state.edit, d = edDrag;
    edDrag = null;
    if (d.mode === 'new' && !d.moved) {
        // A click plays from that point, stopping at the section end when inside the section.
        const r = state.ranges[s.path];
        const t = d.anchor;
        play(s, t, r && t >= r[0] && t < r[1] ? r[1] : null);
        return;
    }
    finishRange(s);
});

$('edPlay').addEventListener('click', () => state.edit && play(state.edit));
$('edClear').addEventListener('click', () => state.edit && clearRange(state.edit));
$('edDrag').addEventListener('dragstart', (e) => {
    e.preventDefault();
    const s = state.edit;
    const f = s && dragFile(s);
    if (f) {
        startDrag(f);
        used(s);
    }
});

audio.addEventListener('ended', stop);

// ---------------------------------------------------------------- placing

async function place(s) {
    stop();
    $('status').textContent = `Placing ${s.name}…`;
    const range = state.ranges[s.path] || null;
    const res = await window.sfx.placeAtPlayhead(s.path, state.prefs.track, s.dur, range);
    if (res && res.ok) {
        toast(`Placed ${range ? 'the section' : 'it'} on A${res.track} at the playhead`);
        used(s);
        refreshTracks();
    } else {
        toast((res && res.error) || 'Resolve did not place the clip', true);
    }
    $('status').textContent = 'Double-click or Enter places at the playhead. Drag to place anywhere.';
}

function used(s) {
    commitSearch();
    state.prefs.recent = [s.path, ...state.prefs.recent.filter((p) => p !== s.path)].slice(0, 60);
    savePrefs();
}

function savePrefs() {
    window.sfx.savePrefs(state.prefs);
}

function toggleFav(s) {
    const favs = state.prefs.favs;
    state.prefs.favs = favs.includes(s.path) ? favs.filter((p) => p !== s.path) : [...favs, s.path];
    savePrefs();
    render();
}

// ---------------------------------------------------------------- your own categories

// A small name box (Electron has no window.prompt). Resolves with the name, or null.
function askName(title, value, okText) {
    return new Promise((resolve) => {
        $('nbTitle').textContent = title;
        $('nbOk').textContent = okText;
        $('nbInput').value = value || '';
        $('nbErr').hidden = true;
        $('nameBox').hidden = false;
        setTimeout(() => { $('nbInput').focus(); $('nbInput').select(); }, 30);
        const done = (v) => { $('nameBox').hidden = true; nameBoxDone = null; resolve(v); };
        nameBoxDone = (ok) => {
            if (!ok) return done(null);
            const name = $('nbInput').value.trim().replace(/\s+/g, ' ');
            const clash = state.categories.find((c) => c[1].toLowerCase() === name.toLowerCase() && c[1] !== value);
            const err = !name ? 'Type a name.' : clash ? `There is already a category called ${clash[1]}.` : '';
            if (err) { $('nbErr').textContent = err; $('nbErr').hidden = false; return; }
            done(name);
        };
    });
}
let nameBoxDone = null;
$('nbOk').addEventListener('click', () => nameBoxDone && nameBoxDone(true));
$('nbCancel').addEventListener('click', () => nameBoxDone && nameBoxDone(false));
$('nbInput').addEventListener('keydown', (e) => {
    e.stopPropagation();  // typing here must not trigger the panel's shortcuts
    if (e.key === 'Enter') nameBoxDone && nameBoxDone(true);
    if (e.key === 'Escape') nameBoxDone && nameBoxDone(false);
});

async function newCategory() {
    const name = await askName('New category', '', 'Create');
    if (!name) return null;
    const key = 'my:' + Date.now().toString(36);
    state.prefs.myCats.push([key, name]);
    setCategories();
    savePrefs();
    render();
    return key;
}

async function renameCategory(key) {
    const c = state.prefs.myCats.find((x) => x[0] === key);
    const name = await askName('Rename category', c[1], 'Rename');
    if (!name || name === c[1]) return;
    c[1] = name;
    setCategories();
    savePrefs();
    render();
}

function deleteCategory(key) {
    const name = label(key);
    const paths = Object.keys(state.overrides).filter((p) => state.overrides[p] === key);
    const n = paths.length;
    if (!confirm(`Delete the category "${name}"?` + (n ? `\n\n${n > 1 ? `Its ${n} sounds go back to the categories IRO sorted them into` : 'Its sound goes back to the category IRO sorted it into'}. No files are deleted.` : ''))) return;
    for (const p of paths) delete state.overrides[p];
    window.sfx.saveOverrides(state.overrides);
    state.prefs.myCats = state.prefs.myCats.filter((x) => x[0] !== key);
    if (state.view === key) state.view = state.prefs.view = 'all';
    setCategories();
    savePrefs();
    applyOverrides();
    render();
    toast(`Deleted ${name}`);
}

function moveTo(s, cat) {
    state.overrides[s.path] = cat;
    window.sfx.saveOverrides(state.overrides);
    applyOverrides();
    render();
    toast(`Moved to ${label(cat)}`);
}

async function refreshTracks() {
    const tracks = await window.sfx.audioTracks();
    const cur = state.prefs.track;
    $('track').innerHTML = '<option value="auto">Auto</option>' +
        tracks.map((t) => `<option value="${t.index}">A${t.index}${t.name && t.name !== `Audio ${t.index}` ? ' ' + esc(t.name) : ''}</option>`).join('');
    $('track').value = tracks.some((t) => String(t.index) === String(cur)) ? cur : 'auto';
}

// ---------------------------------------------------------------- music key

async function readMusicKey() {
    $('musicInfo').textContent = 'Looking under the playhead…';
    const res = await window.sfx.musicUnderPlayhead();
    state.musicClips = res.clips || [];
    if (!state.musicClips.length) {
        state.music = null;
        $('musicInfo').textContent = res.error || 'No music clip under the playhead. Move the playhead over the music and try again.';
        $('musicClip').hidden = true;
        render();
        return;
    }
    $('musicClip').innerHTML = state.musicClips.map((c, i) => `<option value="${i}">A${c.track} ${esc(c.name)}</option>`).join('');
    $('musicClip').hidden = state.musicClips.length < 2;
    analyseClip(state.musicClips[0]);
}

async function analyseClip(clip) {
    $('musicInfo').textContent = `Listening to ${clip.name}…`;
    const k = await window.sfx.musicKey(clip);
    if (!k || !k.key) {
        state.music = null;
        $('musicInfo').textContent = `Could not hear a clear key in ${clip.name}.`;
    } else {
        state.music = k;
        const sure = k.conf >= 0.7 ? 'clear' : k.conf >= 0.45 ? 'fairly sure' : 'unsure';
        $('musicInfo').innerHTML = `Music: <b>${SPELL[k.key] || k.key}</b> <span class="muted">(${sure}, A${clip.track})</span>`;
        $('musicInfo').title = `Also fits: ${k.compatible.slice(1).map((x) => SPELL[x] || x).join(', ')}. Read from the part of the clip used on the timeline.`;
    }
    render();
}

// ---------------------------------------------------------------- menu and toast

function showMenu(x, y, s) {
    const m = $('menu');
    m.innerHTML = `<div class="label">Move to category</div>` +
        state.categories.map(([k, l]) => `<div data-move="${k}">${s.cat === k ? '✓ ' : ''}${esc(l)}</div>`).join('') +
        `<div data-act="newcat" class="add">+ New category…</div>` +
        `<div class="sep"></div><div data-act="place">Place at playhead</div>` +
        `<div data-act="fav">${state.prefs.favs.includes(s.path) ? 'Remove from favourites' : 'Add to favourites'}</div>` +
        (state.ranges[s.path] ? `<div data-act="clear">Clear section</div>` : '') +
        `<div data-act="reveal">${FINDER}</div>` +
        (state.overrides[s.path] ? `<div data-act="reset">Undo my category (was ${label(s.cat0)})</div>` : '');
    m.hidden = false;
    m.style.left = `${Math.min(x, innerWidth - 200)}px`;
    m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
    m.onclick = (e) => {
        const t = e.target.dataset;
        if (t.move) moveTo(s, t.move);
        if (t.act === 'newcat') newCategory().then((k) => k && moveTo(s, k));
        if (t.act === 'place') place(s);
        if (t.act === 'fav') toggleFav(s);
        if (t.act === 'reveal') window.sfx.reveal(s.path);
        if (t.act === 'clear') clearRange(s);
        if (t.act === 'reset') {
            delete state.overrides[s.path];
            window.sfx.saveOverrides(state.overrides);
            applyOverrides();
            render();
        }
        m.hidden = true;
    };
}

let toastTimer = null;
function toast(text, err = false) {
    const t = $('toast');
    t.textContent = text;
    t.className = err ? 'err' : '';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- events

function select(r, preview) {
    if (r < 0 || r >= state.shown.length) return;
    state.sel = r;
    const list = $('list');
    if (r * ROW < list.scrollTop) list.scrollTop = r * ROW;
    if ((r + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (r + 1) * ROW - list.clientHeight;
    drawRows();
    openEditor();
    if (preview) play(state.shown[r]);
}

$('list').addEventListener('scroll', () => requestAnimationFrame(drawRows));
window.addEventListener('resize', () => requestAnimationFrame(() => { drawRows(); drawEditor(); }));

// Each click redraws the rows, so the browser's own dblclick never fires (its two clicks land
// on different elements). Two clicks on the same row within 450 ms count as a double-click.
let lastClick = { r: -1, t: 0 };
$('rows').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const r = +row.dataset.r, s = state.shown[r];
    if (e.target.dataset.star) return toggleFav(s);
    const now = performance.now();
    if (lastClick.r === r && now - lastClick.t < 450) {
        lastClick = { r: -1, t: 0 };
        return place(s);
    }
    lastClick = { r, t: now };
    commitSearch();
    state.sel = r;
    openEditor();
    if (e.target.tagName === 'CANVAS') {
        // Row waveforms cover the first 40 s.
        const rect = e.target.getBoundingClientRect();
        return play(s, ((e.clientX - rect.left) / rect.width) * Math.min(s.dur, 40));
    }
    play(s);
});

$('rows').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    const s = state.shown[+row.dataset.r];
    const f = dragFile(s);
    if (f) {
        startDrag(f);
        used(s);
    }
});

$('rows').addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    select(+row.dataset.r, false);
    showMenu(e.clientX, e.clientY, state.shown[+row.dataset.r]);
});

document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#menu')) $('menu').hidden = true;
});

$('cats').addEventListener('click', (e) => {
    if (e.target.dataset.add) return addFolders(false);
    if (e.target.dataset.newcat) return newCategory();
    const tw = e.target.dataset.tw;
    if (tw) {
        const open = new Set(state.prefs.open);
        open.has(tw) ? open.delete(tw) : open.add(tw);
        state.prefs.open = [...open];
        savePrefs();
        return render();
    }
    const c = e.target.closest('.cat');
    if (!c) return;
    // Choosing a folder also opens it, as a first click in Finder's sidebar would.
    if (c.dataset.v.startsWith('dir:') && !state.prefs.open.includes(c.dataset.v)) state.prefs.open.push(c.dataset.v);
    state.view = c.dataset.v;
    state.prefs.view = state.view;
    state.sel = -1;
    $('list').scrollTop = 0;
    savePrefs();
    render();
});

// Dragging the sidebar's edge widens it, so long pack and folder names fit.
$('split').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = $('cats').offsetWidth;
    $('split').classList.add('drag');
    const move = (ev) => {
        const w = Math.min(Math.max(startW + ev.clientX - startX, 130), Math.min(420, innerWidth - 280));
        $('cats').style.width = `${w}px`;
        drawRows();
        drawEditor();
    };
    const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        $('split').classList.remove('drag');
        state.prefs.sidebar = $('cats').offsetWidth;
        savePrefs();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
});

function setQuery(q) {
    state.query = q;
    state.sel = -1;
    $('list').scrollTop = 0;
    render();
}

// ---------------------------------------------------------------- recent searches

const MAX_SEARCHES = 5;
let rememberTimer = null;
let rsItems = [];
let rsActive = -1;

// A search counts once the typing pauses or a result is used, and only if it found something.
function commitSearch() {
    clearTimeout(rememberTimer);
    const q = state.query;
    if (q.length < 2 || !filtered().length) return;
    const low = q.toLowerCase();
    // Typing on from the latest search ("whoo", then "whoosh") updates it rather than adding one.
    const rest = state.prefs.searches.filter((w, i) => {
        const l = w.toLowerCase();
        return l !== low && !(i === 0 && (low.startsWith(l) || l.startsWith(low)));
    });
    state.prefs.searches = [q, ...rest].slice(0, MAX_SEARCHES);
    savePrefs();
}

function hideRecentSearches() {
    $('recentSearches').hidden = true;
    rsActive = -1;
}

// Shows what fits the text typed so far. An empty search box shows all of them.
function showRecentSearches() {
    const typed = $('search').value.trim().toLowerCase();
    rsItems = state.prefs.searches.filter((w) => w.toLowerCase().includes(typed) && w.toLowerCase() !== typed);
    if (!rsItems.length) return hideRecentSearches();
    rsActive = Math.min(rsActive, rsItems.length - 1);
    $('recentSearches').innerHTML = '<div class="rsHead"><span>Recent searches</span><span class="rsClear" role="button" data-clear="1">Clear</span></div>' +
        rsItems.map((w, i) => `<div class="rs ${i === rsActive ? 'on' : ''}" role="button" data-i="${i}"><span class="t">${esc(w)}</span><span class="x" role="button" data-x="${i}" title="Remove from recent searches">&times;</span></div>`).join('');
    $('recentSearches').hidden = false;
}

function pickRecentSearch(i) {
    const q = rsItems[i];
    hideRecentSearches();
    clearTimeout(searchTimer);
    $('search').value = q;
    setQuery(q);
    // A saved search should find its sounds, so leave a category that has none of them.
    if (!state.shown.length && state.view !== 'all') {
        state.view = state.prefs.view = 'all';
        render();
    }
    commitSearch();
}

// mousedown, so the click lands before the search box loses focus.
$('recentSearches').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const d = e.target.dataset;
    if (d.clear) {
        state.prefs.searches = [];
    } else if (d.x !== undefined) {
        state.prefs.searches = state.prefs.searches.filter((w) => w !== rsItems[+d.x]);
    } else {
        const row = e.target.closest('.rs');
        if (row) pickRecentSearch(+row.dataset.i);
        return;
    }
    savePrefs();
    showRecentSearches();
});

// Opened by a click rather than on focus, because the box has focus whenever the panel opens.
$('search').addEventListener('click', showRecentSearches);
$('search').addEventListener('blur', hideRecentSearches);

let searchTimer = null;
$('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    clearTimeout(rememberTimer);
    searchTimer = setTimeout(() => setQuery($('search').value.trim()), 90);
    rememberTimer = setTimeout(commitSearch, 1500);
    rsActive = -1;
    showRecentSearches();
});

$('length').addEventListener('change', () => { state.length = $('length').value; render(); });
$('keyFilter').addEventListener('change', () => {
    state.keyFilter = $('keyFilter').value;
    state.sel = -1;
    $('list').scrollTop = 0;
    render();
});
$('showAll').addEventListener('click', () => { state.favOnly = false; render(); });
$('showFav').addEventListener('click', () => { state.favOnly = true; $('list').scrollTop = 0; render(); });
$('readKey').addEventListener('click', readMusicKey);
$('musicClip').addEventListener('change', () => analyseClip(state.musicClips[+$('musicClip').value]));
$('track').addEventListener('focus', refreshTracks);
$('track').addEventListener('change', () => { state.prefs.track = $('track').value; savePrefs(); });
$('volume').addEventListener('input', () => { audio.volume = state.prefs.volume = +$('volume').value; });
$('volume').addEventListener('change', savePrefs);
$('onTop').addEventListener('change', () => {
    state.prefs.onTop = $('onTop').checked;
    window.sfx.setOnTop(state.prefs.onTop);
    savePrefs();
});

// Sort new or changed files in the background and reload when done. Progress shows in the footer.
async function startRescan() {
    await window.sfx.rescan();
    $('rescan').disabled = true;
    const timer = setInterval(async () => {
        const p = await window.sfx.progress();
        $('status').textContent = p.total ? `Sorting: ${p.done.toLocaleString()} of ${p.total.toLocaleString()} new or changed files` : 'Checking your folders…';
        if (!p.running) {
            clearInterval(timer);
            $('rescan').disabled = false;
            $('status').textContent = p.total ? `Done: ${p.total.toLocaleString()} files added or updated` : 'Done: nothing new';
            load();
        }
    }, 800);
}

async function addFolders(fromWelcome) {
    const res = await window.sfx.addFolders();
    if (!res.added) {
        if (!fromWelcome) toast('Those folders are already in your library');
        return;
    }
    if (fromWelcome) return firstRun(true);
    toast(`Added ${res.added} folder${res.added > 1 ? 's' : ''}. Sorting the new sounds…`);
    startRescan();
}

async function removeFolder(node) {
    if (!confirm(`Remove "${node.name}" from IRO?\n\nThe files stay where they are on disk. You can add the folder again later.`)) return;
    await window.sfx.removeFolder(node.fsPath);
    if (state.view.startsWith(node.key)) state.view = state.prefs.view = 'all';
    startRescan();
}

$('rescan').addEventListener('click', startRescan);
$('frAdd').addEventListener('click', () => addFolders(true));

$('cats').addEventListener('contextmenu', (e) => {
    const mine = e.target.closest('.cat.mine');
    if (mine) {
        e.preventDefault();
        const key = mine.dataset.v;
        const m = $('menu');
        m.innerHTML = `<div data-act="rename">Rename…</div><div data-act="delete">Delete category</div>`;
        m.hidden = false;
        m.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`;
        m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 8)}px`;
        m.onclick = (ev) => {
            const act = ev.target.dataset.act;
            m.hidden = true;
            if (act === 'rename') renameCategory(key);
            if (act === 'delete') deleteCategory(key);
        };
        return;
    }
    const c = e.target.closest('.cat.dir');
    const node = c && state.nodes.get(c.dataset.v);
    if (!node) return;
    e.preventDefault();
    const m = $('menu');
    m.innerHTML = `<div data-act="finder">${FINDER}</div>` +
        (node.root ? `<div class="sep"></div><div data-act="remove">Remove from library</div>` : '');
    m.hidden = false;
    m.style.left = `${Math.min(e.clientX, innerWidth - 200)}px`;
    m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 8)}px`;
    m.onclick = (ev) => {
        const act = ev.target.dataset.act;
        if (act === 'finder') window.sfx.reveal(node.fsPath);
        if (act === 'remove') removeFolder(node);
        m.hidden = true;
    };
});

document.addEventListener('keydown', (e) => {
    const inSearch = document.activeElement === $('search');
    if (!$('nameBox').hidden) {
        if (e.key === 'Escape' && nameBoxDone) nameBoxDone(false);
        return;  // the name box is open: no shortcuts behind it
    }
    if (!$('recentSearches').hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            rsActive = Math.max(-1, Math.min(rsItems.length - 1, rsActive + (e.key === 'ArrowDown' ? 1 : -1)));
            showRecentSearches();
            return;
        }
        if (e.key === 'Enter' && rsActive >= 0) {
            e.preventDefault();
            pickRecentSearch(rsActive);
            return;
        }
        if (e.key === 'Escape') {
            hideRecentSearches();
            return;
        }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        $('search').blur();
        select(Math.max(0, state.sel + (e.key === 'ArrowDown' ? 1 : -1)), true);
    } else if (e.key === 'Enter' && state.sel >= 0) {
        e.preventDefault();
        place(state.shown[state.sel]);
    } else if (e.key === ' ' && !inSearch && state.sel >= 0) {
        e.preventDefault();
        play(state.shown[state.sel]);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('search').focus();
        $('search').select();
    } else if (e.key.toLowerCase() === 'f' && !inSearch && state.sel >= 0) {
        toggleFav(state.shown[state.sel]);
    } else if (e.key === 'Escape') {
        stop();
        $('menu').hidden = true;
        $('about').hidden = true;
    }
});

// ---------------------------------------------------------------- about

function startDrag(file) {
    window.sfx.startDrag(file);
}

window.sfx.about().then((p) => {
    $('aboutTitle').textContent = p.name;
    document.title = p.name;  // the panel's window title
    $('aboutDonate').hidden = !/^https?:/.test(p.donateUrl || '');
    $('aboutSite').hidden = !/^https?:/.test(p.website || '');
    $('aboutBtn').textContent = $('aboutDonate').hidden ? 'About' : '\u2665 Donate';
    $('aboutInfo').textContent = `Version ${p.version}.` + (p.supportEmail ? ` Help: ${p.supportEmail}` : '');
});
$('aboutBtn').addEventListener('click', () => { $('about').hidden = false; });
document.querySelector('header .logo').addEventListener('click', () => { $('about').hidden = false; });
$('aboutClose').addEventListener('click', () => { $('about').hidden = true; });
$('aboutDonate').addEventListener('click', () => window.sfx.open('donate'));
$('aboutSite').addEventListener('click', () => window.sfx.open('website'));

load();
