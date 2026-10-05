# Fix YouTube Bot-Check, Stream Retry & Auto-Skip — Panduan Singkat

## Yang diperbaiki (Oktober 2026)

1. **`api/ytdlp.js`** — dukungan **cookies** & proxy:
   - `YTDLP_COOKIES` (env var) — isi dengan isi file `cookies.txt` (format Netscape) dari akun Google yang sudah login YouTube.
   - `YTDLP_COOKIES_FILE` (env var) — path ke file cookies.txt.
   - `YTDLP_PROXY` (env var) — opsional, proxy untuk yt-dlp (mis. `socks5://...`).
   - Cookies otomatis dipakai di semua pemanggilan yt-dlp.

2. **`api/stream.js`** — fallback **player client**: kalau satu client diblokir
   (`web` → `tv` → `android_vr` → `mweb`), otomatis coba client berikutnya.
   Pesan error sekarang menjelaskan solusinya.

3. **`api/get.js`** — buka link satu lagu juga mencoba beberapa player client,
   dan pesan error memberi tahu kalau server perlu `YTDLP_COOKIES`.

4. **`public/main.js`** — **lagu tidak lagi "pindah sendiri"**:
   - Sebelumnya: error audio → langsung lompat ke lagu berikutnya (terasa seperti lagu berpindah sendiri).
   - Sekarang: error → **retry lagu yang sama maks 2×** (dengan cache-bypass `?r=timestamp`),
     hanya setelah 2× gagal baru lanjut ke lagu berikutnya.

## Kenapa muncul "Sign in to confirm you're not a bot"?

YouTube memblokir IP **datacenter** (Vercel, AWS, dll.) pada level playability —
sebelum cookies/pembuktian apa pun. Player client apa pun (`web`, `tv`,
`android_vr`, dll.) **tidak** mengatasi ini tanpa cookies. Ini bukan bug kode,
kebijakan YouTube.

## Yang HARUS dilakukan pemilik deployment (Vercel)

1. Di komputer/browser kamu (bukan server), login ke YouTube.
2. Export cookies `youtube.com` ke file **cookies.txt** (format Netscape) —
   gunakan ekstensi browser seperti "Get cookies.txt LOCALLY" (Chrome/Firefox).
3. Di Vercel → Project → **Settings → Environment Variables**, tambahkan:
   - Name: `YTDLP_COOKIES`
   - Value: (seluruh isi cookies.txt — satu baris, ganti newline dengan `\n`)
   - Environments: Production (+ Preview kalau perlu)
4. **Redeploy**.
5. ⚠️ Cookies sesi bisa kedaluwarsa (biasanya berminggu-minggu/bulan). Kalau
   suatu saat error muncul lagi, export cookies baru & update env var.

### Alternatif (tanpa cookies)

- Deploy di platform dengan IP "rumah"/bersih (kecil kemungkinan di-Vercel).
- Atau set `YTDLP_PROXY` ke proxy ber-IP residensial.
