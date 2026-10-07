/* Integrasi Gudang VPS untuk api/stream.js + api/ytdlp.js (repo ytm-dlapi).
   Tambahkan require ini di kedua pemakai, lalu pakai fungsi-fungsinya
   sebagai langkah di antara "cache URL lokal" dan "resolve lokal".

   Env di Vercel: GUDANG_URL (mis. https://dashboard.xinquins.de5.net)
                  GUDANG_TOKEN (sama dengan di VPS, jangan tulis di kode)
*/
const GUDANG_URL = (process.env.GUDANG_URL || '').replace(/\/$/, '');
const GUDANG_TOKEN = process.env.GUDANG_TOKEN || '';

function gudangAktif() {
    return !!(GUDANG_URL && GUDANG_TOKEN);
}

/* Ada berkasnya di gudang? Timeout pendek supaya tidak terasa. */
async function gudangAda(videoId) {
    if (!gudangAktif()) return false;
    try {
        const r = await fetch(GUDANG_URL + '/' + GUDANG_TOKEN + '/gudang/' + videoId, {
            method: 'HEAD',
            signal: AbortSignal.timeout(2500)
        });
        return r.status === 200;
    } catch (e) {
        return false;
    }
}

/* Minta VPS mengambil (resolve + unduh) lagu ini ke gudang.
   Dipanggil dari /prepare dan dari /song saat gudang kosong. */
async function gudangAmbil(videoId) {
    if (!gudangAktif()) return false;
    try {
        const r = await fetch(GUDANG_URL + '/' + GUDANG_TOKEN + '/gudang/ambil/' + videoId, {
            method: 'POST',
            signal: AbortSignal.timeout(55000)
        });
        return r.ok;
    } catch (e) {
        return false;
    }
}

/* URL siap-stream dari gudang (Vercel me-relay Range apa adanya). */
function gudangUrl(videoId) {
    return GUDANG_URL + '/' + GUDANG_TOKEN + '/gudang/' + videoId;
}

/* Pola pakai di stream.js (di antara cache & resolve lokal):
     if (await gudangAda(videoId)) -> relay dari gudangUrl(videoId)
     else if (await gudangAmbil(videoId)) -> relay dari gudangUrl(videoId)
     else -> resolve lokal bertahap (kode yang sudah live)
   dan tandai header X-Sumber: gudang|ambil-baru|lokal.
*/
module.exports = { gudangAda, gudangAmbil, gudangUrl, gudangAktif };
