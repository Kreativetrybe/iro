// A hidden window that does the audio work: sorting a file, a detailed waveform, a section
// file, or the key of a piece of music. Several run side by side, one process each.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { ipcRenderer } = require('electron');
const A = require('./analyse.js');
const { decode, writeWav24 } = require('./decode.js');

// Same fingerprint as the Python indexer, so existing libraries keep their duplicate records.
function fingerprint(file, size) {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(65536);
        const got = fs.readSync(fd, buf, 0, 65536, 0);
        return crypto.createHash('md5').update(buf.subarray(0, got)).update(String(size)).digest('hex').slice(0, 16);
    } finally {
        fs.closeSync(fd);
    }
}

const jobs = {
    async analyse({ file, roots }) {
        const st = fs.statSync(file);
        const { y, full } = await decode(file, { dur: A.MAX_SECONDS, rate: A.SR });
        if (y.length < A.SR * 0.02) return { path: file, error: 'empty or unreadable' };
        const dur = full || y.length / A.SR;
        return {
            path: file, ...A.classify(file, roots, y, dur),
            size: st.size, mtime: Math.floor(st.mtimeMs / 1000), fp: fingerprint(file, st.size),
        };
    },

    // A detailed waveform of up to 10 minutes, for the section editor.
    async peaks({ file, points }) {
        const { y } = await decode(file, { dur: 600, rate: 8000 });
        const out = new Array(points).fill(0);
        const step = y.length / points;
        let top = 1e-9;
        for (let i = 0; i < points; i++) {
            let m = 0;
            for (let j = Math.floor(i * step), end = Math.floor((i + 1) * step); j < end; j++) m = Math.max(m, Math.abs(y[j]));
            out[i] = m;
            top = Math.max(top, m);
        }
        return { peaks: out.map((v) => Math.round((v / top) * 100) / 100), seconds: y.length / 8000 };
    },

    async section({ file, from, to, out }) {
        const { channels, sr } = await decode(file, { start: from, dur: to - from, mono: false });
        if (!channels.length || !channels[0].length) return null;
        writeWav24(out, channels, sr);
        return out;
    },

    // Key of the part of a song used on the timeline (up to 90 s of it).
    async musicKey({ file, start, end }) {
        const dur = end ? Math.min(end - start, 90) : 90;
        const { y } = await decode(file, { start, dur, rate: A.SR });
        const k = A.keyOf(y, { music: true });
        if (k && k.key) k.compatible = A.compatible(k.key);
        return k;
    },
};

ipcRenderer.on('job', async (e, { id, type, args }) => {
    let result = null, error = null;
    try {
        result = await jobs[type](args);
    } catch (err) {
        error = String((err && err.message) || err).slice(0, 200);
    }
    ipcRenderer.send('job:done', { id, result, error, rss: process.memoryUsage().rss });
});
ipcRenderer.send('job:ready');
