/* favorit.js — YTM-01 poin 3: favorit + riwayat (persist JSON file, dedupe, limit). */
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const DIR = path.join(__dirname, "..", "data");
const FAV = path.join(DIR, "favorit.json");
const RIW = path.join(DIR, "riwayat.json");
const LIMIT = 500;

function load(f, fallback) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return fallback; }
}
function save(f, val) {
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(val)); } catch (e) {}
}
function bersih(b) {
    return { videoId: String(b.videoId||"").slice(0,32), title: String(b.title||"Tanpa judul").slice(0,200), ts: Date.now() };
}

router.get("/favorit", (req,res)=>res.json({ok:true, items: load(FAV, [])}));
router.post("/favorit/tambah", (req,res)=>{
    const it = bersih(req.body||{});
    if (!it.videoId) return res.status(400).json({ok:false, error:"videoId wajib"});
    let arr = load(FAV, []).filter(x=>x.videoId!==it.videoId);
    arr.unshift(it);
    if (arr.length > LIMIT) arr = arr.slice(0, LIMIT);
    save(FAV, arr);
    res.json({ok:true, total: arr.length});
});
router.post("/favorit/hapus", (req,res)=>{
    const vid = String((req.body||{}).videoId||"");
    let arr = load(FAV, []).filter(x=>x.videoId!==vid);
    save(FAV, arr);
    res.json({ok:true, total: arr.length});
});

router.get("/riwayat", (req,res)=>res.json({ok:true, items: load(RIW, []).slice(0,50)}));
router.post("/riwayat/catat", (req,res)=>{
    const it = bersih(req.body||{});
    if (!it.videoId) return res.status(400).json({ok:false, error:"videoId wajib"});
    let arr = load(RIW, []).filter(x=>x.videoId!==it.videoId);
    arr.unshift(it);
    if (arr.length > LIMIT) arr = arr.slice(0, LIMIT);
    save(RIW, arr);
    res.json({ok:true});
});

module.exports = router;
