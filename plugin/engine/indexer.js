// Builds and updates the library index (index.json) from the folders in config.json.
// Only new or changed files are analysed; the work runs in the worker pool.
'use strict';

const fs = require('fs');
const path = require('path');
const { AUDIO_EXT, CATEGORIES } = require('./analyse.js');

function createIndexer({ pool, readJSON, writeJSON, expandHome }) {
    let running = null;
    let live = null;

    // Every audio file under the folders, skipping hidden folders and macOS resource forks.
    async function scan(folders) {
        const out = [];
        async function walk(dir) {
            let entries;
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
            for (const d of entries) {
                const p = path.join(dir, d.name);
                if (d.isDirectory()) {
                    if (!d.name.startsWith('.') && d.name !== '__MACOSX') await walk(p);
                } else if (!d.name.startsWith('._') && AUDIO_EXT.has(path.extname(d.name).toLowerCase())) {
                    out.push(p);
                }
            }
        }
        for (const f of folders) await walk(f);
        return out.sort();
    }

    async function run({ rebuild = false } = {}) {
        live = null;  // while folders are walked, the panel shows "Checking your folders"
        const cfg = readJSON('config.json', {});
        const folders = (cfg.folders || []).map(expandHome);
        const roots = folders.map((f) => f.replace(/[\\/]+$/, '') + path.sep);
        // A folder on a drive that is not plugged in is skipped, and its sounds are kept.
        const offline = folders.filter((f) => !fs.existsSync(f));
        const files = await scan(folders.filter((f) => !offline.includes(f)));
        const prev = rebuild ? { sounds: [] } : readJSON('index.json', null) || { sounds: [] };
        const old = new Map();
        for (const e of [...(prev.sounds || []), ...(prev.dupes || [])]) old.set(e.path, e);

        const keep = new Map(), todo = [];
        for (const p of files) {
            const e = old.get(p);
            let st;
            try { st = fs.statSync(p); } catch (err) { continue; }
            if (e && e.size === st.size && e.mtime === Math.floor(st.mtimeMs / 1000)) keep.set(p, e);
            else todo.push(p);
        }
        for (const [p, e] of old) {
            if (offline.some((f) => p.startsWith(f.replace(/[\\/]+$/, '') + path.sep))) keep.set(p, e);
        }

        const errors = [];
        let done = 0;
        const t0 = Date.now();
        live = { done: 0, total: todo.length, finished: false, eta: 0 };

        const write = (final) => {
            const seen = new Set(), sounds = [], dupes = [];
            // wav first, so a pack that ships both formats keeps the wav.
            const order = [...keep.keys()].sort((a, b) => {
                const wa = !a.toLowerCase().endsWith('.wav'), wb = !b.toLowerCase().endsWith('.wav');
                return wa !== wb ? wa - wb : a < b ? -1 : a > b ? 1 : 0;
            });
            for (const p of order) {
                const e = keep.get(p);
                // The same file copied into two folders, or the same sound as wav and mp3, shows up once.
                const twin = `${path.dirname(p)}|${e.name.toLowerCase()}|${Math.round(e.dur * 10) / 10}`;
                if (seen.has(e.fp) || seen.has(twin)) { dupes.push(e); continue; }
                seen.add(e.fp); seen.add(twin);
                sounds.push(e);
            }
            sounds.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
            writeJSON('index.json', { version: 1, updated: Math.floor(Date.now() / 1000), folders, offline,
                categories: CATEGORIES, sounds, dupes, errors });
            live = { done, total: todo.length, finished: final,
                eta: Math.round(((Date.now() - t0) / 1000 / Math.max(done, 1)) * (todo.length - done)) };
            writeJSON('progress.json', live);
        };

        await Promise.all(todo.map((p) => pool.run('analyse', { file: p, roots }).then((r) => {
            done++;
            if (!r || r.error) errors.push({ path: p, error: (r && r.error) || 'unreadable' });
            else keep.set(p, r);
            if (done % 250 === 0) write(false);
            else live = { ...live, done };
        })));
        write(true);
        return { files: files.length, analysed: todo.length, errors: errors.length, seconds: (Date.now() - t0) / 1000 };
    }

    return {
        // Starts a scan unless one is running. Resolves when it finishes.
        start(opts) {
            if (!running) running = run(opts).finally(() => { running = null; });
            return running;
        },
        get running() { return !!running; },
        get progress() { return live; },
    };
}

module.exports = { createIndexer };
