/* ============================================================================
   Music Player — main.js
   Hanya untuk MEMUTAR lagu (streaming). Fitur unduh sudah dihapus.
   Autoplay: kalau satu lagu habis, otomatis lanjut ke lagu berikutnya.
   ========================================================================== */
(function () {
    "use strict";

    /* ========================================================================
       1) KONFIGURASI
       API_BASE = ""  -> API di host yang sama (default).
       Kalau front-end dipisah dari backend, isi dengan alamat backend, mis:
           var API_BASE = "https://ytm-dlapi-xxx.vercel.app";
       ===================================================================== */
    var API_BASE = "";

    function api(path) {
        return API_BASE + path;
    }

    /* ============================ 2) ELEMEN ============================== */
    var SearchBox = $('input#SearchBox');
    var Methods = $('select#Methods');
    var Content = $('#Content');
    var Status = $('#Status');

    var Audio = document.getElementById('Audio');
    var PlayerEl = document.getElementById('Player');
    var PlayBtn = document.getElementById('PlayBtn');
    var SeekEl = document.getElementById('Seek');
    var VolEl = document.getElementById('Vol');

    /* ============================= 3) STATE ============================== */
    var albumResults = [];  // { playlistId, artist, name, year, cover }
    var albumTracks = {};   // ai -> [{ videoId, title }]
    var songResults = [];   // { videoId, title, artist, cover }

    var queue = [];         // daftar lagu yang sedang diputar
    var qIndex = -1;        // posisi sekarang di dalam queue
    var qSource = null;     // 'songs' atau nomor album (ai)
    var dragging = false;   // sedang menggeser seek bar?
    var errStreak = 0;      // jumlah error berturut-turut

    /* ---- State machine pemutar (patch review Muse) ----
       playToken: naik tiap playAt(); semua timer/async dari lagu lama
       WAJIB cek token ini sebelum bertindak -> tidak ada lagi timer
       15 detik yang memaksa putar lagu yang sudah ditinggal user.
       waitRetryFor: indeks yang sudah memakai jatah tunggu-15s;
       sentinel -1 (bukan falsy!) supaya lagu indeks 0 tidak loop. */
    var playToken = 0;
    var waitRetryFor = -1;
    var preparedMap = {};   // videoId -> ts; dedupe prepare/prefetch
    var batchToken = 0;     // naik tiap batch baru -> batch lama batal
    var stallTimer = null;  // watchdog buffer kering

    /* ============================== 4) IKON ============================== */
    var ICON_PLAY =
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72L19 12z"/></svg>';
    var ICON_PAUSE =
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

    /* ============================ 5) HELPER ============================== */
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function fmtTime(sec) {
        if (!isFinite(sec) || sec < 0) return '0:00';
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    /* Nomor urut: padStart TIDAK memotong, jadi lagu ke-100+ tetap benar
       (cara lama ('0'+n).slice(-2) bikin 100 tampil 00). */
    function trackNo(n) {
        return String(n).padStart(2, '0');
    }

    /* Dedupe prepare: true = silakan fetch, false = sudah/sedang disiapkan */
    function claimPrepare(videoId) {
        if (!videoId) return false;
        if (preparedMap[videoId]) return false;
        preparedMap[videoId] = Date.now();
        return true;
    }

    function releasePrepare(videoId) {
        if (videoId) delete preparedMap[videoId];
    }

    function bestCover(thumbnails, fallback) {
        if (Array.isArray(thumbnails) && thumbnails.length) {
            return thumbnails[thumbnails.length - 1].url || thumbnails[0].url || fallback;
        }
        return fallback || '';
    }

    /*
      Thumbnail lagu yang sebenarnya: i.ytimg.com/vi/<id>/mqdefault.jpg
      URL dari ytmusic-api kadang berupa avatar artis (yt3.googleusercontent)
      atau gagal dimuat di sebagian jaringan HP — pakai ytimg langsung kalau
      ada videoId, itu thumbnail YouTube resmi selalu ada.
    */
    function thumbLagu(item) {
        if (item && item.videoId) {
            return 'https://i.ytimg.com/vi/' + encodeURIComponent(item.videoId) + '/mqdefault.jpg';
        }
        return item && item.cover ? item.cover : '';
    }

    /*
      Fallback gambar: kalau URL cover gagal dimuat (hotlink diblok,
      jaringan HP, dsb) — coba i.ytimg.com via videoId, lalu placeholder.
    */
    function pasangFallbackImg(img) {
        img.onerror = function () {
            img.onerror = null;
            var vid = img.getAttribute('data-vid');
            if (vid && img.src.indexOf('i.ytimg.com') === -1) {
                img.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(vid) + '/mqdefault.jpg';
            } else {
                img.onerror = null;
                img.src = 'data:image/svg+xml,' + encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
                    '<rect width="240" height="240" fill="#1a1c26"/>' +
                    '<text x="120" y="140" font-size="70" text-anchor="middle" fill="#6366f1">♪</text></svg>');
            }
        };
    }

    function setStatus(html) {
        if (!html) {
            Status.attr('hidden', true).html('');
            return;
        }
        Status.removeAttr('hidden').html(html);
    }

    function resetContent(mode) {
        Content.removeClass('is-albums is-songs').empty();
        if (mode) Content.addClass(mode);
        setStatus('');
    }

    function showLoading(text) {
        Content.html('<div class="loading"><span class="spinner"></span>' + esc(text || 'Mencari…') + '</div>');
    }

    function showEmpty(title, sub) {
        Content.html(
            '<div class="empty">' +
                '<span class="empty-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
                    'stroke-linecap="round" stroke-linejoin="round">' +
                        '<path d="M9 18V5l12-2v13"></path>' +
                        '<circle cx="6" cy="18" r="3"></circle>' +
                        '<circle cx="18" cy="16" r="3"></circle>' +
                    '</svg>' +
                '</span>' +
                '<p>' + esc(title || 'Tidak ada hasil') + '</p>' +
                '<span>' + (sub || '') + '</span>' +
            '</div>'
        );
    }

    function showError(err) {
        console.error('[Music Player]', err);
        showEmpty('Gagal mengambil data', 'Coba lagi sebentar, atau periksa koneksi ke server.');
    }

    /* ============================= 6) PLAYER ============================= */
    function setQueue(list, startIndex, source) {
        queue = list.slice();
        qSource = source;
        /* Queue baru: batalkan batch lama & reset dedupe prepare */
        batchToken++;
        preparedMap = {};
        playAt(startIndex);
        /* playAt() sudah memanggil panaskanBatch() berprioritas
           (jendela ±5 di sekitar lagu aktif dulu). */
    }

    function playAt(i) {
        if (i < 0 || i >= queue.length) return;

        playToken++;            // batalkan semua timer lagu sebelumnya
        waitRetryFor = -1;      // lagu baru berhak jatah tunggu-15s lagi
        clearStallWatchdog();
        nextPending = false;
        qIndex = i;
        errStreak = 0;
        retryCount = 0;

        var track = queue[i];
        // Server me-redirect ke googlevideo (audio langsung dari YouTube).
        // <audio> mengikuti redirect otomatis. Kalau gagal (403 dsb) ->
        // handler 'error' mencoba lagi dengan ?proxy=1 (lewat server).
        Audio.src = api('/api/stream/song/' + track.videoId);
        Audio.load();

        var p = Audio.play();
        if (p && p.catch) {
            p.catch(function (err) {
                console.warn('[Music Player] play ditolak browser:', err && err.message);
            });
        }

        updateBar(track);
        highlight();
        setMediaSession(track);
        renderQueue();
        panaskanLaguBerikutnya(i);
        panaskanSatu(i + 2); // siapkan 2 lagu di depan lebih awal
        /* Kalau user lompat jauh, prioritaskan ulang jendela ±5 di
           sekitar posisi baru (batch lama otomatis batal via token). */
        panaskanBatch();
    }

    /* ==================== ANTREAN (queue ala YT Music) ==================== */
    function renderQueue() {
        var wadah = document.getElementById('NpQueue');
        if (!wadah) return;

        if (!queue.length) {
            wadah.innerHTML = '<p class="q-kosong">Antrean kosong</p>';
            return;
        }

        var html = '';
        for (var i = 0; i < queue.length; i++) {
            var t = queue[i];
            var aktif = (i === qIndex);
            html +=
                '<div class="q-item' + (aktif ? ' is-now' : '') + '" data-q="' + i + '" role="button" tabindex="0">' +
                    '<span class="q-no">' + (aktif ? '▶' : trackNo(i + 1)) + '</span>' +
                    '<img class="q-thumb" referrerpolicy="no-referrer" loading="lazy" ' +
                         'data-vid="' + esc(t.videoId) + '" ' +
                         'src="https://i.ytimg.com/vi/' + esc(t.videoId) + '/mqdefault.jpg" alt="">' +
                    '<span class="q-meta">' +
                        '<strong>' + esc(t.title || '—') + '</strong>' +
                        '<em>' + esc(t.artist || '') + '</em>' +
                    '</span>' +
                '</div>';
        }
        wadah.innerHTML = html;

        // Gulir ke lagu aktif
        var aktifEl = wadah.querySelector('.q-item.is-now');
        if (aktifEl) aktifEl.scrollIntoView({ block: 'nearest' });
    }

    /*
      PREFETCH: minta server menyiapkan URL audio lagu berikutnya DI BELAKANG
      LAYAR sementara lagu sekarang masih diputar. Resolve yt-dlp di Vercel
      bisa 10-30 detik untuk lagu yang belum pernah diputar — dengan cara ini,
      saat user tekan next / lagu habis, lagu berikutnya langsung nyala
      karena URL-nya sudah tersimpan di cache server.
    */
    function panaskanLaguBerikutnya(i) {
        panaskanSatu(i + 1);
    }

    /* Panaskan antrean dengan PRIORITAS (patch review Muse):
       - Urutan: lagu setelah posisi aktif dulu, jendela ±5 di sekitar
         qIndex diprioritaskan, baru sisanya berurutan sampai akhir,
         lalu yang sebelum qIndex. Playlist 50+ lagu tidak lagi
         menunggu prefetch dari lagu 0 kalau user mulai di tengah.
       - Dedupe via claimPrepare(): lagu yang sama tidak pernah
         di-prepare dua kali (batch + panaskanSatu bisa balapan dulu).
       - Batal otomatis: batchToken berubah (queue baru / playAt
         memanggil ulang) -> rantai berhenti, tidak ada fetch yatim.
       - Tetap LEMBUT ke YouTube: 1 per 1, jeda 2,5 detik (anti
         bot-check seperti fix server commit 033d466). */
    function panaskanBatch() {
        if (!queue.length) return;
        var myBatch = ++batchToken;

        var daftar = [];
        var seen = {};
        function dorong(idx) {
            if (idx < 0 || idx >= queue.length || seen[idx]) return;
            if (idx === qIndex) return;
            seen[idx] = true;
            daftar.push(idx);
        }
        var k;
        /* prioritas: 5 lagu berikutnya */
        for (k = 1; k <= 5; k++) dorong(qIndex + k);
        /* lalu 5 sebelumnya (buat prev / klik mundur) */
        for (k = 1; k <= 5; k++) dorong(qIndex - k);
        /* sisanya berurutan dari aktif ke akhir, lalu dari awal */
        for (k = qIndex + 6; k < queue.length; k++) dorong(k);
        for (k = 0; k < qIndex - 5; k++) dorong(k);

        var pos = 0;
        function kerjakan() {
            if (myBatch !== batchToken) return;   // batch lama: berhenti
            if (pos >= daftar.length) return;
            var idx = daftar[pos++];
            var t = queue[idx];
            if (!t || !claimPrepare(t.videoId)) { kerjakan(); return; }
            var vid = t.videoId;
            setTimeout(function () {
                if (myBatch !== batchToken) return;
                fetch(api('/api/stream/prepare/' + vid))
                    .then(function (r) {
                        if (!r.ok) {
                            releasePrepare(vid);
                            return fetch(api('/api/stream/prepare/' + vid + '?r=' + Date.now()))
                                .then(function (r2) { if (!r2.ok) releasePrepare(vid); })
                                .catch(function () { releasePrepare(vid); });
                        }
                    })
                    .catch(function () { releasePrepare(vid); })
                    .then(function () { kerjakan(); });
            }, pos === 1 ? 0 : 2500);
        }
        kerjakan();
    }

    /* Panaskan 1 lagu (dipakai saat lagu aktif berganti) — dedupe juga */
    function panaskanSatu(idx) {
        var t = queue[idx];
        if (!t || !t.videoId) return;
        if (!claimPrepare(t.videoId)) return;
        var vid = t.videoId;
        fetch(api('/api/stream/prepare/' + vid))
            .then(function (r) { if (!r.ok) releasePrepare(vid); })
            .catch(function () { releasePrepare(vid); });
    }

    function nextTrack() {
        if (qIndex + 1 < queue.length) {
            playAt(qIndex + 1);
        } else {
            setStatus('Sudah lagu terakhir di daftar ini.');
        }
    }

    function prevTrack() {
        if (qIndex > 0) playAt(qIndex - 1);
    }

    function togglePlay() {
        if (!Audio.src) return;
        if (Audio.paused) {
            var p = Audio.play();
            if (p && p.catch) p.catch(function () {});
        } else {
            Audio.pause();
        }
    }

    function updateBar(track) {
        PlayerEl.hidden = false;
        var cov = document.getElementById('PlayerCover');
        cov.setAttribute('data-vid', track.videoId || '');
        pasangFallbackImg(cov);
        cov.src = thumbLagu(track);
        document.getElementById('PlayerTitle').textContent = track.title || '—';
        document.getElementById('PlayerArtist').textContent = track.artist || '—';
        // Sinkron ke tampilan Now Playing (fullscreen) — TIDAK dibuka otomatis,
        // cukup klik cover/judul di player bar kalau mau tampilan besar.
        var ncv = document.getElementById('NpCover');
        ncv.setAttribute('data-vid', track.videoId || '');
        pasangFallbackImg(ncv);
        ncv.src = thumbLagu(track);
        document.getElementById('NpTitle').textContent = track.title || '—';
        document.getElementById('NpArtist').textContent = track.artist || '—';
        document.title = (track.title || 'Music Player') + ' — Music Player';
    }

    /* ---------- Now Playing (gaya YT Music) ---------- */
    var NpEl = document.getElementById('NowPlaying');
    var NpSeekEl = document.getElementById('NpSeek');
    var npDragging = false;

    function bukaNowPlaying(buka) {
        if (buka) {
            NpEl.hidden = false;
            requestAnimationFrame(function () { NpEl.classList.add('is-open'); });
        } else {
            NpEl.classList.remove('is-open');
            setTimeout(function () { NpEl.hidden = true; }, 260);
        }
    }

    document.getElementById('NpClose').addEventListener('click', function () { bukaNowPlaying(false); });
    document.getElementById('NpPlay').addEventListener('click', togglePlay);
    document.getElementById('NpPrev').addEventListener('click', prevTrack);
    document.getElementById('NpNext').addEventListener('click', nextTrack);

    // Klik cover/ judul di player bar kecil -> buka Now Playing juga
    PlayerEl.addEventListener('click', function (e) {
        if (e.target.closest('.pbtn') || e.target.closest('.player-seek') || e.target.closest('.player-vol')) return;
        bukaNowPlaying(true);
    });

    NpSeekEl.addEventListener('input', function () {
        npDragging = true;
        var d = Audio.duration || 0;
        if (d) document.getElementById('NpCur').textContent = fmtTime((NpSeekEl.value / 1000) * d);
    });
    NpSeekEl.addEventListener('change', function () {
        var d = Audio.duration || 0;
        if (d) Audio.currentTime = (NpSeekEl.value / 1000) * d;
        npDragging = false;
    });

    // Klik item antrean -> putar lagu itu
    document.getElementById('NpQueue').addEventListener('click', function (e) {
        var item = e.target.closest('.q-item');
        if (!item) return;
        var i = parseInt(item.getAttribute('data-q'), 10);
        if (isNaN(i)) return;
        if (qSource === 'link' || qSource === 'songs') {
            playAt(i);
        } else {
            playAt(i); // antrean sudah flat: nomor = posisi queue
        }
    });

    function highlight() {
        $('.is-playing').removeClass('is-playing');
        if (qIndex < 0) return;

        if (qSource === 'songs') {
            $('.song[data-q="' + qIndex + '"]').addClass('is-playing');
        } else if (qSource !== null) {
            $('.track[data-ai="' + qSource + '"][data-q="' + qIndex + '"]').addClass('is-playing');
        }
    }

    function updatePositionState() {
        if (!('mediaSession' in navigator)) return;
        if (typeof navigator.mediaSession.setPositionState !== 'function') return;
        try {
            var d = Audio.duration;
            if (!isFinite(d) || d <= 0) return;
            navigator.mediaSession.setPositionState({
                duration: d,
                playbackRate: Audio.playbackRate || 1,
                position: Math.min(Math.max(Audio.currentTime || 0, 0), d)
            });
        } catch (e) { /* abaikan */ }
    }

    function setMediaSession(track) {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.metadata = new window.MediaMetadata({
                title: track.title || '',
                artist: track.artist || '',
                album: track.album || '',
                artwork: track.cover ? [{ src: track.cover, sizes: '512x512', type: 'image/jpeg' }] : []
            });
            navigator.mediaSession.setActionHandler('play', function () { Audio.play(); });
            navigator.mediaSession.setActionHandler('pause', function () { Audio.pause(); });
            navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
            navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
        } catch (e) { /* sebagian browser tidak mendukung */ }
        /* Seek dari notif/lockscreen (patch): handler dipasang terpisah
           karena sebagian browser melempar untuk handler yang tak
           didukung — satu gagal tidak boleh menggagalkan yang lain. */
        try {
            navigator.mediaSession.setActionHandler('seekbackward', function (details) {
                var off = (details && details.seekOffset) || 10;
                Audio.currentTime = Math.max(0, (Audio.currentTime || 0) - off);
                updatePositionState();
            });
        } catch (e) {}
        try {
            navigator.mediaSession.setActionHandler('seekforward', function (details) {
                var off = (details && details.seekOffset) || 10;
                var d = Audio.duration || 0;
                Audio.currentTime = d ? Math.min(d, (Audio.currentTime || 0) + off) : (Audio.currentTime || 0) + off;
                updatePositionState();
            });
        } catch (e) {}
        try {
            navigator.mediaSession.setActionHandler('seekto', function (details) {
                if (!details || typeof details.seekTime !== 'number') return;
                if (details.fastSeek && ('fastSeek' in Audio)) {
                    Audio.fastSeek(details.seekTime);
                } else {
                    Audio.currentTime = details.seekTime;
                }
                updatePositionState();
            });
        } catch (e) {}
    }

    /* ============================ 7) RENDER ============================== */
    function renderAlbums(data) {
        resetContent('is-albums');
        albumResults = [];
        albumTracks = {};

        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var artist = item.artist || 'Various Artists';
            var cover = item.cover || '';

            // Album: pakai cover dari API, tapi fallback ke thumbnail video pertama
            // kalau URL-nya bermasalah (ditangani onerror di bawah).
            albumResults.push({
                albumId: item.albumId || '',
                playlistId: item.playlistId || '',
                artist: artist,
                name: item.name,
                year: item.year,
                cover: cover
            });

            Content.append(
                '<article class="album card" id="album-' + i + '" data-ai="' + i + '">' +
                    '<div class="cover">' +
                        '<img referrerpolicy="no-referrer" loading="lazy" data-vid="' + esc(albumResults[albumResults.length-1].playlistId || '') + '" src="' + esc(cover) + '" ' +
                             'alt="Cover ' + esc(item.name) + '">' +
                    '</div>' +
                    '<div class="meta">' +
                        '<h3>' + esc(item.name) + '</h3>' +
                        '<p class="by">' + esc(artist) + ' · ' + esc(item.year) + '</p>' +
                        '<button type="button" class="btn ghost sm show-tracks" data-ai="' + i + '">Lihat Track</button>' +
                    '</div>' +
                '</article>'
            );
        }

        setStatus('<b>' + data.length + '</b> album ditemukan');
    }

    function renderSongs(data) {
        resetContent('is-songs');
        songResults = [];

        for (var j = 0; j < data.length; j++) {
            var song = data[j];
            var artistName = song.artist || 'Various Artists';
            var albumName = song.album || '';
            var cover = thumbLagu(song);   // thumbnail YouTube asli per videoId

            songResults.push({
                videoId: song.videoId,
                title: song.title,
                artist: artistName,
                album: albumName,
                cover: cover
            });

            Content.append(
                '<article class="song card" data-q="' + j + '">' +
                    '<div class="cover">' +
                        '<img referrerpolicy="no-referrer" loading="lazy" data-vid="' + esc(song.videoId) + '" src="' + esc(cover) + '" ' +
                             'alt="Thumbnail ' + esc(song.title) + '">' +
                    '</div>' +
                    '<div class="info">' +
                        '<h3>' + esc(song.title) + '</h3>' +
                        '<p>' + esc(artistName) + (albumName ? ' · ' + esc(albumName) : '') + '</p>' +
                    '</div>' +
                    '<div class="actions">' +
                        '<button type="button" class="btn primary sm play-btn" data-q="' + j + '">Putar</button>' +
                    '</div>' +
                '</article>'
            );
        }

        setStatus('<b>' + data.length + '</b> lagu ditemukan — klik untuk memutar');
    }

    function openAlbum(ai) {
        var album = albumResults[ai];
        if (!album) return;

        var $card = $('.album[data-ai="' + ai + '"]');
        var $panel = $('#album-panel-' + ai);

        // Sudah pernah dibuka -> cukup tampil/sembunyi
        if ($panel.length) {
            $panel.toggle();
            $card.toggleClass('is-open', $panel.is(':visible'));
            return;
        }

        setStatus('Memuat daftar track…');

        fetch(api('/api/get/album/songs/' + (album.albumId || album.playlistId)))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var tracks = (data && data.tracks) ? data.tracks : [];

                if (!tracks.length) {
                    setStatus('Album ini tidak punya track yang bisa diputar.');
                    return;
                }

                var list = [];
                var rows = '';

                for (var i = 0; i < tracks.length; i++) {
                    var title = tracks[i].title;
                    var videoId = tracks[i].videoId;
                    var qi = list.length;

                    list.push({ videoId: videoId, title: title });

                    rows +=
                        '<div class="track" data-ai="' + ai + '" data-q="' + qi + '" role="button" tabindex="0">' +
                            '<span class="track-no">' + trackNo(qi + 1) + '</span>' +
                            '<span class="track-title">' + esc(title) + '</span>' +
                            '<span class="track-play" aria-hidden="true">' +
                                '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72L19 12z"/></svg>' +
                            '</span>' +
                        '</div>';
                }

                albumTracks[ai] = list;

                $card.append(
                    '<div class="album-panel" id="album-panel-' + ai + '">' +
                        '<div class="album-toolbar">' +
                            '<button type="button" class="btn primary sm play-all" data-ai="' + ai + '">Putar Semua</button>' +
                            '<button type="button" class="btn ghost sm close-tracks" data-ai="' + ai + '">Tutup</button>' +
                        '</div>' +
                        '<div class="tracklist">' + rows + '</div>' +
                    '</div>'
                );

                $card.addClass('is-open');
                setStatus('<b>' + list.length + '</b> track — klik salah satu untuk memutar');
            })
            .catch(showError);
    }

    function playFromAlbum(ai, qi) {
        var album = albumResults[ai];
        var list = albumTracks[ai] || [];
        if (!album || !list.length) return;

        var q = list.map(function (t) {
            return { videoId: t.videoId, title: t.title, artist: album.artist, album: album.name, cover: album.cover };
        });

        setQueue(q, qi, ai);
    }

    function playFromSongs(qi) {
        if (!songResults.length) return;
        setQueue(songResults, qi, 'songs');
    }

    /* ======================= 8) BUKA LINK YOUTUBE ======================== */
    function looksLikeLink(q) {
        if (/youtu\.?be/i.test(q)) return true;
        if (/^https?:\/\//i.test(q)) return true;
        if (/^(PL|RD|OLAK5uy_|UU|FL|LL|WL|MPREb_)[A-Za-z0-9_-]{8,}$/.test(q)) return true;
        return false;
    }

    function renderLinkTracks(d, q) {
        resetContent('');

        var cover = d.cover
            ? '<div class="cover"><img referrerpolicy="no-referrer" src="' + esc(d.cover) + '" alt=""></div>'
            : '<div class="cover" style="display:flex;align-items:center;justify-content:center;' +
              'background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-size:30px">♪</div>';

        var rows = '';
        for (var i = 0; i < q.length; i++) {
            rows +=
                '<div class="track" data-ai="link" data-q="' + i + '" role="button" tabindex="0">' +
                    '<span class="track-no">' + trackNo(i + 1) + '</span>' +
                    '<span class="track-title">' + esc(q[i].title) + '</span>' +
                    '<span class="track-play" aria-hidden="true">' +
                        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72L19 12z"/></svg>' +
                    '</span>' +
                '</div>';
        }

        Content.append(
            '<article class="album card is-open">' +
                cover +
                '<div class="meta">' +
                    '<h3>' + esc(d.name || 'Playlist dari link') + '</h3>' +
                    '<p class="by">' + q.length + ' lagu · dari link</p>' +
                '</div>' +
                '<div class="album-panel">' +
                    '<div class="tracklist">' + rows + '</div>' +
                '</div>' +
            '</article>'
        );
    }

    function bukaLink(query) {
        resetContent('');
        showLoading('Membuka link…');
        setStatus('Membaca link…');

        fetch(api('/api/get/url?url=' + encodeURIComponent(query)))
            .then(function (r) {
                return r.json().then(function (d) { return { ok: r.ok, d: d }; });
            })
            .then(function (hasil) {
                var d = hasil.d;
                if (!hasil.ok || !d || d.error) {
                    throw new Error((d && d.error) || 'Link tidak bisa dibuka');
                }

                /* --- satu lagu --- */
                if (d.type === 'song') {
                    var satu = [{
                        videoId: d.track.videoId,
                        title: d.track.title,
                        artist: d.track.artist,
                        cover: d.track.cover
                    }];
                    resetContent('');
                    showEmpty('Memutar dari link', esc(d.track.title));
                    setQueue(satu, 0, 'link');
                    setStatus('<b>1</b> lagu diputar dari link');
                    return;
                }

                /* --- playlist / album --- */
                var tracks = d.tracks || [];
                if (!tracks.length) throw new Error('Playlist ini kosong');

                var q = tracks.map(function (t) {
                    return {
                        videoId: t.videoId,
                        title: t.title,
                        artist: t.artist || d.artist || '',
                        cover: t.cover || d.cover || ''
                    };
                });

                var start = parseInt(d.startIndex, 10) || 0;
                if (start < 0 || start >= q.length) start = 0;

                renderLinkTracks(d, q);
                setQueue(q, start, 'link');
                setStatus('<b>' + q.length + '</b> lagu dari ' +
                    (d.name ? '"' + esc(d.name) + '"' : 'link') + ' — sedang diputar');
            })
            .catch(function (err) {
                console.error('[Music Player]', err);
                showEmpty('Link tidak bisa dibuka', esc(err.message || 'Coba link lain.'));
                setStatus('<b>Gagal</b> membaca link.');
            });
    }

    /* ============================ 9) PENCARIAN =========================== */
    function doSearch() {
        var query = (SearchBox.val() || '').trim();
        if (!query) {
            SearchBox.trigger('focus');
            return;
        }

        /* Kalau yang ditempel sebuah link -> langsung putar */
        if (looksLikeLink(query)) {
            bukaLink(query);
            return;
        }

        var isAlbum = Methods.val() === 'Album';
        resetContent(isAlbum ? 'is-albums' : 'is-songs');
        showLoading('Mencari "' + query + '"…');

        var url = isAlbum
            ? '/api/album/search?q=' + encodeURIComponent(query)
            : '/api/song/search?q=' + encodeURIComponent(query);

        fetch(api(url))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!Array.isArray(data) || data.length === 0) {
                    showEmpty('Tidak ada hasil', 'Coba kata kunci lain atau ganti jenis pencarian.');
                    return;
                }
                if (isAlbum) renderAlbums(data);
                else renderSongs(data);
            })
            .catch(showError);
    }

    /* ============================ 10) EVENT ============================== */
    // Pencarian
    SearchBox.on('keyup', function (e) {
        if (e.keyCode === 13 || e.key === 'Enter') {
            e.preventDefault();
            doSearch();
        }
    });
    $('#SearchBtn').on('click', doSearch);

    // Segmented control Album / Lagu
    $('#MethodSwitch').on('click', '.seg', function () {
        var value = $(this).data('value');
        $('#MethodSwitch .seg').removeClass('is-active').attr('aria-selected', 'false');
        $(this).addClass('is-active').attr('aria-selected', 'true');
        Methods.val(value).trigger('change');
    });

    Methods.on('change', function () {
        Content.removeClass('is-albums is-songs').empty();
        setStatus('');
        SearchBox.val('').trigger('focus');
    });

    // Klik di area hasil (pakai event delegation)
    // Fallback thumbnail: semua img hasil render pakai handler error global
    Content.on('error', 'img', function () {
        pasangFallbackImg(this);
        this.onerror = null; // cegah loop
        var vid = this.getAttribute('data-vid');
        if (vid && this.src.indexOf('i.ytimg.com') === -1) {
            this.src = 'https://i.ytimg.com/vi/' + encodeURIComponent(vid) + '/mqdefault.jpg';
        } else {
            this.src = 'data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
                '<rect width="240" height="240" fill="#1a1c26"/>' +
                '<text x="120" y="140" font-size="70" text-anchor="middle" fill="#6366f1">♪</text></svg>');
        }
    });

    Content.on('click', '.show-tracks', function () {
        openAlbum(parseInt($(this).attr('data-ai'), 10));
    });

    Content.on('click', '.close-tracks', function () {
        var ai = parseInt($(this).attr('data-ai'), 10);
        $('#album-panel-' + ai).hide();
        $('.album[data-ai="' + ai + '"]').removeClass('is-open');
    });

    Content.on('click', '.play-all', function () {
        playFromAlbum(parseInt($(this).attr('data-ai'), 10), 0);
    });

    Content.on('click', '.track', function () {
        var aiRaw = $(this).attr('data-ai');
        var qi = parseInt($(this).attr('data-q'), 10);

        // Klik lagu yang sedang diputar -> jeda / lanjut
        if (qSource === aiRaw && qIndex === qi && Audio.src) {
            togglePlay();
            return;
        }

        // Daftar dari link: queue-nya sudah terisi
        if (aiRaw === 'link') {
            playAt(qi);
            return;
        }

        playFromAlbum(parseInt(aiRaw, 10), qi);
    });

    Content.on('click', '.song', function () {
        var qi = parseInt($(this).attr('data-q'), 10);
        if (qSource === 'songs' && qIndex === qi && Audio.src) {
            togglePlay();
            return;
        }
        playFromSongs(qi);
    });

    // Kontrol player
    PlayBtn.addEventListener('click', togglePlay);
    document.getElementById('PrevBtn').addEventListener('click', prevTrack);
    document.getElementById('NextBtn').addEventListener('click', nextTrack);

    // Seek
    SeekEl.addEventListener('input', function () {
        dragging = true;
        var d = Audio.duration || 0;
        if (d) document.getElementById('CurTime').textContent = fmtTime((SeekEl.value / 1000) * d);
    });
    SeekEl.addEventListener('change', function () {
        var d = Audio.duration || 0;
        if (d) Audio.currentTime = (SeekEl.value / 1000) * d;
        dragging = false;
    });

    // Volume
    VolEl.addEventListener('input', function () {
        Audio.volume = parseFloat(VolEl.value);
    });

    // Kejadian audio
    Audio.addEventListener('play', function () {
        PlayBtn.innerHTML = ICON_PAUSE;
        document.getElementById('NpPlay').innerHTML = ICON_PAUSE;
    });
    Audio.addEventListener('pause', function () {
        PlayBtn.innerHTML = ICON_PLAY;
        document.getElementById('NpPlay').innerHTML = ICON_PLAY;
    });

    Audio.addEventListener('loadedmetadata', function () {
        document.getElementById('DurTime').textContent = fmtTime(Audio.duration);
        document.getElementById('NpDur').textContent = fmtTime(Audio.duration);
        updatePositionState();
    });

    Audio.addEventListener('timeupdate', function () {
        var d = Audio.duration || 0;
        if (!dragging && d) {
            SeekEl.value = (Audio.currentTime / d) * 1000;
            document.getElementById('CurTime').textContent = fmtTime(Audio.currentTime);
        }
        if (!npDragging && d) {
            NpSeekEl.value = (Audio.currentTime / d) * 1000;
            document.getElementById('NpCur').textContent = fmtTime(Audio.currentTime);
        }
        updatePositionState();
    });

    Audio.addEventListener('ratechange', updatePositionState);
    Audio.addEventListener('seeked', updatePositionState);

    // ==== AUTOPLAY: lagu habis -> lanjut otomatis ke lagu berikutnya ====
    Audio.addEventListener('ended', function () {
        nextTrack();
    });

    /*
      State machine error (patch review Muse) — menggantikan handler
      lama yang punya 4 lubang race:
        1. window.__lastWaitRetry falsy di indeks 0 -> lagu pertama
           bisa loop tunggu-15s selamanya. Sekarang sentinel -1.
        2. Timer 15s menangkap qIndex global -> kalau user pindah lagu
           saat menunggu, timer tetap memaksa putar. Sekarang setiap
           timer menangkap playToken + indeks; token berubah = batal.
        3. nextPending dicek terlalu akhir -> error beruntun bisa
           menjadwalkan retry & skip bersamaan. Sekarang guard di
           PALING ATAS handler.
        4. __lastWaitRetry tidak pernah direset di playAt -> lagu baru
           kehilangan jatah tunggu. Sekarang direset tiap playAt.
      Urutan tetap: retry 2x -> tunggu 15s + coba 1x -> skip.
    */
    var retryCount = 0; // retry untuk lagu yang sedang diputar
    var nextPending = false; // guard anti dobel-skip (race handler error)

    function clearStallWatchdog() {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }
    /* Dipakai juga oleh playAt di atas (function hoisting) */
    function armStallWatchdog(myToken, myIndex) {
        clearStallWatchdog();
        stallTimer = setTimeout(function () {
            stallTimer = null;
            if (myToken !== playToken || myIndex !== qIndex) return;
            if (Audio.paused || Audio.ended) return;
            if (Audio.readyState >= 3) return; // sudah punya data: bukan stall
            /* Buffer kering >25 detik: muat ulang lagu yang sama via
               proxy TANPA skip — posisi putar dipertahankan. */
            console.warn('[Music Player] watchdog: stall 25s, muat ulang tanpa skip');
            var tr = queue[myIndex];
            if (!tr) return;
            var pos = Audio.currentTime || 0;
            Audio.src = api('/api/stream/song/' + tr.videoId + '?proxy=1&r=' + Date.now());
            Audio.load();
            var p = Audio.play();
            if (p && p.catch) p.catch(function () {});
            if (pos > 3) {
                try { Audio.currentTime = pos; } catch (e) {}
            }
        }, 25000);
    }

    Audio.addEventListener('error', function () {
        if (!Audio.src) return;
        if (nextPending) return;               /* guard paling atas */
        var myToken = playToken;
        var myIndex = qIndex;
        var track = queue[myIndex];
        if (!track) return;
        errStreak++;
        console.warn('[Music Player] gagal memutar lagu ke-' + (myIndex + 1), 'percobaan:', retryCount + 1);

        if (retryCount < 2) {
            retryCount++;
            // Percobaan 1: masih redirect biasa (URL mungkin kedaluwarsa).
            // Percobaan 2: paksa lewat server (?proxy=1) — googlevideo
            // kadang menolak UA/headers browser tertentu.
            setStatus('Koneksi lagu terputus — mencoba lagi… (' + retryCount + '/2)');
            var pos = Audio.currentTime || 0;
            var sumber = api('/api/stream/song/' + track.videoId);
            if (retryCount >= 2) sumber += '?proxy=1&r=' + Date.now();
            Audio.src = sumber;
            Audio.load();
            var p = Audio.play();
            if (p && p.catch) p.catch(function () {});
            if (pos > 3) { try { Audio.currentTime = pos; } catch (e) {} }
            return;
        }

        /* Sebelum menyerah & lompat lagu: YouTube kadang bot-check
           sementara (pulih dalam 10-20 detik). Tunggu & coba 1x dulu.
           Sentinel -1: indeks 0 pun hanya dapat SATU jatah tunggu. */
        if (waitRetryFor !== myIndex) {
            waitRetryFor = myIndex;
            retryCount = 0;
            setStatus('YouTube sedang membatasi akses — menunggu 15 detik lalu mencoba lagi…');
            setTimeout(function () {
                if (myToken !== playToken || qIndex !== myIndex) return; // user sudah pindah
                var tr = queue[myIndex];
                if (!tr) return;
                Audio.src = api('/api/stream/song/' + tr.videoId + '?proxy=1&r=' + Date.now());
                Audio.load();
                var pp = Audio.play();
                if (pp && pp.catch) pp.catch(function () {});
            }, 15000);
            return;
        }

        if (errStreak <= 3 && myIndex + 1 < queue.length) {
            nextPending = true;
            setStatus('Lagu ini gagal diputar — lanjut ke lagu berikutnya…');
            panaskanSatu(myIndex + 1); // panaskan dulu lagu berikutnya biar tidak skip lagi
            panaskanSatu(myIndex + 2);
            setTimeout(function () {
                if (myToken !== playToken) return; // user sudah pindah manual
                nextPending = false;
                nextTrack();
            }, 1200);
        } else {
            setStatus('<b>Gagal</b> memutar lagu ini. Coba lagu lain ya.');
        }
    });

    // Sukses mulai memutar -> reset retry & error streak + matikan watchdog
    Audio.addEventListener('playing', function () {
        retryCount = 0;
        errStreak = 0;
        clearStallWatchdog();
        setStatus('');
    });

    // Buffer kering (mis. segmen habis & instance Vercel cold) — JANGAN pause/skip,
    // cukup beri tahu user bahwa sedang buffering, audio lanjut sendiri saat siap.
    // Watchdog 25s (token-guarded) menangani stall yang tidak pulih sendiri.
    Audio.addEventListener('waiting', function () {
        if (Audio.duration) {
            setStatus('Koneksi lambat — buffering…');
            armStallWatchdog(playToken, qIndex);
        }
    });

    // Ekspos beberapa fungsi (untuk debugging di console)
    window.musicPlayer = {
        playAt: playAt,
        next: nextTrack,
        prev: prevTrack,
        toggle: togglePlay,
        queue: function () { return queue; }
    };
})();
