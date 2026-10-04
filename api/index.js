/* ============================================================================
   api/index.js  —  Entry point untuk Vercel (serverless function)
   ----------------------------------------------------------------------------
   Ini SATU-SATUNYA function yang dipakai Vercel. Semua request diarahkan ke
   sini lewat `vercel.json`.

   Untuk jalan di komputer sendiri, tetap pakai:  node index.js
   ========================================================================== */
const express = require('express');

const app = express();

const search = require('./search.js');
const get = require('./get.js');
const stream = require('./stream.js');

const FRONTEND = `${__dirname}/../example-frontend`;

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
