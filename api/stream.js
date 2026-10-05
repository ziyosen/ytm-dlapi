/* ============================================================================
   api/stream.js  —  Streaming audio (untuk diputar langsung di browser)
   ----------------------------------------------------------------------------
   Cara kerja:
     1. yt-dlp dipakai untuk mengambil URL audio langsung (karena YouTube sudah
        beralih ke SABR, library Node biasa tidak bisa lagi).
     2. URL itu diproksi oleh server ini, sehingga:
          - Mendukung HTTP Range  -> bisa digeser (seek) di player
          - Tetap satu domain dengan halaman -> tidak ada masalah CORS
     3. URL di-cache 45 menit. Kalau kedaluwarsa (HTTP 403), otomatis diambil ulang.
   ========================================================================== */
const express = require('express');
const { Readable } = require('stream');
const { infoLagu, lupakan } = require('./ytdlp.js');

const router = express.Router();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
/* PENTING: UA ini HARUS sama dengan yang dipakai yt-dlp saat mengambil URL.
   Kalau berbeda, googlevideo menjawab 403. */

/* Ambil audio dari YouTube memakai URL yang sudah di-resolve yt-dlp */
async function ambilDariYouTube(url, range) {
    const headers = { 'User-Agent': UA };
    if (range) headers.Range = range;
    return fetch(url, { headers });
}

/* Kirim balasan ke browser */
function teruskan(res, upstream) {
    res.status(upstream.status);

    const penting = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (let i = 0; i < penting.length; i++) {
        const v = upstream.headers.get(penting[i]);
        if (v) res.setHeader(penting[i], v);
    }
    if (!upstream.headers.get('content-type')) res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
}

router.get('/song/:videoId', async function (req, res) {
    const videoId = req.params.videoId;

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: 'videoId tidak valid' });
    }

    const range = req.headers.range;

    // Opsional: paksa player client tertentu, mis. ?client=android_vr
    // Berguna kalau IP server diblokir YouTube.
    const client = typeof req.query.client === 'string' ? req.query.client : '';

    // Daftar player client yang dicoba berurutan kalau satu gagal
    const CLIENT_FALLBACK = ['', 'tv', 'android_vr', 'mweb'];
    const klienCoba = client ? [client] : CLIENT_FALLBACK;

    try {
        let info = null;
        let upstream = null;
        let terakhirGagal = '';

        for (let ci = 0; ci < klienCoba.length; ci++) {
            const c = klienCoba[ci];
            try {
                info = await infoLagu(videoId, false, c);
                upstream = await ambilDariYouTube(info.url, range);

                /* URL kedaluwarsa? ambil ulang tanpa cache */
                if (upstream.status === 403 || upstream.status === 401) {
                    lupakan(videoId, c);
                    info = await infoLagu(videoId, true, c);
                    upstream = await ambilDariYouTube(info.url, range);
                }

                if (upstream.ok || upstream.status === 206) break;
                terakhirGagal = 'HTTP ' + upstream.status;
            } catch (e) {
                terakhirGagal = e.message || String(e);
                info = null; upstream = null;
            }
        }

        if (!upstream || (!upstream.ok && upstream.status !== 206)) {
            return res.status(502).json({
                error: 'Server audio YouTube menolak' + (terakhirGagal ? ' (' + terakhirGagal + ')' : '') +
                       '. Kalau ini di Vercel, set env var YTDLP_COOKIES (cookies.txt akun Google).'
            });
        }

        teruskan(res, upstream);

        const body = Readable.fromWeb(upstream.body);
        req.on('close', function () { try { body.destroy(); } catch (e) { /* diabaikan */ } });
        body.on('error', function () { try { res.end(); } catch (e) { /* diabaikan */ } });
        body.pipe(res);
    } catch (err) {
        console.error('[stream] error:', err && err.message ? err.message : err);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Gagal memutar lagu: ' + (err.message || err) });
        } else {
            try { res.end(); } catch (e) { /* diabaikan */ }
        }
    }
});

module.exports = router;
