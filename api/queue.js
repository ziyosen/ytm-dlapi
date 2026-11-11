/* queue.js — YTM-01: API antrean lagu per sesi (in-memory + opsional persist).
   Routes (dipasang di api/index.js sebagai /api/queue):
     GET  /api/queue                 -> daftar antrean
     POST /api/queue/add             -> {videoId, title} tambah
     POST /api/queue/remove          -> {index} hapus
     POST /api/queue/reorder         -> {from, to} geser
     POST /api/queue/clear           -> kosongkan
     POST /api/queue/next            -> keluarkan lagu pertama (dipanggil saat lagu selesai)
   Desain: single-session (server punya satu antrean aktif) — web player bos.
   Hermes, 11 Nov 2026. */
"use strict";

const express = require("express");
const router = express.Router();

/* in-memory antrean */
const queue = [];

function bersih(obj) {
    return {
        videoId: String(obj.videoId || "").slice(0, 32),
        title: String(obj.title || "Tanpa judul").slice(0, 200),
    };
}

router.get("/", (req, res) => {
    res.json({ ok: true, queue, total: queue.length });
});

router.post("/add", (req, res) => {
    const body = req.body || {};
    if (!body.videoId) {
        return res.status(400).json({ ok: false, error: "videoId wajib" });
    }
    if (queue.length >= 200) {
        return res.status(429).json({ ok: false, error: "antrean penuh (max 200)" });
    }
    const item = bersih(body);
    // dedupe: jangan dobel di antrean
    if (queue.some((x) => x.videoId === item.videoId)) {
        return res.json({ ok: true, added: false, reason: "sudah ada", queue, total: queue.length });
    }
    queue.push(item);
    res.json({ ok: true, added: true, item, total: queue.length });
});

router.post("/remove", (req, res) => {
    const i = Number((req.body || {}).index);
    if (!Number.isInteger(i) || i < 0 || i >= queue.length) {
        return res.status(400).json({ ok: false, error: "index tidak valid" });
    }
    const [item] = queue.splice(i, 1);
    res.json({ ok: true, removed: item, total: queue.length });
});

router.post("/reorder", (req, res) => {
    const { from, to } = req.body || {};
    const f = Number(from), t = Number(to);
    if (!Number.isInteger(f) || !Number.isInteger(t) || f < 0 || t < 0 || f >= queue.length || t >= queue.length) {
        return res.status(400).json({ ok: false, error: "from/to tidak valid" });
    }
    const [item] = queue.splice(f, 1);
    queue.splice(t, 0, item);
    res.json({ ok: true, queue, total: queue.length });
});

router.post("/clear", (req, res) => {
    queue.length = 0;
    res.json({ ok: true, total: 0 });
});

router.post("/next", (req, res) => {
    const [item] = queue.length ? queue.splice(0, 1) : [];
    res.json({ ok: true, played: item || null, next: queue[0] || null, total: queue.length });
});

module.exports = router;
