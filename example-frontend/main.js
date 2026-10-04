/* ============================================================================
   Music Downloader — main.js
   Semua fungsi & endpoint API sama seperti versi asli, hanya tampilan yang baru.
   ========================================================================== */
(function () {
    "use strict";

    /* ========================================================================
       1) KONFIGURASI
       ------------------------------------------------------------------------
       API_BASE  = ""  -> API di host yang sama (default, seperti versi asli).
       Kalau front-end ini ditaruh di tempat lain (mis. GitHub Pages) sedangkan
       backend-nya di server lain, isi dengan alamat backend, contoh:
           var API_BASE = "https://music-api.namamu.workers.dev";
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

    /* ============================ 3) DATA ================================ */
    var albumResults = [];   // daftar hasil album
    var albumTracks = {};    // id album -> daftar track {url, title}
    var trackURLs = {};      // id elemen -> url unduh track
    var streamURLs = {};     // id elemen -> url stream lagu

    /* ============================ 4) HELPER ============================== */
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function norm(id) {
        return String(id).replace(/^#/, '');
    }

    // Ambil gambar paling besar dari daftar thumbnail
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
        Content.html(
            '<div class="loading"><span class="spinner"></span>' + esc(text || 'Mencari…') + '</div>'
        );
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
        console.error('[Music Downloader]', err);
        showEmpty('Gagal mengambil data', 'Coba lagi sebentar, atau periksa koneksi ke server API.');
    }

    /* ====================== 5) PROGRESS BAR UNDUHAN ====================== */
    function mountProgress(id) {
        var $el = $('#' + id);
        if (!$el.length) return false;
        $el.replaceWith(
            '<span class="dl" id="' + id + '">' +
                '<span class="dl-bar"><i></i></span>' +
                '<span class="dl-text" id="' + id + '-label">Menyiapkan…</span>' +
            '</span>'
        );
        return true;
    }

    function setProgress(id, percent, label, done) {
        $('#' + id + ' .dl-bar i').css('width', Math.max(0, Math.min(100, percent)) + '%');
        $('#' + id + '-label').text(label);
        $('#' + id).toggleClass('is-done', !!done);
    }

    /* ==================== 6) PUTAR LAGU (STREAM) ========================= */
    function streamAudio(link, id) {
        id = norm(id);
        var $btn = $('#' + id);
        if (!$btn.length) return;

        var $card = $btn.closest('.song');
        var src = api(link);

        $btn.remove(); // tombol "Putar" diganti player

        if ($card.length) {
            $card.append(
                '<div class="player-row">' +
                    '<audio controls autoplay preload="auto" src="' + esc(src) + '"></audio>' +
                '</div>'
            );
        } else {
            $('#Content').prepend('<audio controls autoplay src="' + esc(src) + '"></audio>');
        }
    }

    /* ====================== 7) UNDUH SATU LAGU =========================== */
    function downloadSong(link, id) {
        id = norm(id);
        if (!mountProgress(id)) return;

        setProgress(id, 10, 'Memproses…');

        $.ajax({
            url: api(link),
            type: 'GET',
            xhrFields: { responseType: 'blob' },
            xhr: function () {
                var xhr = new window.XMLHttpRequest();
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 1) setProgress(id, 20, 'Memproses…');
                    else if (xhr.readyState === 2) setProgress(id, 45, 'Mengunduh…');
                    else if (xhr.readyState === 3) setProgress(id, 75, 'Mengirim…');
                    else if (xhr.readyState === 4) setProgress(id, 92, 'Menyimpan…');
                };
                return xhr;
            },
            success: function (blob, status, xhr) {
                var filename = '';
                var disposition = xhr.getResponseHeader('Content-Disposition');
                if (disposition && disposition.indexOf('attachment') !== -1) {
                    var filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                    var matches = filenameRegex.exec(disposition);
                    if (matches != null && matches[1]) filename = matches[1].replace(/['"]/g, '');
                }

                if (typeof window.navigator.msSaveBlob !== 'undefined') {
                    window.navigator.msSaveBlob(blob, filename);
                } else {
                    var URL = window.URL || window.webkitURL;
                    var downloadUrl = URL.createObjectURL(blob);

                    if (filename) {
                        var a = document.createElement('a');
                        if (typeof a.download === 'undefined') {
                            window.location.href = downloadUrl;
                        } else {
                            a.href = downloadUrl;
                            a.download = filename;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        }
                    } else {
                        window.location.href = downloadUrl;
                    }
                    setTimeout(function () { URL.revokeObjectURL(downloadUrl); }, 200);
                }

                setProgress(id, 100, 'Selesai', true);
            },
            error: function () {
                setProgress(id, 0, 'Gagal mengunduh');
            }
        });
    }

    /* ==================== 8) UNDUH SATU ALBUM (ZIP) ====================== */
    function downloadAlbum(id, numOfTracks, artist, album, year, format) {
        var storage = [];
        var failed = { status: false, reason: null };
        var tick = 0;
        var progressText = 'Mengunduh track';
        var zip = new JSZip();
        var zipped;

        if (format === 'Jellyfin') {
            zipped = zip.folder(artist + '/' + album + ' (' + year + ')');
        } else {
            zipped = zip.folder(artist + ' - ' + album + ' (' + year + ')');
        }

        // Ambil daftar track dari penyimpanan data (bukan dari DOM),
        // supaya tetap benar walau ada track yang sudah diunduh satu-satu.
        var list = albumTracks[id] || [];
        for (var s = 0; s < list.length; s++) {
            storage.push({ downloadURL: list[s].url, track: list[s].title });
        }
        var total = storage.length || numOfTracks;

        var $btn = $('#' + id + '-download');
        $btn.removeAttr('href').addClass('is-busy').text(progressText);

        var animation = setInterval(function () {
            tick = ++tick % 4;
            $btn.text(progressText + new Array(tick + 1).join('.'));
        }, 500);

        var run = async function () {
            for (var i = 0; i < total; i++) {
                failed.status = false;
                var pid = 'progress-' + id + '-' + i;

                mountProgress(pid);
                setProgress(pid, 25, 'Memproses…');

                try {
                    var response = await fetch(api(storage[i].downloadURL));
                    var blob = await response.blob();
                    setProgress(pid, 55, 'Mengambil berkas…');
                    storage[i].blob = blob;
                } catch (err) {
                    console.error('Gagal pada track ke-' + (i + 1) + ':', err);
                    setProgress(pid, 0, 'Gagal mengambil track');
                    failed.status = true;
                    failed.reason = err;
                }

                if (failed.status) continue;

                setProgress(pid, 78, 'Mengarsipkan…');

                if (format === 'Jellyfin') {
                    zipped.file(('0' + (i + 1)).slice(-2) + ' - ' + storage[i].track + '.mp3', storage[i].blob);
                } else {
                    zipped.file(artist + ' - ' + storage[i].track + '.mp3', storage[i].blob);
                }

                setProgress(pid, 100, 'Selesai', true);
            }

            progressText = 'Mengarsipkan';
            clearInterval(animation);
            $btn.text(progressText + '…');

            if (failed.status) {
                console.error('Alasan gagal =>', failed.reason);
                alert(failed.reason + ' : Tutup pesan ini lalu muat ulang halaman dan coba lagi...');
                window.location.reload();
                return;
            }

            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, artist + ' - ' + album + ' (' + year + ').zip');
                console.log('Selesai — [' + artist + ' - ' + album + ' (' + year + ').zip] tanpa error.');
                $btn.removeClass('is-busy').addClass('is-done').text('Selesai!');
            });
        };

        run();
    }

    /* ======================= 9) BUKA / TUTUP TRACK ======================= */
    function toggleAlbumTracks(id) {
        var $btn = $('#' + id);
        var $panel = $('#' + id + '-methods');
        var $tracks = $('#' + id + '-tracks');
        var $card = $btn.closest('.album');
        var isOpen = $btn.attr('data-open') === '1';

        if (isOpen) {
            $panel.hide();
            $tracks.hide();
            $card.removeClass('is-open');
            $btn.attr('data-open', '0').text('Lihat Track');
        } else {
            $panel.show();
            $tracks.show();
            $card.addClass('is-open');
            $btn.attr('data-open', '1').text('Sembunyikan');
        }
    }

    /* ==================== 10) AMBIL & TAMPILKAN TRACK ==================== */
    function showAlbumTracks(playlistLink, id, artist, album, year, cover) {
        if ($('#' + id + '-tracks').length) {
            console.log("Tracklist '#" + id + "-tracks' sudah ada — pakai yang lama.");
            toggleAlbumTracks(id);
            return;
        }

        fetch(api(playlistLink))
            .then(function (resp) { return resp.json(); })
            .then(function (data) {
                toggleAlbumTracks(id);

                var panel =
                    '<div id="' + id + '-methods" class="album-toolbar">' +
                        '<button type="button" class="btn ghost sm" onclick="toggleAlbumTracks(\'' + id + '\')">Tutup</button>' +
                        '<a id="' + id + '-download" class="btn primary sm" href="javascript:void(0)">Unduh Album</a>' +
                        '<label class="format">Format' +
                            '<select id="' + id + '-download-format">' +
                                '<option value="Default">Default</option>' +
                                '<option value="Jellyfin">Jellyfin</option>' +
                            '</select>' +
                        '</label>' +
                    '</div>' +
                    '<div id="' + id + '-tracks" class="tracklist"></div>';

                // Taruh panel di dalam kartu album supaya layout 2 kolom bekerja
                var $card = $('#' + id).closest('.album');
                if ($card.length) $card.append(panel);
                else $('#' + id).after(panel);

                document.getElementById(id + '-download').onclick = function () {
                    var format = document.getElementById(id + '-download-format').value;
                    console.log('Format album dipilih: ' + format);
                    downloadAlbum(id, data.length, artist, album, year, format);
                };

                var rows = '';
                var list = [];
                for (var i = 0; i < data.length; i++) {
                    var title = data[i].playlistVideoRenderer.title.runs[0].text;
                    var videoId = data[i].playlistVideoRenderer.videoId;
                    var pid = 'progress-' + id + '-' + i;
                    var url = '/api/download/song/' + videoId +
                        '?artist=' + encodeURIComponent(artist) +
                        '&album=' + encodeURIComponent(album) +
                        '&title=' + encodeURIComponent(title) +
                        '&cover=' + cover +
                        '&year=' + year +
                        '&track=' + (i + 1);

                    trackURLs[pid] = url;
                    list.push({ url: url, title: title });

                    rows +=
                        '<div class="track">' +
                            '<span class="track-no">' + ('0' + (i + 1)).slice(-2) + '</span>' +
                            '<span class="track-title">' + esc(title) + '</span>' +
                            '<a class="btn ghost sm js-track" id="' + pid + '" href="javascript:void(0)" ' +
                               'data-url="' + esc(url) + '" data-title="' + esc(title) + '" ' +
                               'onclick="startTrackDownload(\'' + pid + '\')">Unduh</a>' +
                        '</div>';
                }
                albumTracks[id] = list;
                $('#' + id + '-tracks').html(rows);
            })
            .catch(showError);
    }

    /* ================== 11) RENDER HASIL PENCARIAN ======================= */
    function showInformation(data, handler) {
        albumResults = [];

        if (!Array.isArray(data) || data.length === 0) {
            showEmpty('Tidak ada hasil', 'Coba kata kunci lain atau ganti jenis pencarian.');
            return;
        }

        if (handler === 'Album') {
            resetContent('is-albums');

            for (var i = 0; i < data.length; i++) {
                var item = data[i];
                var hasArtist = item.artists && item.artists.length > 0;
                var artist = hasArtist ? item.artists[0].name : 'Various Artists';
                var cover = bestCover(item.thumbnails, '');
                var small = (item.thumbnails && item.thumbnails.length) ? item.thumbnails[0].url : cover;

                // Cover yang dipakai backend tetap thumbnails[3] seperti versi asli
                var apiCover = (item.thumbnails && item.thumbnails[3]) ? item.thumbnails[3].url : cover;

                albumResults.push({
                    playlistLink: '/api/get/album/playlist/' + item.playlistId,
                    artist: artist,
                    name: item.name,
                    year: item.year,
                    cover: apiCover
                });

                Content.append(
                    '<article class="album card" id="album-' + i + '">' +
                        '<div class="cover">' +
                            '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(small) + '" ' +
                                 'alt="Cover ' + esc(item.name) + '">' +
                        '</div>' +
                        '<div class="meta">' +
                            '<h3>' + esc(item.name) + '</h3>' +
                            '<p class="by">' + esc(artist) + ' · ' + esc(item.year) + '</p>' +
                            '<button type="button" class="btn ghost sm" id="showAlbumTracks-' + i + '" ' +
                                    'onclick="openAlbum(' + i + ')">Lihat Track</button>' +
                        '</div>' +
                    '</article>'
                );
            }

            setStatus('<b>' + data.length + '</b> album ditemukan');

        } else if (handler === 'Song') {
            resetContent('is-songs');

            for (var j = 0; j < data.length; j++) {
                var song = data[j];
                var hasArtist2 = song.artists && song.artists.length > 0;
                var artistName = hasArtist2 ? song.artists[0].name : 'Various Artists';
                var albumName = (song.album && song.album.name) ? song.album.name : '';

                var baseCover = (song.thumbnails && song.thumbnails.length) ? song.thumbnails[0].url : '';
                var bigCover = baseCover.replace(/w60-h60/, 'w544-h544');
                var showCover = bestCover(song.thumbnails, baseCover);

                var dlId = 'progress-bar-' + j;
                var stId = 'streamButton-' + j;

                var dlUrl = '/api/download/song/' + song.videoId +
                    '?artist=' + encodeURIComponent(artistName) +
                    '&title=' + encodeURIComponent(song.name) +
                    '&album=' + encodeURIComponent(albumName) +
                    '&cover=' + bigCover;

                var stUrl = '/api/stream/song/' + song.videoId;

                trackURLs[dlId] = dlUrl;
                streamURLs[stId] = stUrl;

                Content.append(
                    '<article class="song card">' +
                        '<div class="cover">' +
                            '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(showCover) + '" ' +
                                 'alt="Cover ' + esc(song.name) + '">' +
                        '</div>' +
                        '<div class="info">' +
                            '<h3>' + esc(song.name) + '</h3>' +
                            '<p>' + esc(artistName) + (albumName ? ' · ' + esc(albumName) : '') + '</p>' +
                        '</div>' +
                        '<div class="actions">' +
                            '<button type="button" class="btn ghost sm" id="' + dlId + '" ' +
                                    'onclick="startSongDownload(\'' + dlId + '\')">Unduh</button>' +
                            '<button type="button" class="btn primary sm" id="' + stId + '" ' +
                                    'onclick="startStream(\'' + stId + '\')">Putar</button>' +
                        '</div>' +
                    '</article>'
                );
            }

            setStatus('<b>' + data.length + '</b> lagu ditemukan');
        }
    }

    /* ================= 12) FUNGSI GLOBAL (dipakai onclick) =============== */
    window.openAlbum = function (i) {
        var a = albumResults[i];
        if (!a) return;
        showAlbumTracks(a.playlistLink, 'showAlbumTracks-' + i, a.artist, a.name, a.year, a.cover);
    };

    window.toggleAlbumTracks = toggleAlbumTracks;

    window.startTrackDownload = function (id) {
        downloadSong(trackURLs[norm(id)], norm(id));
    };

    window.startSongDownload = function (id) {
        downloadSong(trackURLs[norm(id)], norm(id));
    };

    window.startStream = function (id) {
        streamAudio(streamURLs[norm(id)], norm(id));
    };

    /* ========================= 13) PENCARIAN ============================= */
    function doSearch() {
        var query = (SearchBox.val() || '').trim();
        if (!query) {
            SearchBox.trigger('focus');
            return;
        }

        resetContent(Methods.val() === 'Album' ? 'is-albums' : 'is-songs');
        showLoading('Mencari "' + query + '"…');

        if (Methods.val() === 'Album') {
            fetch(api('/api/album/search?q=' + encodeURIComponent(query)))
                .then(function (r) { return r.json(); })
                .then(function (data) { showInformation(data, 'Album'); })
                .catch(showError);
        } else {
            fetch(api('/api/song/search?q=' + encodeURIComponent(query)))
                .then(function (r) { return r.json(); })
                .then(function (data) { showInformation(data, 'Song'); })
                .catch(showError);
        }
    }

    /* ======================= 14) EVENT BINDING =========================== */
    // Enter di kotak pencarian
    SearchBox.on('keyup', function (event) {
        if (event.keyCode === 13 || event.key === 'Enter') {
            event.preventDefault();
            doSearch();
        }
    });

    // Tombol "Cari"
    $('#SearchBtn').on('click', doSearch);

    // Segmented control Album / Lagu
    $('#MethodSwitch').on('click', '.seg', function () {
        var value = $(this).data('value');
        $('#MethodSwitch .seg').removeClass('is-active').attr('aria-selected', 'false');
        $(this).addClass('is-active').attr('aria-selected', 'true');

        Methods.val(value).trigger('change');
    });

    // Ganti metode -> kosongkan hasil (perilaku asli)
    Methods.on('change', function () {
        Content.removeClass('is-albums is-songs').empty();
        setStatus('');
        SearchBox.val('').trigger('focus');
    });

    // Ekspos beberapa fungsi agar tetap kompatibel dengan kode lama
    window.streamAudio = streamAudio;
    window.downloadSong = downloadSong;
    window.downloadAlbum = downloadAlbum;
    window.showAlbumTracks = showAlbumTracks;
    window.showInformation = showInformation;

})();
