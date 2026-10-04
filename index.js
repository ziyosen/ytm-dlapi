/* ============================================================================
   index.js  —  Server lokal
   ----------------------------------------------------------------------------
   Di Vercel, entry point-nya adalah `api/index.js` (lihat vercel.json).
   File ini tetap dipertahankan supaya bisa dijalankan di komputer sendiri:

       node index.js
       npm start

   App-nya juga di-export supaya tetap kompatibel kalau Vercel memakai file ini.
   ========================================================================== */
const app = require('./api/index.js');
const port = process.env.PORT || 3000;

// Export untuk Vercel
module.exports = app;

// Listen HANYA kalau dijalankan langsung (bukan saat di-require)
if (require.main === module) {
    app.listen(port, () => {
        console.log(`App is now working on: ${port}`);
    });
}
