// IRO: a Resolve Studio workflow integration that browses a sorted sound effect
// library and places sounds on the timeline. Sorting, waveforms, sections and key detection
// run in engine/ (plain JavaScript in hidden worker windows), so nothing else is installed.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WorkflowIntegration = require('./WorkflowIntegration.node');
const { Pool } = require('./engine/pool.js');
const { createIndexer } = require('./engine/indexer.js');
const product = require('./product.json');

const PLUGIN_ID = product.id;  // must match <Id> in manifest.xml (the build and install scripts set it)
// ~/Library/Application Support/<name> on a Mac, %APPDATA%\<name> on Windows. Named after the
// product, so this copy never shares settings with another copy of the panel.
const DATA = process.env.SFX_BROWSER_DATA || path.join(app.getPath('appData'), product.name);  // env: tests only
const BIN_NAME = product.name;  // the media pool bin placed sounds go into

let mainWindow = null;
let resolveObj = null;

function readJSON(name, fallback) {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function writeJSON(name, obj) {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = path.join(DATA, name + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, path.join(DATA, name));
}


// ---------------------------------------------------------------- library

function loadIndex() {
    const index = readJSON('index.json', null);
    return { index, folders: folderList(), overrides: readJSON('overrides.json', {}), progress: readJSON('progress.json', null) };
}

// ---------------------------------------------------------------- library folders

const expandHome = (f) => f.replace(/^~(?=[\\/]|$)/, os.homedir());
const tildeHome = (f) => (f.startsWith(os.homedir() + path.sep) ? '~' + f.slice(os.homedir().length) : f);
const inside = (child, parent) => child.startsWith(parent.replace(/[\\/]+$/, '') + path.sep);

// The library folders in config.json, with whether each one is reachable right now.
function folderList() {
    return (readJSON('config.json', {}).folders || []).map((f) => {
        const full = expandHome(f);
        return { path: full, name: path.basename(full), online: fs.existsSync(full) };
    });
}

async function addFolders() {
    const res = await dialog.showOpenDialog(mainWindow, {
        title: 'Add sound folders', buttonLabel: 'Add to library',
        properties: ['openDirectory', 'multiSelections'],
    });
    if (res.canceled || !res.filePaths.length) return { added: 0, folders: folderList() };
    const cfg = readJSON('config.json', {});
    let folders = cfg.folders || [];
    let added = 0;
    for (const picked of res.filePaths) {
        const have = folders.map(expandHome);
        // Already covered by a library folder: nothing to do.
        if (have.some((h) => picked === h || inside(picked, h))) continue;
        // A new folder that contains existing ones replaces them.
        folders = folders.filter((f) => !inside(expandHome(f), picked));
        folders.push(tildeHome(picked));
        added++;
    }
    writeJSON('config.json', { ...cfg, folders });
    return { added, folders: folderList() };
}

// Takes a folder out of the library. The files themselves are not touched.
function removeFolder(event, folder) {
    const cfg = readJSON('config.json', {});
    writeJSON('config.json', { ...cfg, folders: (cfg.folders || []).filter((f) => expandHome(f) !== folder) });
    return folderList();
}

const pool = new Pool(readJSON('config.json', {}).workers);
const indexer = createIndexer({ pool, readJSON, writeJSON, expandHome });

// A detailed waveform of the whole sound (the index only keeps 96 points of the first 40 s),
// for the section editor. Up to 10 minutes are read.
const peakCache = new Map();
async function detailPeaks(event, file, points = 800) {
    if (peakCache.has(file)) return peakCache.get(file);
    const res = await pool.run('peaks', { file, points });
    if (!res || res.error) return null;
    if (peakCache.size > 200) peakCache.delete(peakCache.keys().next().value);
    peakCache.set(file, res);
    return res;
}

// Write a selected section to its own short file (24-bit WAV at the source's rate, with 5 ms
// fades so a cut mid-wave does not click), so it can be dragged onto the timeline.
async function makeSection(event, file, from, to) {
    const dir = path.join(DATA, 'sections');
    fs.mkdirSync(dir, { recursive: true });
    const stem = path.basename(file).replace(/\.[^.]+$/, '').replace(/[\/:*?"<>|]/g, '-').slice(0, 80);
    const out = path.join(dir, `${stem} (${from.toFixed(2)}-${to.toFixed(2)}s).wav`);
    if (fs.existsSync(out)) return out;
    const res = await pool.run('section', { file, from, to, out });
    return res && !res.error && fs.existsSync(out) ? out : null;
}

function rescan() {
    indexer.start().catch((e) => writeJSON('progress.json', { finished: true, error: String(e) }));
    return true;
}

// ---------------------------------------------------------------- Resolve

// Resolve calls go one at a time so two quick double-clicks cannot interleave.
let queue = Promise.resolve();
function serial(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
}

async function getResolve() {
    if (!resolveObj) {
        if (!(await WorkflowIntegration.Initialize(PLUGIN_ID))) return null;
        resolveObj = await WorkflowIntegration.GetResolve();
    }
    return resolveObj;
}

async function getContext() {
    let resolve = null;
    try {
        resolve = await getResolve();
    } catch (e) {
        resolveObj = null;  // try a fresh connection next time
    }
    if (!resolve) return { error: 'Resolve is not reachable. Reopen the panel from Workspace › Workflow Integrations.' };
    const project = await (await resolve.GetProjectManager()).GetCurrentProject();
    if (!project) return { error: 'Open a project first' };
    const timeline = await project.GetCurrentTimeline();
    if (!timeline) return { error: 'Open a timeline first' };
    return { resolve, project, timeline, mediaPool: await project.GetMediaPool() };
}

function fpsOf(value) {
    const f = parseFloat(value);
    return isNaN(f) ? 25 : f;
}

// Timecode to an absolute frame number, with drop frame for 29.97 and 59.94.
function tcToFrames(tc, fps) {
    const drop = tc.includes(';');
    const [h, m, s, f] = tc.split(/[:;]/).map(Number);
    const base = Math.round(fps);
    if (!drop) return ((h * 60 + m) * 60 + s) * base + f;
    const dropPerMin = base === 60 ? 4 : 2;
    const totalMin = h * 60 + m;
    return ((h * 3600 + m * 60 + s) * base + f) - dropPerMin * (totalMin - Math.floor(totalMin / 10));
}

async function sfxBin(mediaPool) {
    const root = await mediaPool.GetRootFolder();
    for (const folder of (await root.GetSubFolderList()) || []) {
        if ((await folder.GetName()) === BIN_NAME) return folder;
    }
    return mediaPool.AddSubFolder(root, BIN_NAME);
}

// The media pool item for a file, imported into the IRO bin the first time it is used.
async function poolItemFor(mediaPool, file) {
    const bin = await sfxBin(mediaPool);
    for (const clip of (await bin.GetClipList()) || []) {
        if ((await clip.GetClipProperty('File Path')) === file) return clip;
    }
    const previous = await mediaPool.GetCurrentFolder();
    await mediaPool.SetCurrentFolder(bin);
    const items = await mediaPool.ImportMedia([file]);
    if (previous) await mediaPool.SetCurrentFolder(previous);
    return items && items.length ? items[0] : null;
}

async function trackIsFree(timeline, i, from, to) {
    for (const item of (await timeline.GetItemListInTrack('audio', i)) || []) {
        if ((await item.GetStart()) < to && (await item.GetEnd()) > from) return false;
    }
    return true;
}

// Auto picks a track named SFX or FX that is free under the new clip, then any free track
// below A1 (A1 is usually dialogue), and adds a new track when every one is busy.
async function pickTrack(timeline, from, to, channels) {
    const n = await timeline.GetTrackCount('audio');
    const named = [], others = [];
    for (let i = 1; i <= n; i++) {
        const name = ((await timeline.GetTrackName('audio', i)) || '').toLowerCase();
        (/\b(s?fx|sound ?effects?)\b/.test(name) ? named : others).push(i);
    }
    for (const i of [...named, ...others.filter((i) => i > 1)]) {
        if (await trackIsFree(timeline, i, from, to)) return i;
    }
    await timeline.AddTrack('audio', channels === 1 ? 'mono' : 'stereo');
    return n + 1;
}

// range is [fromSeconds, toSeconds] of the source to use, or null for the whole sound. A
// range is placed as a trimmed clip of the original file, so its handles can still be
// extended in Resolve.
async function placeAtPlayhead(event, file, trackChoice, seconds, range) {
    return serial(async () => {
        const ctx = await getContext();
        if (ctx.error) return { ok: false, error: ctx.error };
        const { timeline, mediaPool } = ctx;
        const item = await poolItemFor(mediaPool, file);
        if (!item) return { ok: false, error: 'Resolve could not import this file' };
        const fps = fpsOf(await timeline.GetSetting('timelineFrameRate'));
        const playhead = await timeline.GetCurrentTimecode();
        const from = tcToFrames(playhead, fps);
        const length = range ? range[1] - range[0] : seconds || 1;
        const to = from + Math.max(1, Math.ceil(length * fps));
        const channels = parseInt(await item.GetClipProperty('Audio Ch'), 10) || 2;
        const info = { mediaPoolItem: item, recordFrame: from, mediaType: 2 };
        if (range) {
            // Audio clips run at the clip's FPS (the project rate). Tested in Resolve 21.1: AppendToTimeline
            // treats endFrame as the first frame after the clip, so 60 to 112 gives 52 frames.
            const clipFps = parseFloat(await item.GetClipProperty('FPS')) || fps;
            info.startFrame = Math.round(range[0] * clipFps);
            info.endFrame = Math.max(info.startFrame + 1, Math.round(range[1] * clipFps));
        }
        let track = trackChoice === 'auto' ? await pickTrack(timeline, from, to, channels) : Number(trackChoice);
        let placed = await mediaPool.AppendToTimeline([{ ...info, trackIndex: track }]);
        if (!placed || !placed.length || typeof placed[0] !== 'object') {
            // Usually a mono or stereo mismatch with the track: put it on a fresh matching track.
            await timeline.AddTrack('audio', channels === 1 ? 'mono' : 'stereo');
            track = await timeline.GetTrackCount('audio');
            placed = await mediaPool.AppendToTimeline([{ ...info, trackIndex: track }]);
        }
        const ok = !!(placed && placed.length && typeof placed[0] === 'object');
        // Appending moves the playhead to the end of the new clip; put it back where it was.
        await timeline.SetCurrentTimecode(playhead);
        return ok ? { ok, track } : { ok, error: 'Resolve did not place the clip' };
    });
}

async function audioTracks() {
    return serial(async () => {
        const ctx = await getContext();
        if (ctx.error) return [];
        const n = await ctx.timeline.GetTrackCount('audio');
        const out = [];
        for (let i = 1; i <= n; i++) out.push({ index: i, name: await ctx.timeline.GetTrackName('audio', i) });
        return out;
    });
}

// Audio clips under the playhead that look like music: not camera files and not from the
// SFX library. Tracks named Music come first, then the longest clips.
async function musicUnderPlayhead() {
    return serial(async () => {
        const ctx = await getContext();
        if (ctx.error) return { error: ctx.error, clips: [] };
        const { timeline } = ctx;
        const folders = folderList().map((f) => f.path);
        const fps = fpsOf(await timeline.GetSetting('timelineFrameRate'));
        const at = tcToFrames(await timeline.GetCurrentTimecode(), fps);
        const n = await timeline.GetTrackCount('audio');
        const clips = [];
        for (let i = 1; i <= n; i++) {
            const trackName = await timeline.GetTrackName('audio', i);
            for (const item of (await timeline.GetItemListInTrack('audio', i)) || []) {
                const start = await item.GetStart(), end = await item.GetEnd();
                if (start > at || end <= at) continue;
                const mpi = await item.GetMediaPoolItem();
                const file = mpi ? await mpi.GetClipProperty('File Path') : '';
                if (!file || /\.(mp4|mov|mxf|braw|r3d|mts|avi)$/i.test(file)) continue;
                if (folders.some((f) => inside(file, f))) continue;
                clips.push({
                    track: i, trackName, name: await item.GetName(), file,
                    srcStart: await item.GetSourceStartTime(), srcEnd: await item.GetSourceEndTime(),
                    seconds: (end - start) / fps, music: /music|song|score|bed/i.test(trackName),
                });
            }
        }
        clips.sort((a, b) => (b.music - a.music) || (b.seconds - a.seconds));
        return { clips };
    });
}

const keyCache = new Map();
async function musicKey(event, clip) {
    const id = `${clip.file}|${clip.srcStart.toFixed(2)}|${clip.srcEnd.toFixed(2)}`;
    if (!keyCache.has(id)) {
        const res = await pool.run('musicKey', { file: clip.file, start: clip.srcStart, end: clip.srcEnd });
        if (!res || res.error) return null;
        keyCache.set(id, res);
    }
    return keyCache.get(id);
}

// ---------------------------------------------------------------- app

function registerHandlers() {
    ipcMain.handle('sfx:loadIndex', loadIndex);
    ipcMain.handle('sfx:addFolders', addFolders);
    ipcMain.handle('sfx:removeFolder', removeFolder);
    ipcMain.handle('sfx:loadPrefs', () => readJSON('prefs.json', {}));
    ipcMain.handle('sfx:savePrefs', (e, prefs) => writeJSON('prefs.json', prefs));
    ipcMain.handle('sfx:saveOverrides', (e, o) => writeJSON('overrides.json', o));
    ipcMain.handle('sfx:rescan', rescan);
    ipcMain.handle('sfx:progress', () => ({ running: indexer.running, ...(indexer.progress || readJSON('progress.json', {})) }));
    ipcMain.handle('sfx:reveal', (e, file) => shell.showItemInFolder(file));
    ipcMain.handle('sfx:peaks', detailPeaks);
    ipcMain.handle('sfx:makeSection', makeSection);
    ipcMain.handle('sfx:setOnTop', (e, on) => mainWindow && pinWindow(!!on));
    ipcMain.on('sfx:startDrag', (e, file) => {
        if (fs.existsSync(file)) e.sender.startDrag({ file, icon: path.join(__dirname, 'drag.png') });
    });
    ipcMain.handle('app:about', () => ({ ...product }));
    // Only http(s) links from product.json are opened, never one passed in from the page.
    ipcMain.handle('app:open', (e, which) => {
        const url = { donate: product.donateUrl, website: product.website }[which];
        if (/^https?:\/\//.test(url || '')) shell.openExternal(url);
    });
    ipcMain.handle('resolve:placeAtPlayhead', placeAtPlayhead);
    ipcMain.handle('resolve:audioTracks', audioTracks);
    ipcMain.handle('resolve:musicUnderPlayhead', musicUnderPlayhead);
    ipcMain.handle('resolve:musicKey', musicKey);
}

// macOS full screen gives Resolve its own Space, so a normal window stays behind on the old
// desktop. Pinned, the panel floats over every Space, including a full-screen one.
function pinWindow(on) {
    mainWindow.setAlwaysOnTop(on, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(on, { visibleOnFullScreen: on });
}

function createWindow() {
    const prefs = readJSON('prefs.json', {});
    mainWindow = new BrowserWindow({
        width: 560, height: 820, minWidth: 420, minHeight: 480,
        title: product.name, backgroundColor: '#0f1b31', useContentSize: true,
        // Resolve is usually the active app, so the first click must act, not just focus the panel.
        acceptFirstMouse: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js') },
    });
    pinWindow(prefs.onTop !== false);
    mainWindow.setMenu(null);
    mainWindow.on('close', () => app.quit());
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    registerHandlers();
    createWindow();
});

app.on('window-all-closed', () => app.quit());

app.on('quit', () => {
    try { WorkflowIntegration.CleanUp(); } catch (e) { /* Resolve may already be gone */ }
});
