/* ============================================================================
   api/search.js  —  Pencarian album & lagu
   ----------------------------------------------------------------------------
   Memakai ytmusic-api v5 (v4 sudah rusak: header X-YouTube-Client-Name hilang).
   Hasilnya dinormalkan supaya front-end cukup pakai: name, artist, cover.
   ========================================================================== */
const M = require('ytmusic-api');
const YTMusic = M.default || M;   // v5 mengekspor class langsung
const ytmusic = new YTMusic();
const express = require('express');
const router = express.Router();

/* initialize() cukup sekali, lalu dipakai bersama */
let siap = null;
function init() {
    if (!siap) siap = ytmusic.initialize();
    return siap;
}

function thumb(list, fallback) {
    if (Array.isArray(list) && list.length) {
        return list[list.length - 1].url || list[0].url || fallback || '';
    }
    return fallback || '';
}

/* v4: artists = [{name}]  |  v5: artist = {name} */
function artistName(x) {
    if (!x) return '';
    if (Array.isArray(x)) return (x[0] && x[0].name) || '';
    if (typeof x === 'object') return x.name || '';
    return String(x);
}

/* ------------------------------- Album ---------------------------------- */
router.get('/album/search', function (req, res) {
    const q = req.query.q || '';
    init()
        .then(function () { return ytmusic.searchAlbums(q); })
        .then(function (list) {
            res.status(200).json((list || []).map(function (a) {
                return {
                    albumId: a.albumId || '',
                    playlistId: a.playlistId || '',
                    name: a.name || '',
                    artist: artistName(a.artist || a.artists),
                    year: a.year || '',
                    cover: thumb(a.thumbnails)
                };
            }));
        })
        .catch(function (err) {
            res.status(502).json({ error: 'Pencarian album gagal: ' + (err.message || err) });
        });
});

/* -------------------------------- Lagu ---------------------------------- */
router.get('/song/search', function (req, res) {
    const q = req.query.q || '';
    init()
        .then(function () { return ytmusic.searchSongs(q); })
        .then(function (list) {
            res.status(200).json((list || []).map(function (s) {
                return {
                    videoId: s.videoId || '',
                    title: s.name || '',
                    artist: artistName(s.artist || s.artists),
                    album: (s.album && s.album.name) || '',
                    cover: thumb(s.thumbnails)
                };
            }));
        })
        .catch(function (err) {
            res.status(502).json({ error: 'Pencarian lagu gagal: ' + (err.message || err) });
        });
});

module.exports = router;
