/* ============================================================================
   scripts/fetch-ytdlp.js
   ----------------------------------------------------------------------------
   Dijalankan otomatis saat `npm install` (postinstall).
   Mengunduh binary yt-dlp standalone (Linux) ke folder `bin/`.

   Binary ini TIDAK disimpan di repo (40 MB), tapi diunduh saat build.
   Kalau unduhan gagal, script tetap selesai dengan sukses (tidak fatal) —
   aplikasi akan mengunduhnya sendiri saat pertama kali dipakai.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const URL_BIN = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const TUJUAN = path.join(__dirname, '..', 'bin', 'yt-dlp');

(async function main() {
    try {
        if (process.platform !== 'linux') {
            console.log('[yt-dlp] bukan Linux — dilewati.');
            return;
        }
        if (fs.existsSync(TUJUAN) && fs.statSync(TUJUAN).size > 1000000) {
            console.log('[yt-dlp] binary sudah ada — dilewati.');
            return;
        }

        fs.mkdirSync(path.dirname(TUJUAN), { recursive: true });
        console.log('[yt-dlp] mengunduh binary…');

        const resp = await fetch(URL_BIN, { redirect: 'follow' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(TUJUAN, buf);
        try { fs.chmodSync(TUJUAN, 0o755); } catch (e) { /* diabaikan */ }

        console.log('[yt-dlp] selesai: ' + buf.length + ' bytes');
    } catch (err) {
        console.warn('[yt-dlp] unduh gagal (tidak fatal): ' + (err.message || err));
    }
})();
