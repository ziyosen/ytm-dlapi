/* ============================================================================
   api/stream.js  —  Streaming audio (diputar langsung di browser)
   ----------------------------------------------------------------------------
   Versi RINGAN:
     - TANPA ffmpeg  -> tidak ada transcoding, bundle kecil, cold start cepat
     - Audio di-pipe mentah dari YouTube (m4a/AAC diutamakan, fallback webm)
     - Mendukung HTTP Range -> bisa di-seek (geser maju/mundur) di player
   ========================================================================== */
const express = require('express');
const ytdl = require('@distube/ytdl-core');

const router = express.Router();

/* Pilih format audio terbaik.
   Utamakan mp4/m4a (AAC) karena paling kompatibel dengan semua browser
   (termasuk Safari / iPhone), baru fallback ke webm/opus. */
function pickAudioFormat(formats) {
    const audio = formats
        .filter((f) => f.hasAudio && !f.hasVideo)
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    const m4a = audio.find(
        (f) => f.container === 'mp4' || String(f.mimeType || '').includes('mp4')
    );
    return m4a || audio[0] || null;
}

router.get('/song/:videoId', async (req, res) => {
    const videoId = req.params.videoId;

    if (!ytdl.validateID(videoId)) {
        return res.status(400).json({ error: 'videoId tidak valid' });
    }

    try {
        const info = await ytdl.getInfo(videoId);
        const format = pickAudioFormat(info.formats);

        if (!format) {
            return res.status(404).json({ error: 'Format audio tidak ditemukan' });
        }

        const total = Number(format.contentLength || 0);
        const mime = format.mimeType ? format.mimeType.split(';')[0] : 'audio/mp4';

        res.setHeader('Content-Type', mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store');

        const options = { format };

        /* ------------------- Dukungan Range (supaya seek jalan) ------------------ */
        const range = req.headers.range;
        if (range && total > 0) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            if (m) {
                let start = m[1] ? parseInt(m[1], 10) : 0;
                let end = m[2] ? parseInt(m[2], 10) : total - 1;

                if (isNaN(start) || start < 0) start = 0;
                if (isNaN(end) || end >= total) end = total - 1;

                if (start > end) {
                    res.status(416);
                    res.setHeader('Content-Range', 'bytes */' + total);
                    return res.end();
                }

                options.range = { start, end };
                res.status(206);
                res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
                res.setHeader('Content-Length', String(end - start + 1));
            }
        } else if (total > 0) {
            res.setHeader('Content-Length', String(total));
        }

        const stream = ytdl.downloadFromInfo(info, options);

        stream.on('error', (err) => {
            console.error('[stream] gagal:', err && err.message ? err.message : err);
            if (!res.headersSent) res.status(500).json({ error: 'Gagal memutar audio' });
            else res.end();
        });

        /* Kalau user ganti lagu / tutup tab, hentikan stream supaya tidak boros */
        req.on('close', () => {
            try { stream.destroy(); } catch (e) { /* diabaikan */ }
        });

        stream.pipe(res);
    } catch (err) {
        console.error('[stream] error:', err && err.message ? err.message : err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Gagal mengambil data lagu dari YouTube' });
        } else {
            res.end();
        }
    }
});

module.exports = router;
