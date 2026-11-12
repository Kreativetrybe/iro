// Sorting and key detection for sound effects and music. A port of the original Python
// indexer (numpy + ffmpeg) to plain JavaScript, so the panel needs nothing installed beyond
// DaVinci Resolve itself. Every function here works on mono Float32Array samples at SR.
'use strict';

const SR = 22050;
const MAX_SECONDS = 40;  // long ambiences only need their first 40 s analysed
const PEAKS = 96;        // waveform points stored per sound
const AUDIO_EXT = new Set(['.wav', '.mp3', '.aif', '.aiff', '.flac', '.m4a', '.ogg']);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// The category id "swish" is kept for Swooshes so moves people made by hand still apply.
const CATEGORIES = [
    ['whoosh', 'Whooshes'], ['swish', 'Swooshes'], ['riser', 'Risers'], ['impact', 'Impacts'],
    ['ambience', 'Ambience'], ['tactile', 'Tactile'], ['infographic', 'Infographics'],
    ['pop', 'Pops'], ['tick', 'Ticks'], ['glitch', 'Glitches'], ['musical', 'Musical'],
    ['foley', 'Foley and other'],
];

// Words that name a category, matched as whole words in the filename and folder names.
// The filename counts more than its folders, and the nearest folder more than far ones.
const WORDS = {
    riser: 'riser risers raiser raisers rise rising uplifter uplifters build buildup builder builders swell reverse reversed upsweep tension',
    whoosh: 'whoosh whooshes woosh passby passing flyby transition transitions sweep sweeps zoom',
    swish: 'swoosh swooshes swoop swoops swish swishes swipe swipes swing swings flick flicks throw cloth whip',
    impact: 'impact impacts hit hits boom booms punch punches slam slams thud thuds braam stomp stomps bang hits_ smash crash collisions collision explosion explosions exploding explode bomb bombs thunder thunderclap thunderclaps',
    ambience: 'ambience ambiance ambient atmosphere atmospheres athmosphere athmospheres atmos roomtone drone drones background crowd forest rain street city wind nature cafe coffee birds ocean waves traffic room',
    tactile: 'click clicks clicking mouse keyboard keyboards typing typewriter keypress button buttons switch switches tap taps trackpad mechanical pen pencil marker textmarker scissors paper writing lighter stapler zipper zippo texting page pages flipping flip typing',
    infographic: 'infographic infographics interface ui ux notification notifications beep beeps blip blips select menu hud data chart correct success error alert ding dings game inventory collect coin coins bonus star shape shapes digital',
    pop: 'pop pops popping bubble bubbles popup plop plops cork boing',
    tick: 'tick ticks ticking tock clock clocks metronome countdown timer ratchet windup wind-up',
    glitch: 'glitch glitches distort distortion distorted static vhs broken tape noise failure malfunction',
    musical: 'piano keys bell bells chime chimes note notes pluck plucks strings synth guitar chord chords sting stinger stingers lofi harp marimba',
    foley: 'footsteps footstep door doors car cars engine engines vehicle vehicles gun guns gunshot gunshots animal animals kitchen microwave eating fire water glass metal wood cartoon voice camera flash phone scooter heartbeat scream screaming cat dog dolphin bird birds horse sword rummage unpacking sanding hammering sawing barber',
};
// Which category wins when a name matches two equally. The Python sorter left this to set
// order, which changed from run to run.
const TIE_ORDER = ['riser', 'impact', 'whoosh', 'swish', 'infographic', 'pop', 'tick', 'tactile', 'musical', 'foley', 'glitch', 'ambience'];
const VOCAB =Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

// ---------------------------------------------------------------- small maths

const round = (x, d) => { const m = 10 ** d; return Math.round(x * m) / m; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// numpy's symmetric Hanning window.
const hannCache = new Map();
function hanning(n) {
    if (!hannCache.has(n)) {
        const w = new Float64Array(n);
        if (n === 1) w[0] = 1;
        else for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        hannCache.set(n, w);
    }
    return hannCache.get(n);
}

// Real FFT magnitudes |rfft(x)| (length n/2+1) for a power-of-two n, by packing the real
// input into an n/2-point complex FFT. Other lengths (only tiny sounds) use a plain DFT.
const fftPlans = new Map();
function plan(m) {
    if (fftPlans.has(m)) return fftPlans.get(m);
    const rev = new Uint32Array(m);
    const bits = Math.log2(m);
    for (let i = 0; i < m; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        rev[i] = r;
    }
    const cos = new Float64Array(m / 2 || 1), sin = new Float64Array(m / 2 || 1);
    for (let i = 0; i < m / 2; i++) { cos[i] = Math.cos((-2 * Math.PI * i) / m); sin[i] = Math.sin((-2 * Math.PI * i) / m); }
    // Twiddles for the real-input post-processing step (size 2m).
    const pc = new Float64Array(m + 1), ps = new Float64Array(m + 1);
    for (let k = 0; k <= m; k++) { pc[k] = Math.cos((-Math.PI * k) / m); ps[k] = Math.sin((-Math.PI * k) / m); }
    const p = { rev, cos, sin, pc, ps, re: new Float64Array(m), im: new Float64Array(m) };
    fftPlans.set(m, p);
    return p;
}

function rfftMag(x, out) {
    const n = x.length;
    const half = n >> 1;
    if (n < 4 || (n & (n - 1)) !== 0) return dftMag(x, out);
    const m = half;
    const P = plan(m);
    const { re, im, rev } = P;
    for (let i = 0; i < m; i++) { const j = rev[i]; re[j] = x[2 * i]; im[j] = x[2 * i + 1]; }
    for (let size = 2; size <= m; size <<= 1) {
        const step = m / size, h = size >> 1;
        for (let s = 0; s < m; s += size) {
            for (let k = 0; k < h; k++) {
                const a = s + k, b = a + h;
                const wr = P.cos[k * step], wi = P.sin[k * step];
                const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
            }
        }
    }
    out = out || new Float64Array(half + 1);
    for (let k = 0; k <= half; k++) {
        const k1 = k % m, k2 = (m - k) % m;
        const zr = re[k1], zi = im[k1], cr = re[k2], ci = -im[k2];
        const er = (zr + cr) / 2, ei = (zi + ci) / 2;          // FFT of even samples
        const or_ = (zi - ci) / 2, oi = -(zr - cr) / 2;         // FFT of odd samples
        const wr = P.pc[k], wi = P.ps[k];
        const xr = er + or_ * wr - oi * wi, xi = ei + or_ * wi + oi * wr;
        out[k] = Math.hypot(xr, xi);
    }
    return out;
}

function dftMag(x, out) {
    const n = x.length, bins = Math.floor(n / 2) + 1;
    out = out || new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
        let r = 0, i = 0;
        for (let t = 0; t < n; t++) { const a = (-2 * Math.PI * k * t) / n; r += x[t] * Math.cos(a); i += x[t] * Math.sin(a); }
        out[k] = Math.hypot(r, i);
    }
    return out;
}

function pearson(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
    return sab / Math.sqrt(saa * sbb);
}

function median(v) {
    const s = Float64Array.from(v).sort();
    const n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ---------------------------------------------------------------- key detection

// Energy per pitch class (12), summed over the frames that carry sound.
function chroma(y, sr = SR, nFft = 8192, hop = 4096) {
    if (y.length < nFft) { const p = new Float32Array(nFft); p.set(y); y = p; }
    const win = hanning(nFft);
    const n = 1 + Math.floor((y.length - nFft) / hop);
    const bin = sr / nFft;
    const lo = Math.ceil(100 / bin), hi = Math.floor(4200 / bin);
    const nb = hi - lo + 1;
    const pc = new Int32Array(nb);
    for (let j = 0; j < nb; j++) {
        const f = (lo + j) * bin;
        pc[j] = (((Math.round(12 * Math.log2(f / 440) + 9)) % 12) + 12) % 12;
    }
    const frame = new Float64Array(nFft), mag = new Float64Array(nFft / 2 + 1);
    const C = new Float64Array(n * 12), energy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const off = i * hop;
        for (let t = 0; t < nFft; t++) frame[t] = y[off + t] * win[t];
        rfftMag(frame, mag);
        let mx = 0, e = 0;
        for (let j = 0; j < nb; j++) { const v = mag[lo + j]; e += v; if (v > mx) mx = v; }
        energy[i] = e;
        const floor = mx * 0.05 + 1e-9;
        for (let j = 0; j < nb; j++) {
            const v = mag[lo + j];
            // Keep only spectral peaks so broadband noise does not smear every pitch class.
            // (Neighbours wrap round the band's ends, as numpy's roll does.)
            const prev = mag[lo + ((j - 1 + nb) % nb)], next = mag[lo + ((j + 1) % nb)];
            if (v > prev && v >= next && v > floor) C[i * 12 + pc[j]] += v;
        }
    }
    let emax = 0;
    for (let i = 0; i < n; i++) emax = Math.max(emax, energy[i]);
    const out = new Float64Array(12);
    let anyActive = false;
    for (let i = 0; i < n; i++) if (energy[i] > emax * 0.05) anyActive = true;
    for (let i = 0; i < n; i++) {
        if (anyActive && !(energy[i] > emax * 0.05)) continue;
        for (let k = 0; k < 12; k++) out[k] += C[i * 12 + k];
    }
    return out;
}

// { key: 'A minor', note: null, conf } or { key: null, note: 'G#', conf } for a single pitched
// note, or null when the sound is not tonal enough to name honestly. hint is a note read
// from the filename; it wins when the audio agrees. music=true is for songs: they use many
// notes, so skip the noise gate and the single-note reading and always name the best key.
function keyOf(y, { sr = SR, hint = null, music = false } = {}) {
    let peak = 0;
    for (let i = 0; i < y.length; i++) { const a = Math.abs(y[i]); if (a > peak) peak = a; }
    if (y.length < sr * 0.15 || peak < 1e-3) return null;
    const c = chroma(y, sr);
    let sum = 0;
    for (const v of c) sum += v;
    if (sum <= 0) return null;
    for (let k = 0; k < 12; k++) c[k] /= sum;
    const order = [...Array(12).keys()].sort((a, b) => c[b] - c[a]);
    if (hint && order.slice(0, 2).includes(NAMES.indexOf(hint))) return { key: null, note: hint, conf: 0.9 };
    // Spread of energy over the 12 pitch classes: near 1 is noise, low is tonal.
    let ent = 0;
    for (const v of c) ent -= v * Math.log(v + 1e-12);
    const spread = ent / Math.log(12);
    if (spread > 0.84 && !music) return null;
    const tonal = clamp((0.86 - spread) / 0.3, 0, 1);
    const top = c[order[0]], fifth = c[(order[0] + 7) % 12];
    // One dominant pitch class (with its harmonics) reads as a single note, not a key.
    if (!music && (top > 0.42 || (top + fifth > 0.62 && order[1] === (order[0] + 7) % 12))) {
        const conf = round(Math.min(1, top * 1.6) * (0.5 + tonal / 2), 2);
        return conf > 0.4 ? { key: null, note: NAMES[order[0]], conf } : null;
    }
    const scores = [];
    for (let tonic = 0; tonic < 12; tonic++) {
        for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
            const rolled = prof.map((_, i) => prof[(i - tonic + 12) % 12]);
            scores.push([pearson(c, rolled), `${NAMES[tonic]} ${mode}`]);
        }
    }
    scores.sort((a, b) => b[0] - a[0]);
    const best = scores[0][0], second = scores[1][0];
    if (music) return { key: scores[0][1], note: null, conf: round(clamp((best - 0.4) * 2, 0, 1), 2) };
    if (best < 0.6) return null;
    const conf = round(clamp((best - 0.6) * 3, 0, 1) * clamp((best - second) * 10 + 0.5, 0, 1) * tonal, 2);
    if (conf < 0.2) return null;
    return { key: scores[0][1], note: null, conf };
}

// A note written in a filename such as 'Bluthner_G#6_SUS' or 'D#5-p' or '-C 5'.
function noteInName(name) {
    const m = /(?:^|[_\s-])([A-G])([#b]?)\s?(-?[0-8])(?=$|[_\s\-.])/.exec(name)
        || /\(([A-G])([#b]?)(?:_[A-G][#b]?)?\)/.exec(name);
    if (!m) return null;
    const n = m[1] + m[2];
    return FLATS[n] || n;
}

// Keys that sit well together: the same key, its relative major or minor, and one step round
// the circle of fifths either way (the Camelot wheel neighbours).
function compatible(key) {
    if (!key) return [];
    const [tonic, mode] = key.split(' ');
    const t = NAMES.indexOf(tonic);
    const rel = mode === 'major' ? `${NAMES[(t + 9) % 12]} minor` : `${NAMES[(t + 3) % 12]} major`;
    return [key, rel, `${NAMES[(t + 7) % 12]} ${mode}`, `${NAMES[(t + 5) % 12]} ${mode}`];
}

// ---------------------------------------------------------------- sorting

function wordsOf(text) {
    text = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();  // FastWhoosh -> fast whoosh
    text = text.split('pop up').join('popup').split('room tone').join('roomtone')
        .split('wind-up').join('windup').split('fly by').join('flyby').split('pass by').join('passby');
    return text.split(/[^a-z]+/).filter(Boolean);
}

const stemOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };

// Category scores from the filename and its folders below the library root.
function nameScores(file, roots) {
    let rel = file;
    for (const r of roots) if (file.startsWith(r)) rel = file.slice(r.length);
    const parts = rel.split(/[\\/]/).filter(Boolean);
    const scores = {};
    parts.reverse().forEach((part, depth) => {
        const weight = depth === 0 ? 3 : 2 / depth;
        const stem = depth === 0 ? stemOf(part) : part;
        for (const w of new Set(wordsOf(stem))) {
            for (const cat in VOCAB) if (VOCAB[cat].has(w)) scores[cat] = (scores[cat] || 0) + weight;
        }
    });
    return scores;
}

// Shape of the sound: envelope, where its peak sits, how noisy and bright it is.
function features(y, dur) {
    const hop = 512;
    const n = Math.max(1, Math.floor(y.length / hop));
    const flen = y.length >= hop ? hop : y.length;
    const rms = new Float64Array(n), db = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let s = 0;
        for (let t = 0; t < flen; t++) { const v = y[i * hop + t]; s += v * v; }
        rms[i] = Math.sqrt(s / flen + 1e-12);
        db[i] = 20 * Math.log10(rms[i] + 1e-9);
    }
    let peakI = 0, dbMax = -Infinity;
    for (let i = 0; i < n; i++) { if (rms[i] > rms[peakI]) peakI = i; if (db[i] > dbMax) dbMax = db[i]; }
    const loud = Array.from(db, (d) => d > dbMax - 30);
    const win = n > 1 ? hanning(flen) : null;
    const frame = new Float64Array(flen), bins = Math.floor(flen / 2) + 1, mag = new Float64Array(bins);
    let num = 0, den = 0;
    const flats = [];
    for (let i = 0; i < n; i++) {
        if (!loud[i]) continue;
        for (let t = 0; t < flen; t++) frame[t] = y[i * hop + t] * (win ? win[t] : 1);
        rfftMag(frame, mag);
        let lg = 0, mean = 0;
        for (let k = 0; k < bins; k++) {
            const f = (k * SR) / flen;
            num += mag[k] * f; den += mag[k];
            lg += Math.log(mag[k] + 1e-9); mean += mag[k];
        }
        flats.push(Math.exp(lg / bins) / (mean / bins + 1e-9));
    }
    const centroid = num / (den + 1e-9);
    const flat = median(flats);
    const lt = [], ld = [];
    for (let i = 0; i < n; i++) if (loud[i]) { lt.push(i); ld.push(db[i]); }
    const slope = lt.length > 3 ? pearson(lt, ld) : 0;
    let steady = 99;
    if (ld.length > 3) {
        const m = ld.reduce((a, b) => a + b, 0) / ld.length;
        steady = Math.sqrt(ld.reduce((a, b) => a + (b - m) ** 2, 0) / ld.length);
    }
    // Sharp jumps in level: a whoosh swells once, a rummage or a stapler clicks many times.
    let bumps = 0;
    if (n > 4) {
        for (let i = 2; i < n; i += 2) if (db[i] - db[i - 2] > 8 && loud[i]) bumps++;
    }
    return {
        dur, attack: (peakI * hop) / SR, peak_pos: peakI / Math.max(1, n - 1), slope,
        centroid, flat, steady, active: (lt.length * hop) / SR, bumps,
    };
}

// Best category from the sound alone, with a confidence from 0 to 1.
function audioGuess(f, tonal) {
    const d = f.dur;
    if (d > 8 && f.steady < 6 && f.active > d * 0.8) return ['ambience', 0.7];
    if (d < 0.35) {
        if (tonal) return f.centroid < 2500 ? ['pop', 0.5] : ['infographic', 0.5];
        return d < 0.12 && f.centroid > 3000 ? ['tick', 0.5] : ['tactile', 0.5];
    }
    if (d > 1.5 && d < 15 && f.peak_pos > 0.7 && f.slope > 0.5 && f.bumps <= 1) return ['riser', 0.6];
    const smooth = f.bumps <= 1;
    if (smooth && f.attack < 0.03 && f.peak_pos < 0.15 && f.centroid < 1500 && d > 0.5) return ['impact', 0.5];
    if (smooth && d > 0.25 && d < 4 && f.peak_pos > 0.15 && f.peak_pos < 0.8 && f.flat > 0.15) {
        return d < 0.7 ? ['swish', 0.5] : ['whoosh', 0.5];
    }
    if (tonal && d < 3) return ['infographic', 0.35];
    return ['foley', 0.3];
}

function peaks(y, points = PEAKS) {
    if (!y.length) return new Array(points).fill(0);
    const p = [];
    for (let i = 0; i < points; i++) {
        const a = Math.floor((i * y.length) / points), b = Math.max(Math.floor(((i + 1) * y.length) / points), a + 1);
        let m = 0;
        for (let j = a; j < b && j < y.length; j++) { const v = Math.abs(y[j]); if (v > m) m = v; }
        p.push(m);
    }
    const top = Math.max(...p) || 1;
    return p.map((v) => round(v / top, 2));
}

// Everything the index stores for one sound. y is up to MAX_SECONDS of mono audio at SR and
// dur is the whole file's length.
function classify(file, roots, y, dur) {
    const name = file.split(/[\\/]/).pop();
    const key = keyOf(y, { hint: noteInName(name) });
    const f = features(y, dur);
    const scores = nameScores(file, roots);
    const [guess, gconf] = audioGuess(f, key !== null);
    let cat, conf, src;
    const ranked = Object.values(scores).sort((a, b) => b - a);
    if (ranked.length) {
        // On a tie, the category that names a kind of sound beats one that only describes it
        // ("Braam Distorted" is an impact, "Phone Ring Room" is not ambience).
        const best = Object.keys(scores).reduce((a, b) =>
            (scores[b] > scores[a] || (scores[b] === scores[a] && TIE_ORDER.indexOf(b) < TIE_ORDER.indexOf(a)) ? b : a));
        const margin = ranked[0] - (ranked.length > 1 ? ranked[1] : 0);
        // Names win, but when two categories tie on name the sound decides.
        cat = margin === 0 && guess in scores ? guess : best;
        conf = Math.min(1, 0.6 + margin * 0.15);
        src = 'name';
    } else {
        [cat, conf, src] = [guess, gconf, 'sound'];
    }
    // Whooshes and swooshes differ mostly by length: short light ones are swooshes.
    if (cat === 'whoosh' && dur < 0.45 && !wordsOf(name).includes('whoosh')) cat = 'swish';
    // From shape alone a chainsaw or a drill looks like a whoosh, so these are only trusted
    // from names. Unnamed ones wait in Needs review under Foley.
    if (src === 'sound' && ['whoosh', 'swish', 'impact', 'musical'].includes(cat)) [cat, conf] = ['foley', 0.3];
    return {
        name: stemOf(name), dur: round(dur, 3), cat, conf: round(conf, 2), src, review: conf < 0.45,
        key: key ? key.key : null, note: key ? key.note : null, kconf: key ? key.conf : null, peaks: peaks(y),
    };
}

module.exports = {
    SR, MAX_SECONDS, PEAKS, AUDIO_EXT, NAMES, CATEGORIES, WORDS,
    rfftMag, chroma, keyOf, noteInName, compatible, wordsOf, nameScores, features, audioGuess, peaks, classify,
};
