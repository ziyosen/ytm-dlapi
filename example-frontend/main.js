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

    function bestCover(thumbnails, fallback) {
        if (Array.isArray(thumbnails) && thumbnails.length) {
            return thumbnails[thumbnails.length - 1].url || thumbnails[0].url || fallback;
        }
        return fallback || '';
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
        playAt(startIndex);
    }

    function playAt(i) {
        if (i < 0 || i >= queue.length) return;

        qIndex = i;
        errStreak = 0;

        var track = queue[i];
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
        document.getElementById('PlayerCover').src = track.cover || '';
        document.getElementById('PlayerTitle').textContent = track.title || '—';
        document.getElementById('PlayerArtist').textContent = track.artist || '—';
        document.title = (track.title || 'Music Player') + ' — Music Player';
    }

    function highlight() {
        $('.is-playing').removeClass('is-playing');
        if (qIndex < 0) return;

        if (qSource === 'songs') {
            $('.song[data-q="' + qIndex + '"]').addClass('is-playing');
        } else if (qSource !== null) {
            $('.track[data-ai="' + qSource + '"][data-q="' + qIndex + '"]').addClass('is-playing');
        }
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
    }

    /* ============================ 7) RENDER ============================== */
    function renderAlbums(data) {
        resetContent('is-albums');
        albumResults = [];
        albumTracks = {};

        for (var i = 0; i < data.length; i++) {
            var item = data[i];
            var artist = (item.artists && item.artists.length) ? item.artists[0].name : 'Various Artists';
            var small = (item.thumbnails && item.thumbnails.length) ? item.thumbnails[0].url : '';
            var big = bestCover(item.thumbnails, small);

            albumResults.push({
                playlistId: item.playlistId,
                artist: artist,
                name: item.name,
                year: item.year,
                cover: big
            });

            Content.append(
                '<article class="album card" id="album-' + i + '" data-ai="' + i + '">' +
                    '<div class="cover">' +
                        '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(small) + '" ' +
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
            var artistName = (song.artists && song.artists.length) ? song.artists[0].name : 'Various Artists';
            var albumName = (song.album && song.album.name) ? song.album.name : '';
            var cover = bestCover(song.thumbnails, '');

            songResults.push({
                videoId: song.videoId,
                title: song.name,
                artist: artistName,
                album: albumName,
                cover: cover
            });

            Content.append(
                '<article class="song card" data-q="' + j + '">' +
                    '<div class="cover">' +
                        '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(cover) + '" ' +
                             'alt="Cover ' + esc(song.name) + '">' +
                    '</div>' +
                    '<div class="info">' +
                        '<h3>' + esc(song.name) + '</h3>' +
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

        fetch(api('/api/get/album/playlist/' + album.playlistId))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!Array.isArray(data) || !data.length) {
                    setStatus('Album ini tidak punya track yang bisa diputar.');
                    return;
                }

                var list = [];
                var rows = '';

                for (var i = 0; i < data.length; i++) {
                    var node = data[i].playlistVideoRenderer;
                    if (!node) continue;

                    var title = node.title.runs[0].text;
                    var videoId = node.videoId;
                    var qi = list.length;

                    list.push({ videoId: videoId, title: title });

                    rows +=
                        '<div class="track" data-ai="' + ai + '" data-q="' + qi + '" role="button" tabindex="0">' +
                            '<span class="track-no">' + ('0' + (qi + 1)).slice(-2) + '</span>' +
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

    /* ============================ 8) PENCARIAN =========================== */
    function doSearch() {
        var query = (SearchBox.val() || '').trim();
        if (!query) {
            SearchBox.trigger('focus');
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

    /* ============================ 9) EVENT =============================== */
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
        var ai = parseInt($(this).attr('data-ai'), 10);
        var qi = parseInt($(this).attr('data-q'), 10);
        // Klik lagu yang sedang diputar -> jeda / lanjut
        if (qSource === ai && qIndex === qi && Audio.src) {
            togglePlay();
            return;
        }
        playFromAlbum(ai, qi);
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
    Audio.addEventListener('play', function () { PlayBtn.innerHTML = ICON_PAUSE; });
    Audio.addEventListener('pause', function () { PlayBtn.innerHTML = ICON_PLAY; });

    Audio.addEventListener('loadedmetadata', function () {
        document.getElementById('DurTime').textContent = fmtTime(Audio.duration);
    });

    Audio.addEventListener('timeupdate', function () {
        var d = Audio.duration || 0;
        if (!dragging && d) {
            SeekEl.value = (Audio.currentTime / d) * 1000;
            document.getElementById('CurTime').textContent = fmtTime(Audio.currentTime);
        }
    });

    // ==== AUTOPLAY: lagu habis -> lanjut otomatis ke lagu berikutnya ====
    Audio.addEventListener('ended', function () {
        nextTrack();
    });

    // Kalau satu lagu gagal diputar, coba lompat ke berikutnya (maks 3 kali)
    Audio.addEventListener('error', function () {
        if (!Audio.src) return;
        errStreak++;
        console.warn('[Music Player] gagal memutar lagu ke-' + (qIndex + 1));

        if (errStreak <= 3 && qIndex + 1 < queue.length) {
            setStatus('Lagu ini gagal diputar — lanjut ke lagu berikutnya…');
            setTimeout(nextTrack, 1200);
        } else {
            setStatus('<b>Gagal</b> memutar lagu ini. Coba lagu lain ya.');
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
