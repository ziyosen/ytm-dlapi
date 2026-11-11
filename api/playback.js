/* playback.js — YTM-01: kontrol playback (server-side state ringan).
   Routes (dipasang di api/index.js sebagai /api/playback):
     GET  /api/playback              -> state sekarang
     POST /api/playback/set          -> {videoId, title, positionSec} mulai/ganti lagu
     POST /api/playback/position     -> {positionSec} heartbeat posisi (dari client tiap 5 dtk)
     POST /api/playback/pause        -> tandai pause
     POST /api/playback/resume       -> tandai play
     POST /api/playback/stop         -> kosongkan state
   Filosofi: client authoritative (browser yang memutar), server hanya menyimpan
   state utk sinkron antar perangkat + auto-resume saat halaman dibuka lagi.
   Hermes, 11 Nov 2026. */
"use strict";

const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");
const STATE_FILE = path.join(__dirname, "..", "data", "playbackState.json");

/* muat state awal (auto-resume) */
let state = { videoId: null, title: null, positionSec: 0, paused: false, updatedAt: 0 };
try {
    if (fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
} catch (e) { /* state rusak -> pakai default */ }

function simpan() {
    state.updatedAt = Date.now();
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (e) { /* diam: persist adalah best-effort */ }
}

router.get("/", (req, res) => {
    res.json({ ok: true, ...state });
});

router.post("/set", (req, res) => {
    const b = req.body || {};
    if (!b.videoId) return res.status(400).json({ ok: false, error: "videoId wajib" });
    state = {
        videoId: String(b.videoId).slice(0, 32),
        title: String(b.title || "Tanpa judul").slice(0, 200),
        positionSec: Math.max(0, Number(b.positionSec) || 0),
        paused: false,
        updatedAt: Date.now(),
    };
    simpan();
    res.json({ ok: true, ...state });
});

router.post("/position", (req, res) => {
    const p = Number((req.body || {}).positionSec);
    if (!Number.isFinite(p) || p < 0) return res.status(400).json({ ok: false, error: "positionSec tidak valid" });
    state.positionSec = p;
    simpan();
    res.json({ ok: true, positionSec: p });
});

router.post("/pause", (req, res) => { state.paused = true; simpan(); res.json({ ok: true, paused: true }); });
router.post("/resume", (req, res) => { state.paused = false; simpan(); res.json({ ok: true, paused: false }); });
router.post("/stop", (req, res) => {
    state = { videoId: null, title: null, positionSec: 0, paused: false, updatedAt: Date.now() };
    simpan();
    res.json({ ok: true });
});

module.exports = router;
