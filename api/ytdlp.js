/* ============================================================================
   api/ytdlp.js  —  Pembungkus yt-dlp
   ----------------------------------------------------------------------------
   Sejak YouTube beralih ke SABR, library Node (ytdl-core / youtubei.js) tidak
   bisa lagi mengambil URL audio. yt-dlp masih bisa dan rutin diperbarui.

   Modul ini:
     1. Menyiapkan binary yt-dlp (PATH -> /tmp -> bawaan repo -> unduh).
     2. Mengambil metadata + URL audio sebuah video (dengan cache).
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const URL_BIN = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const BAWAAN = path.join(__dirname, '..', 'bin', 'yt-dlp');
const TMP_BIN = path.join(os.tmpdir(), 'yt-dlp-bin');

/* Argumen dasar: tanpa cache, tanpa playlist, timeout wajar */
const ARGS_DASAR = [
    '--no-warnings',
    '--no-playlist',
    '--no-cache-dir',
    '--socket-timeout', '20',
    '--retries', '2',
    '--extractor-retries', '2'
];

/* ============================ 1) Binary yt-dlp =========================== */

function bisaDijalankan(bin) {
    try {
        const r = spawnSync(bin, ['--version'], { timeout: 30000, stdio: 'ignore' });
        return r.status === 0;
    } catch (e) {
        return false;
    }
}

async function unduhBinary(tujuan) {
    const resp = await fetch(URL_BIN, { redirect: 'follow' });
    if (!resp.ok) throw new Error('Gagal mengunduh yt-dlp: HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(tujuan, buf);
    try { fs.chmodSync(tujuan, 0o755); } catch (e) { /* diabaikan */ }
}

let siap = null;

function dapatkanBinary() {
    if (!siap) {
        siap = (async function () {
            // 1) sudah pernah disiapkan di /tmp
            if (fs.existsSync(TMP_BIN) && bisaDijalankan(TMP_BIN)) return TMP_BIN;

            // 2) sudah terpasang di sistem (saat dikembangkan lokal)
            if (bisaDijalankan('yt-dlp')) return 'yt-dlp';

            // 3) binary bawaan repo (hasil postinstall)
            if (fs.existsSync(BAWAAN)) {
                try {
                    fs.copyFileSync(BAWAAN, TMP_BIN);
                    fs.chmodSync(TMP_BIN, 0o755);
                    if (bisaDijalankan(TMP_BIN)) return TMP_BIN;
                } catch (e) { /* lanjut ke unduhan */ }
            }

            // 4) unduh saat dijalankan (sekali per instance)
            await unduhBinary(TMP_BIN);
            if (!bisaDijalankan(TMP_BIN)) throw new Error('yt-dlp tidak bisa dijalankan');
            return TMP_BIN;
        })().catch(function (err) {
            siap = null; // supaya bisa dicoba lagi di request berikutnya
            throw err;
        });
    }
    return siap;
}

/* ========================= 2) Menjalankan yt-dlp ========================= */

async function jalankan(args, timeoutMs) {
    const bin = await dapatkanBinary();

    return new Promise(function (resolve, reject) {
        const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';

        const timer = setTimeout(function () {
            try { proc.kill('SIGKILL'); } catch (e) { /* diabaikan */ }
            reject(new Error('yt-dlp melebihi batas waktu'));
        }, timeoutMs || 45000);

        proc.stdout.on('data', function (d) { out += d; });
        proc.stderr.on('data', function (d) { err += d; });

        proc.on('error', function (e) {
            clearTimeout(timer);
            reject(e);
        });

        proc.on('close', function (code) {
            clearTimeout(timer);
            if (code === 0 && out.trim()) {
                resolve(out.trim());
                return;
            }
            const baris = err.trim().split('\n').filter(Boolean);
            reject(new Error((baris[baris.length - 1] || 'yt-dlp gagal').slice(0, 200)));
        });
    });
}

/* ===================== 3) Info + URL audio (dengan cache) ================ */

const cache = new Map();
const TTL = 45 * 60 * 1000;   // URL YouTube berlaku ±6 jam, kita pakai 45 menit
const MAKS_CACHE = 80;

/**
 * Ambil metadata + URL audio langsung sebuah video.
 * @param {string} videoId
 * @param {boolean} [paksa]  true = abaikan cache (dipakai kalau URL kedaluwarsa)
 */
async function infoLagu(videoId, paksa) {
    const now = Date.now();

    if (!paksa) {
        const c = cache.get(videoId);
        if (c && now - c.at < TTL) return c.data;
    }

    const out = await jalankan(
        ['-J', '-f', 'bestaudio[ext=m4a]/bestaudio/best'].concat(ARGS_DASAR, [
            'https://www.youtube.com/watch?v=' + videoId
        ])
    );

    let d;
    try {
        d = JSON.parse(out);
    } catch (e) {
        throw new Error('Jawaban yt-dlp tidak bisa dibaca');
    }

    const data = {
        videoId: d.id || videoId,
        title: d.title || '',
        artist: d.artist || d.uploader || d.channel || '',
        cover: d.thumbnail || '',
        duration: d.duration || 0,
        url: d.url || ''
    };

    if (!data.url) throw new Error('URL audio tidak ditemukan untuk video ini');

    cache.set(videoId, { at: now, data });
    if (cache.size > MAKS_CACHE) cache.delete(cache.keys().next().value);

    return data;
}

/** Hapus satu video dari cache (dipakai saat URL kedaluwarsa) */
function lupakan(videoId) {
    cache.delete(videoId);
}

module.exports = { infoLagu: infoLagu, lupakan: lupakan, dapatkanBinary: dapatkanBinary };
