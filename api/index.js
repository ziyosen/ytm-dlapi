/* ============================================================================
   api/index.js  —  Entry point untuk Vercel (serverless function)
   ----------------------------------------------------------------------------
   Ini SATU-SATUNYA function yang dipakai Vercel. Semua request diarahkan ke
   sini lewat `vercel.json`.

   Untuk jalan di komputer sendiri, tetap pakai:  node index.js
   ========================================================================== */
const path = require('path');
const express = require('express');

const app = express();

const search = require('./search.js');
const get = require('./get.js');
const stream = require('./stream.js');

// path.join WAJIB dipakai supaya tidak ada '..' di dalam path.
// res.sendFile menolak path yang mengandung '..' (403 Forbidden).
//
// Folder `public/` dipakai bersama:
//   - Vercel menyajikannya otomatis sebagai file statis (halaman depan = /)
//   - server lokal (node index.js) juga menyajikannya lewat express.static
const FRONTEND = path.join(__dirname, '..', 'public');

/* ------------------------------ CORS (API publik) ------------------------ */
// API ini dipakai juga oleh web lain (mis. domain play-music.js.org diarahkan
// ke sini, atau developer lain manggil API-nya). Header CORS dibuka agar
// request lintas domain dari browser tidak diblok.
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    // Preflight
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    next();
});

/* --------------------- Rate limit ringan (anti-serobot) ------------------ */
// Sederhana tanpa dependensi: maks 120 request/menit per IP utk /api.
// Kalau lewat, balas 429 — melindungi kuota Vercel dari pemakaian ekstrem.
const ipHit = new Map();          // ip -> { menit, hitung }
const MAKS_REQ_PER_MENIT = 120;

function cekRateLimit(req, res, next) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               req.socket.remoteAddress || 'tak-dikenal';
    const sekarang = Math.floor(Date.now() / 60000); // nomor menit sekarang

    let data = ipHit.get(ip);
    if (!data || data.menit !== sekarang) {
        data = { menit: sekarang, hitung: 0 };
        ipHit.set(ip, data);
    }
    data.hitung++;

    // Bersihkan entri lama biar Map tidak menumpuk
    if (ipHit.size > 5000) {
        for (const [k, v] of ipHit) {
            if (v.menit < sekarang - 2) ipHit.delete(k);
        }
    }

    res.setHeader('X-RateLimit-Limit', MAKS_REQ_PER_MENIT);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAKS_REQ_PER_MENIT - data.hitung));

    if (data.hitung > MAKS_REQ_PER_MENIT) {
        res.status(429).json({ error: 'Terlalu banyak request. Coba lagi sebentar.' });
        return;
    }
    next();
}

app.use('/api/', cekRateLimit);

/* ------------------------------ Halaman depan ---------------------------- */
app.get('/', (req, res) => {
    res.sendFile(`${FRONTEND}/index.html`);
});

/* --------------------------------- Routes -------------------------------- */
app.use('/api/', search);
app.use('/api/get', get);
app.use('/api/stream', stream);

/* ------------------------------- File statis ----------------------------- */
app.use(express.static(FRONTEND));

/* --------------------------------- Export -------------------------------- */
// Vercel membutuhkan app-nya di-export. JANGAN pakai app.listen() di sini.
module.exports = app;
