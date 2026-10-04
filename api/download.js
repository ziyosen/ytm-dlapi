/* ============================================================================
   api/download.js  —  SUDAH TIDAK DIPAKAI
   ----------------------------------------------------------------------------
   Fitur unduh dihapus supaya aplikasi jadi ringan (tanpa ffmpeg) dan supaya
   lolos batas Vercel. File ini sengaja dibiarkan sebagai stub kecil.
   ========================================================================== */
module.exports = (req, res) => {
    res.status(410).json({
        error: 'Fitur unduh sudah tidak tersedia. Gunakan fitur putar (stream).',
    });
};
