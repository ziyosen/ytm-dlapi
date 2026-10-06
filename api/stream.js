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

/* Kirim balasan ke browser (206 selalu, dengan Content-Range eksplisit) */
function teruskan(res, upstream, mulai, akhir, totalUkuran) {
    res.status(206);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    const panjang = akhir - mulai + 1;
    if (totalUkuran && totalUkuran > 0) {
        res.setHeader('Content-Range', 'bytes ' + mulai + '-' + akhir + '/' + totalUkuran);
        res.setHeader('Content-Length', String(panjang));
    } else {
        /* Total tidak diketahui — pakai content-range dari googlevideo bila ada */
        const cr = upstream.headers.get('content-range');
        if (cr) res.setHeader('Content-Range', cr);
        const cl = upstream.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);
    }
}

/* Ukuran segmen per request: 12 MB. Browser <audio> akan meminta segmen
   berikutnya (Range) secara otomatis, jadi lagu berapapun panjangnya
   tetap utuh sambil fungsi Vercel tidak pernah kena batas eksekusi. */
const UKURAN_SEG = 12 * 1024 * 1024;

router.get('/song/:videoId', async function (req, res) {
    const videoId = req.params.videoId;

    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: 'videoId tidak valid' });
    }

    /* ===== ALUR: SEGMENTED PROXY =====
       googlevideo mengikat URL ke IP server yang me-resolve (ip= di URL),
       jadi redirect langsung ke browser user selalu 403 → proxy WAJIB.
       Tapi streaming penuh lewat 1 request memicu batas waktu fungsi
       Vercel (maxDuration) → lagu mati di tengah.
       Solusi: kita membalas HANYA segmen 12 MB per request dengan status
       206 + Content-Range eksplisit. Browser <audio> otomatis meminta
       segmen berikutnya (HTTP Range standar) → pemutaran tak terbatas.
    */
    const range = req.headers.range;

    // Opsional: paksa player client tertentu, mis. ?client=android_vr
    // Berguna kalau IP server diblokir YouTube.
    const client = typeof req.query.client === 'string' ? req.query.client : '';

    // Daftar player client yang dicoba berurutan kalau satu gagal
    /* Daftar player client yang dicoba berurutan kalau satu gagal.
       Dibatasi 2 supaya total waktu resolve tidak melebihi batas 60s
       fungsi Vercel saat cold start. */
    const CLIENT_FALLBACK = ['', 'tv'];
    const klienCoba = client ? [client] : CLIENT_FALLBACK;

    try {
        /* Tentukan potongan (segmen) yang diminta:
           - Browser kirim "Range: bytes=A-B" → hormati.
           - Tanpa Range → kita yang tentukan segmen 12 MB pertama, dan
             setiap request berikutnya dari browser otomatis membawa Range
             segmen berikutnya (standar HTTP untuk Accept-Ranges: bytes). */
        let mulai = 0, akhir = 0;
        let totalUkuran = null;
        const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
        if (m) {
            if (m[1] !== '') mulai = parseInt(m[1], 10);
            if (m[2] !== '') akhir = parseInt(m[2], 10);
        } else {
            akhir = mulai + UKURAN_SEG - 1; /* fallback: segmen pertama */
        }

        let info = null;
        let upstream = null;
        let terakhirGagal = '';

        for (let ci = 0; ci < klienCoba.length; ci++) {
            const c = klienCoba[ci];
            try {
                info = await infoLagu(videoId, false, c);
                totalUkuran = info.size || null;

                /* Minta offset di luar ukuran file? Balas 416 eksplisit
                   (standar HTTP) — bukan 502, supaya player tahu audio habis */
                if (totalUkuran && mulai >= totalUkuran) {
                    return res.status(416).json({ error: 'Range di luar ukuran audio' });
                }

                /* Tanpa Range dari browser: pilih sendiri segmen 12 MB */
                if (!m) {
                    akhir = mulai + UKURAN_SEG - 1;
                }
                /* Range open-ended ("bytes=0-") → clamp ke segmen 12 MB juga */
                if (akhir <= 0 || akhir - mulai + 1 > UKURAN_SEG) {
                    akhir = mulai + UKURAN_SEG - 1;
                }
                if (totalUkuran && akhir >= totalUkuran) akhir = totalUkuran - 1;

                const rangeUpstream = 'bytes=' + mulai + '-' + akhir;
                upstream = await ambilDariYouTube(info.url, rangeUpstream);

                /* URL kedaluwarsa? ambil ulang tanpa cache */
                if (upstream.status === 403 || upstream.status === 401) {
                    lupakan(videoId, c);
                    info = await infoLagu(videoId, true, c);
                    upstream = await ambilDariYouTube(info.url, rangeUpstream);
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

        /* Total ukuran file: dari header Content-Range googlevideo (paling akurat) */
        let total = totalUkuran || 0;
        const crv = upstream.headers.get('content-range'); // contoh: bytes 0-4194303/5234567
        if (crv) {
            const t = /\/(\d+)$/.exec(crv.trim());
            if (t) total = parseInt(t[1], 10);
        }

        teruskan(res, upstream, mulai, akhir, total);

        const body = Readable.fromWeb(upstream.body);
        let selesai = false;

        function tutupRapi() {
            if (selesai) return;
            selesai = true;
            try { res.end(); } catch (e) { /* diabaikan */ }
            try { body.destroy(); } catch (e) { /* diabaikan */ }
        }

        req.on('close', tutupRapi);
        body.on('error', tutupRapi);
        res.on('finish', function () { selesai = true; });
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

/* ---- Siapkan lagu (resolve URL saja, tanpa download audio) ----
   Dipakai front-end untuk prefetch: memanggil ini mengisi cache server
   sehingga pemutaran berikutnya langsung nyala. */
router.get('/prepare/:videoId', async function (req, res) {
    const videoId = req.params.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: 'videoId tidak valid' });
    }
    try {
        const info = await infoLagu(videoId, false, req.query.client || '');
        res.status(200).json({ ok: true, videoId: videoId, title: info.title });
    } catch (err) {
        res.status(502).json({ ok: false, error: (err && err.message) || String(err) });
    }
});

module.exports = router;
