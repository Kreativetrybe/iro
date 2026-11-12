// A pool of hidden worker windows (engine/worker.html) that run audio jobs in parallel.
// Windows start when work arrives and close after a minute without any.
'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');

const IDLE_MS = 60000;
// Garbage collection in a hidden window is lazy, so a long sort would let each worker grow
// past a gigabyte. A worker that passes this is closed after its job and a fresh one starts.
const MAX_RSS = 450 * 1024 * 1024;

class Pool {
    constructor(size) {
        this.size = Math.max(1, size || Math.min(3, Math.max(1, Math.floor(os.cpus().length / 2))));
        this.workers = [];      // { win, busy, ready }
        this.queue = [];        // { id, type, args, resolve }
        this.pending = new Map();
        this.nextId = 1;
        this.idleTimer = null;
        ipcMain.on('job:ready', (e) => {
            const w = this.workers.find((w) => w.win.webContents.id === e.sender.id);
            if (w) { w.ready = true; this.pump(); }
        });
        ipcMain.on('job:done', (e, { id, result, error, rss }) => {
            const w = this.workers.find((w) => w.win.webContents.id === e.sender.id);
            if (w) {
                w.busy = null;
                if (rss > MAX_RSS) this.drop(w, 'recycled');
            }
            const job = this.pending.get(id);
            this.pending.delete(id);
            if (job) job.resolve(error ? { error } : result);
            this.pump();
        });
    }

    run(type, args) {
        return new Promise((resolve) => {
            this.queue.push({ id: this.nextId++, type, args, resolve });
            this.pump();
        });
    }

    spawn() {
        const win = new BrowserWindow({
            show: false, width: 200, height: 200,
            webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false },
        });
        const w = { win, busy: null, ready: false };
        this.workers.push(w);
        win.loadFile(path.join(__dirname, 'worker.html'));
        // A worker that crashes takes its job down with it, not the whole scan.
        win.webContents.on('render-process-gone', () => this.drop(w, 'the decoder crashed on this file'));
        win.on('closed', () => this.drop(w, 'stopped'));
    }

    drop(w, why) {
        const i = this.workers.indexOf(w);
        if (i < 0) return;
        this.workers.splice(i, 1);
        if (w.busy) {
            const job = this.pending.get(w.busy.id);
            this.pending.delete(w.busy.id);
            if (job) job.resolve({ error: why });
        }
        if (!w.win.isDestroyed()) w.win.destroy();
        this.pump();
    }

    pump() {
        clearTimeout(this.idleTimer);
        while (this.queue.length) {
            const w = this.workers.find((w) => w.ready && !w.busy);
            if (!w) {
                if (this.workers.length < Math.min(this.size, this.queue.length + this.pending.size)) { this.spawn(); continue; }
                return;
            }
            const job = this.queue.shift();
            w.busy = job;
            this.pending.set(job.id, job);
            w.win.webContents.send('job', { id: job.id, type: job.type, args: job.args });
        }
        if (!this.pending.size) this.idleTimer = setTimeout(() => this.closeAll(), IDLE_MS);
    }

    closeAll() {
        for (const w of [...this.workers]) if (!w.busy) { this.workers.splice(this.workers.indexOf(w), 1); if (!w.win.isDestroyed()) w.win.destroy(); }
    }
}

module.exports = { Pool };
