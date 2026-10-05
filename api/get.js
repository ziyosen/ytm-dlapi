/* ============================================================================
   api/get.js  —  Ambil data lagu / album / playlist, dan buka LINK
   ----------------------------------------------------------------------------
   Endpoint:
     GET /api/get/url?url=<link YouTube / YouTube Music>
         -> { type:'song', track:{...} }
         -> { type:'collection', name, tracks:[...], startIndex }
     GET /api/get/album/songs/:albumId      -> { name, artist, cover, tracks }
     GET /api/get/album/playlist/:playlistId-> { name, artist, cover, tracks }
     GET /api/get/album/:albumId            -> data mentah album (ytmusic)
     GET /api/get/song/:videoId             -> data mentah lagu (ytmusic)
   ========================================================================== */
const M = require('ytmusic-api');
const YTMusic = M.default || M;
const ytmusic = new YTMusic();
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { infoLagu } = require('./ytdlp.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function artistName(x) {
    if (!x) return '';
    if (Array.isArray(x)) return (x[0] && x[0].name) || '';
    if (typeof x === 'object') return x.name || '';
    return String(x);
}

/* ==========================================================================
   Baca halaman playlist YouTube (mendukung format BARU & LAMA)

   YouTube sekarang memakai `lockupViewModel` (2024+), sedangkan yang lama
   `playlistVideoRenderer`. Keduanya dibaca supaya tetap jalan.
   ========================================================================== */
function extractInitialData(html) {
    const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = '];
    let start = -1;
    for (let i = 0; i < markers.length; i++) {
        const at = html.indexOf(markers[i]);
        if (at !== -1) { start = at + markers[i].length; break; }
    }
    if (start === -1) return null;

    // Cari objek JSON dengan mencocokkan kurung kurawal (lebih aman dari regex)
    let depth = 0, inStr = false, esc = false, begin = -1;
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') { if (depth === 0) begin = i; depth++; }
        else if (c === '}') {
            depth--;
            if (depth === 0 && begin !== -1) {
                try { return JSON.parse(html.slice(begin, i + 1)); } catch (e) { return null; }
            }
        }
    }
    return null;
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    visit(node);
    for (const k in node) {
        const v = node[k];
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) walk(v[i], visit); }
        else if (v && typeof v === 'object') walk(v, visit);
    }
}

function parsePlaylistPage(data) {
    const tracks = [];
    let title = '';
    let titleLama = '';

    walk(data, function (node) {
        // --- format baru ---
        const lv = node.lockupViewModel;
        if (lv && lv.contentId) {
            const md = lv.metadata && lv.metadata.lockupMetadataViewModel;
            const t = (md && md.title && md.title.content) || '';
            if (t) tracks.push({ videoId: lv.contentId, title: t });
        }
        // --- format lama ---
        const pv = node.playlistVideoRenderer;
        if (pv && pv.videoId) {
            const r = pv.title && pv.title.runs && pv.title.runs[0];
            const t = (r && r.text) || (pv.title && pv.title.simpleText) || '';
            if (t) tracks.push({ videoId: pv.videoId, title: t });
        }
        // --- nama playlist ---
        const ps = node.playlistSidebarPrimaryInfoRenderer;
        if (ps && !title && ps.title) {
            title = ps.title.simpleText || (ps.title.runs && ps.title.runs[0] && ps.title.runs[0].text) || '';
        }
        const ph = node.playlistHeaderRenderer;
        if (ph && !titleLama && ph.title) {
            titleLama = ph.title.simpleText || (ph.title.runs && ph.title.runs[0] && ph.title.runs[0].text) || '';
        }
    });

    if (!title) title = titleLama;
    // Halaman album memberi judul "Album - NamaAlbum"
    title = String(title).replace(/^(Album|Playlist)\s*[-–—]\s*/i, '').trim();

    // buang duplikat
    const seen = {};
    const uniq = [];
    for (let i = 0; i < tracks.length; i++) {
        if (!seen[tracks[i].videoId]) { seen[tracks[i].videoId] = 1; uniq.push(tracks[i]); }
    }
    return { name: title, tracks: uniq };
}

async function scrapePlaylist(id) {
    const url = 'https://m.youtube.com/playlist?list=' + encodeURIComponent(id);
    const resp = await axios.get(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 25000,
        maxRedirects: 5
    });
    const data = extractInitialData(resp.data);
    if (!data) throw new Error('Halaman playlist tidak bisa dibaca');
    const p = parsePlaylistPage(data);
    if (!p.tracks.length) throw new Error('Playlist kosong atau tidak bisa dibaca');
    return p;
}

/* ============================== Album (ytmusic) ========================== */
async function albumInfo(albumId) {
    await init();
    const a = await ytmusic.getAlbum(albumId);
    return {
        name: a.name || '',
        artist: artistName(a.artist || a.artists),
        cover: thumb(a.thumbnails),
        tracks: (a.songs || []).map(function (s) {
            return {
                videoId: s.videoId,
                title: s.name,
                artist: artistName(s.artist || s.artists),
                cover: thumb(s.thumbnails)
            };
        })
    };
}

/* ============================== Satu video =============================== */
async function videoInfo(videoId) {
    // Coba beberapa player client — kalau satu diblokir ("Sign in to
    // confirm you're not a bot"), client lain kadang masih lolos.
    const CLIENTS = ['', 'tv', 'android_vr', 'mweb'];
    let terakhir = null;
    for (const c of CLIENTS) {
        try {
            const d = await infoLagu(videoId, false, c);
            return {
                videoId: d.videoId,
                title: d.title,
                artist: d.artist,
                cover: d.cover,
                duration: d.duration
            };
        } catch (e) {
            terakhir = e;
        }
    }
    throw terakhir || new Error('Video tidak bisa dibuka');
}

/* ============================ Parsing link =============================== */
function parseLink(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;

    // ID langsung (tanpa link)
    if (/^MPREb_[A-Za-z0-9_-]+$/.test(s)) return { albumId: s };
    if (/^(PL|RD|OLAK5uy_|UU|FL|LL|WL)[A-Za-z0-9_-]{8,}$/.test(s)) return { listId: s };
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { videoId: s };

    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }
    catch (e) { return null; }

    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    const youtube = /(^|\.)youtube\.com$/.test(host) ||
                    /(^|\.)youtu\.be$/.test(host) ||
                    /(^|\.)youtube-nocookie\.com$/.test(host);
    if (!youtube) return null;

    const listId = u.searchParams.get('list');
    const v = u.searchParams.get('v');
    if (v) return { videoId: v, listId: listId || null };

    const path = u.pathname || '';

    // youtu.be/<id>
    let m = /^\/([A-Za-z0-9_-]{11})(?:$|[/?])/.exec(path);
    if (/(^|\.)youtu\.be$/.test(host) && m) return { videoId: m[1], listId: listId || null };

    // /shorts/<id> , /embed/<id> , /live/<id> , /v/<id>
    m = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(path);
    if (m) return { videoId: m[1], listId: listId || null };

    // /browse/MPREb_...  (album YouTube Music)
    m = /\/browse\/(MPREb_[A-Za-z0-9_-]+)/.exec(path);
    if (m) return { albumId: m[1] };

    if (listId) return { listId: listId };

    return null;
}

/* ================================ ROUTES ================================= */

/* ---- Buka link (lagu / playlist / album) ---- */
router.get('/url', async function (req, res) {
    const raw = req.query.url || req.query.u || req.query.q || '';
    const p = parseLink(raw);

    if (!p || (!p.videoId && !p.listId && !p.albumId)) {
        return res.status(400).json({ error: 'Link tidak dikenali. Tempel link YouTube / YouTube Music.' });
    }

    try {
        // Link playlist (termasuk link lagu yang punya &list=) -> pakai seluruh playlist
        if (p.listId) {
            const pl = await scrapePlaylist(p.listId);
            let startIndex = 0;
            if (p.videoId) {
                for (let i = 0; i < pl.tracks.length; i++) {
                    if (pl.tracks[i].videoId === p.videoId) { startIndex = i; break; }
                }
            }
            return res.status(200).json({
                type: 'collection',
                name: pl.name,
                artist: '',
                cover: '',
                tracks: pl.tracks,
                startIndex: startIndex
            });
        }

        // Link album YouTube Music
        if (p.albumId) {
            const a = await albumInfo(p.albumId);
            return res.status(200).json({
                type: 'collection',
                name: a.name,
                artist: a.artist,
                cover: a.cover,
                tracks: a.tracks,
                startIndex: 0
            });
        }

        // Link satu lagu
        const t = await videoInfo(p.videoId);
        return res.status(200).json({ type: 'song', track: t });
    } catch (err) {
        const pesan = String((err && err.message) || err);
        let tambahan = '';
        if (/Sign in to confirm|not a bot/i.test(pesan)) {
            tambahan = ' — Server diblokir YouTube (IP datacenter). Pemilik server perlu mengisi env var YTDLP_COOKIES dengan cookies.txt akun Google.';
        }
        res.status(404).json({ error: 'Gagal membuka link: ' + pesan + tambahan });
    }
});

/* ---- Daftar lagu sebuah album ---- */
router.get('/album/songs/:albumId', async function (req, res) {
    const id = req.params.albumId;
    try {
        if (/^MPREb_/.test(id)) {
            return res.status(200).json(await albumInfo(id));
        }
        const p = await scrapePlaylist(id);
        return res.status(200).json({ name: p.name, artist: '', cover: '', tracks: p.tracks });
    } catch (err) {
        res.status(404).json({ error: 'Gagal memuat track: ' + (err.message || err) });
    }
});

/* ---- Daftar lagu sebuah playlist ---- */
router.get('/album/playlist/:playlistId', async function (req, res) {
    try {
        const p = await scrapePlaylist(req.params.playlistId);
        res.status(200).json({ name: p.name, artist: '', cover: '', tracks: p.tracks });
    } catch (err) {
        res.status(404).json({ error: 'Gagal memuat playlist: ' + (err.message || err) });
    }
});

/* ---- Data mentah album (ytmusic) ---- */
router.get('/album/:albumId', function (req, res) {
    init()
        .then(function () { return ytmusic.getAlbum(req.params.albumId); })
        .then(function (info) { res.status(200).json(info); })
        .catch(function () { res.status(404).json({ error: 'Album tidak ditemukan: ' + req.params.albumId }); });
});

/* ---- Data mentah satu lagu (ytmusic) ---- */
router.get('/song/:videoId', function (req, res) {
    init()
        .then(function () { return ytmusic.getSong(req.params.videoId); })
        .then(function (info) { res.status(200).json(info); })
        .catch(function () { res.status(404).json({ error: 'Lagu tidak ditemukan: ' + req.params.videoId }); });
});

module.exports = router;
