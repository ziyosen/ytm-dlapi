/* stats.js — YTM-01 poin 4: statistik sederhana server musik. */
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

function load(f, fallback) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return fallback; }
}

router.get("/", (req,res)=>{
    const riw = load(path.join(__dirname,"..","data","riwayat.json"), []);
    const fav = load(path.join(__dirname,"..","data","favorit.json"), []);
    const hitung = {};
    for (const x of riw) hitung[x.videoId] = (hitung[x.videoId]||0)+ (x.playCount||1);
    const top = Object.entries(hitung).sort((a,b)=>b[1]-a[1]).slice(0,5)
        .map(([vid,n])=>({ videoId: vid, plays: n }));
    res.json({ ok:true, totalRiwayat: riw.length, totalFavorit: fav.length, topLagu: top });
});

module.exports = router;
