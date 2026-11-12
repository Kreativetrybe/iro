// Audio decoding inside the panel, with no ffmpeg. Chromium (Resolve's Electron) decodes
// WAV, MP3, OGG, FLAC and M4A through Web Audio, and resamples to any rate on the way.
// WAV and AIFF are read here directly, so only the part that is needed leaves the disk:
// a 10 minute ambience costs 40 s of reading, not 10 minutes. AIFF is converted to WAV
// first because Chromium does not decode it. Runs in a renderer (worker window).
'use strict';

const fs = require('fs');

const CHUNK_SECONDS = 60;  // long PCM reads are decoded in pieces to keep memory flat

// ---------------------------------------------------------------- containers

// Read `len` bytes at `pos`, or fewer at the end of the file.
function readAt(fd, pos, len) {
    const buf = Buffer.alloc(len);
    const got = fs.readSync(fd, buf, 0, len, pos);
    return got < len ? buf.subarray(0, got) : buf;
}

// IEEE 754 80-bit extended (AIFF sample rates) to a JS number.
function ext80(b) {
    const exp = ((b[0] & 0x7f) << 8) | b[1];
    const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
    if (!exp && !hi && !lo) return 0;
    const v = (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
    return b[0] & 0x80 ? -v : v;
}

// Layout of an uncompressed WAV, RF64 or AIFF file, or null for anything else.
// { sr, ch, bits, float, bigEndian, signed8, dataOff, frames, blockAlign }
function probePcm(fd, size) {
    const head = readAt(fd, 0, 12);
    if (head.length < 12) return null;
    const id = head.toString('latin1', 0, 4), form = head.toString('latin1', 8, 12);
    if ((id === 'RIFF' || id === 'RF64') && form === 'WAVE') return probeWav(fd, size, id === 'RF64');
    if (id === 'FORM' && (form === 'AIFF' || form === 'AIFC')) return probeAiff(fd, size, form === 'AIFC');
    return null;
}

function probeWav(fd, size, rf64) {
    let pos = 12, fmt = null, dataOff = -1, dataLen = 0, bigData = null;
    while (pos + 8 <= size) {
        const h = readAt(fd, pos, 8);
        if (h.length < 8) break;
        const cid = h.toString('latin1', 0, 4);
        const clen = h.readUInt32LE(4);
        if (cid === 'ds64') bigData = Number(readAt(fd, pos + 8, 28).readBigUInt64LE(8));
        if (cid === 'fmt ') {
            const f = readAt(fd, pos + 8, Math.min(clen, 40));
            let tag = f.readUInt16LE(0);
            if (tag === 0xfffe && f.length >= 26) tag = f.readUInt16LE(24);  // WAVE_FORMAT_EXTENSIBLE
            fmt = { tag, ch: f.readUInt16LE(2), sr: f.readUInt32LE(4), blockAlign: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
        }
        if (cid === 'data') {
            dataOff = pos + 8;
            dataLen = rf64 && bigData != null ? bigData : clen;
            if (!dataLen || dataLen === 0xffffffff || dataOff + dataLen > size) dataLen = size - dataOff;
            break;
        }
        pos += 8 + clen + (clen & 1);
    }
    if (!fmt || dataOff < 0 || (fmt.tag !== 1 && fmt.tag !== 3) || !fmt.ch || !fmt.sr) return null;
    const blockAlign = fmt.blockAlign || fmt.ch * Math.ceil(fmt.bits / 8);
    return {
        sr: fmt.sr, ch: fmt.ch, bits: fmt.bits, float: fmt.tag === 3, bigEndian: false, signed8: false,
        dataOff, frames: Math.floor(dataLen / blockAlign), blockAlign,
    };
}

function probeAiff(fd, size, aifc) {
    let pos = 12, comm = null, dataOff = -1;
    while (pos + 8 <= size) {
        const h = readAt(fd, pos, 8);
        if (h.length < 8) break;
        const cid = h.toString('latin1', 0, 4);
        const clen = h.readUInt32BE(4);
        if (cid === 'COMM') {
            const c = readAt(fd, pos + 8, Math.min(clen, 26));
            comm = { ch: c.readInt16BE(0), frames: c.readUInt32BE(2), bits: c.readInt16BE(6), sr: ext80(c.subarray(8, 18)),
                comp: aifc && c.length >= 22 ? c.toString('latin1', 18, 22) : 'NONE' };
        }
        if (cid === 'SSND') dataOff = pos + 16 + readAt(fd, pos + 8, 4).readUInt32BE(0);
        pos += 8 + clen + (clen & 1);
    }
    if (!comm || dataOff < 0 || !comm.ch || !comm.sr) return null;
    const comp = comm.comp.toLowerCase();
    const float = comp === 'fl32' || comp === 'fl64';
    if (!['none', 'sowt', 'fl32', 'fl64', 'twos'].includes(comp)) return null;
    const bits = comp === 'fl32' ? 32 : comp === 'fl64' ? 64 : comm.bits;
    const blockAlign = comm.ch * Math.ceil(bits / 8);
    const frames = Math.min(comm.frames, Math.floor((size - dataOff) / blockAlign));
    return { sr: Math.round(comm.sr), ch: comm.ch, bits, float, bigEndian: comp !== 'sowt', signed8: true, dataOff, frames, blockAlign };
}

// A little-endian WAV holding frames [from, from+count) of a probed PCM file.
function wavSlice(fd, info, from, count) {
    const bytes = Math.ceil(info.bits / 8);
    const data = readAt(fd, info.dataOff + from * info.blockAlign, count * info.blockAlign);
    if (info.bigEndian && bytes > 1) {
        for (let i = 0; i + bytes <= data.length; i += bytes) data.subarray(i, i + bytes).reverse();
    }
    if (info.signed8 && bytes === 1) for (let i = 0; i < data.length; i++) data[i] = (data[i] + 128) & 0xff;
    return Buffer.concat([wavHeader(info.ch, info.sr, info.bits, info.float, data.length), data]);
}

function wavHeader(ch, sr, bits, float, dataLen) {
    const h = Buffer.alloc(44);
    const blockAlign = ch * Math.ceil(bits / 8);
    h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8, 'latin1');
    h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(float ? 3 : 1, 20);
    h.writeUInt16LE(ch, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * blockAlign, 28);
    h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bits, 34);
    h.write('data', 36, 'latin1'); h.writeUInt32LE(dataLen, 40);
    return h;
}

// ---------------------------------------------------------------- decoding

const contexts = new Map();
function ctxAt(rate) {
    if (!contexts.has(rate)) contexts.set(rate, new OfflineAudioContext(1, 1, rate));
    return contexts.get(rate);
}

async function webDecode(buf, rate) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    return ctxAt(rate).decodeAudioData(ab);
}

// Stereo folds to mono as ffmpeg's -ac 1 does (0.707 L + 0.707 R), so levels match the
// original Python indexer.
function toMono(ab, from = 0, to = ab.length) {
    const n = Math.max(0, to - from), out = new Float32Array(n), ch = ab.numberOfChannels;
    const g = ch === 2 ? Math.SQRT1_2 : 1 / ch;
    for (let c = 0; c < ch; c++) {
        const d = ab.getChannelData(c);
        for (let i = 0; i < n; i++) out[i] += d[from + i] * g;
    }
    return out;
}

function channelsOf(ab, from = 0, to = ab.length) {
    const out = [];
    for (let c = 0; c < ab.numberOfChannels; c++) out.push(ab.getChannelData(c).slice(from, to));
    return out;
}

function concat(parts) {
    const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

// Decode `dur` seconds (null for all) from `start` at `rate` (null keeps the file's own rate,
// or 48 kHz for compressed files). Returns { y, sr, full } with mono samples, or with
// mono=false { channels, sr, full }. full is the whole file's length in seconds.
async function decode(file, { start = 0, dur = null, rate = null, mono = true } = {}) {
    const fd = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const info = probePcm(fd, size);
        if (info) {
            const sr = rate || info.sr;
            const full = info.frames / info.sr;
            const first = Math.min(info.frames, Math.round(start * info.sr));
            const last = dur == null ? info.frames : Math.min(info.frames, first + Math.round(dur * info.sr));
            const step = CHUNK_SECONDS * info.sr;
            const monoParts = [], chParts = [];
            for (let a = first; a < last; a += step) {
                const ab = await webDecode(wavSlice(fd, info, a, Math.min(step, last - a)), sr);
                if (mono) monoParts.push(toMono(ab)); else chParts.push(channelsOf(ab));
            }
            if (mono) return { y: concat(monoParts), sr, full };
            const channels = [];
            for (let c = 0; c < info.ch; c++) channels.push(concat(chParts.map((p) => p[c])));
            return { channels, sr, full };
        }
        // Compressed: decode the whole file, then keep the part asked for.
        const sr = rate || 48000;
        const ab = await webDecode(fs.readFileSync(file), sr);
        const from = Math.min(ab.length, Math.round(start * sr));
        const to = dur == null ? ab.length : Math.min(ab.length, from + Math.round(dur * sr));
        const full = ab.duration;
        return mono ? { y: toMono(ab, from, to), sr, full } : { channels: channelsOf(ab, from, to), sr, full };
    } finally {
        fs.closeSync(fd);
    }
}

// A 24-bit WAV of the given channels, with short fades at each end so a cut that lands
// mid-wave does not click.
function writeWav24(out, channels, sr, fadeSeconds = 0.005) {
    const ch = channels.length, n = channels[0].length;
    const fade = Math.min(Math.round(fadeSeconds * sr), Math.floor(n / 4));
    const data = Buffer.alloc(n * ch * 3);
    let o = 0;
    for (let i = 0; i < n; i++) {
        const g = fade ? Math.min(1, i / fade, (n - 1 - i) / fade) : 1;
        for (let c = 0; c < ch; c++) {
            const v = Math.max(-8388608, Math.min(8388607, Math.round(channels[c][i] * g * 8388608)));
            data.writeIntLE(v, o, 3);
            o += 3;
        }
    }
    fs.writeFileSync(out, Buffer.concat([wavHeader(ch, sr, 24, false, data.length), data]));
}

module.exports = { decode, writeWav24, probePcm };
