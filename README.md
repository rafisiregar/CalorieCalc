# Foto Kalori

Aplikasi penghitung kalori dari foto. Foto piring makanan atau foto daftar menu, lalu aplikasi
menebak isinya dan menghitung kalori, protein, karbohidrat, dan lemak. Catatan harian disimpan
di perangkat.

- **Tanpa API key, tanpa server, tanpa akun.** Semua proses berjalan di HP atau PC pengguna.
- **Bisa offline.** Setelah dibuka sekali (dan AI foto disiapkan sekali), aplikasi jalan tanpa internet.
- **Gratis selamanya untuk di-hosting.** Isinya hanya file statis, cukup di GitHub Pages atau sejenisnya.

## Cara kerjanya

| Fitur | Teknologi | Di mana berjalan |
|---|---|---|
| Mengenali makanan dari foto | Model CLIP (Transformers.js + ONNX Runtime WebAssembly) | Di browser pengguna |
| Membaca tulisan di foto menu | Tesseract.js dengan data bahasa Indonesia dan Inggris | Di browser pengguna |
| Data gizi | `js/foods.js`, 146 hidangan Indonesia dan umum (acuan TKPI) | Ikut di aplikasi |
| Catatan harian | IndexedDB | Di perangkat pengguna |
| Offline | Service worker (`sw.js`) | Di browser pengguna |

Model AI foto (±150 MB) diunduh **sekali** dari Hugging Face (gratis, tanpa key) saat pertama kali
dipakai, lalu disimpan oleh browser. Kalau ingin aplikasi tidak bergantung pada server lain sama
sekali, simpan model di dalam folder aplikasi (lihat "Opsional: simpan model sendiri").

## Memasang di internet (gratis, GitHub Pages)

1. Buat akun di github.com (gratis).
2. Klik **New repository**. Beri nama, misalnya `foto-kalori`, pilih **Public**, lalu **Create repository**.
3. Klik **uploading an existing file**. Tarik **isi** folder ini (bukan foldernya) ke halaman itu:
   `index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, dan folder `css`, `js`, `icons`,
   `vendor`, `models`, `scripts`. Klik **Commit changes**.
4. Buka **Settings → Pages**. Di **Source** pilih **Deploy from a branch**, branch **main**, folder **/ (root)**, lalu **Save**.
5. Tunggu 1–2 menit. Aplikasi bisa dibuka di `https://NAMA-AKUNMU.github.io/foto-kalori/`.

Alternatif lain yang juga gratis: Cloudflare Pages (pilih *Upload assets*) atau Netlify.
Semua file di paket ini di bawah 25 MB, jadi bisa diunggah lewat browser.

> Aplikasi harus dibuka lewat alamat `https://` (atau `http://localhost`). Membuka `index.html`
> langsung dari folder tidak akan menjalankan AI dan mode offline.

## Memasang di HP dan PC

- **Android (Chrome):** buka alamatnya, ketuk menu ⋮ → **Instal aplikasi** atau **Tambahkan ke layar utama**.
  Tombol **Pasang aplikasi** juga muncul di bagian "Aplikasi & data".
- **iPhone/iPad (Safari):** buka alamatnya, ketuk **Bagikan** → **Tambah ke Layar Utama**.
  Sebaiknya selalu buka dari ikon di layar utama: Safari bisa menghapus data situs biasa yang lama
  tidak dibuka, tetapi tidak untuk aplikasi yang dipasang di layar utama.
- **PC (Chrome/Edge):** buka alamatnya, klik ikon pasang di kanan bilah alamat.

Setelah terpasang, buka sekali, ketuk **Siapkan sekarang** di kotak "AI foto" (pakai Wi-Fi), dan
aplikasi siap dipakai tanpa internet.

## Cara pakai

1. Ketuk **Ambil foto** (kamera) atau **Pilih dari galeri**.
2. Aplikasi menebak jenis foto:
   - **Foto makanan:** muncul daftar tebakan isi piring. Centang yang benar, atur porsi dengan − dan +.
   - **Foto menu:** tulisan menu dibaca, setiap hidangan dicocokkan dengan database lengkap dengan harga.
     Centang yang kamu pesan.
   - Kalau tebakannya salah jenis, ketuk **Makanan** atau **Daftar menu**.
3. Ada yang kurang? Ketik di **Cari dan tambah makanan**.
4. Pilih waktu makan, lalu ketuk **Catat**.

## Opsional: simpan model sendiri

Agar aplikasi sama sekali tidak menghubungi server lain:

1. Pasang Node.js 18 atau lebih baru di PC.
2. Di folder aplikasi, jalankan `node scripts/unduh-model.mjs`. Model tersimpan di `models/`.
3. Unggah folder `models/` bersama file lainnya. Dua file model berukuran 64–88 MB, jadi unggah
   lewat `git push` atau GitHub Desktop (unggahan lewat browser dibatasi 25 MB per file).

Aplikasi otomatis memakai model di `models/` jika ada, dan baru mengambil dari Hugging Face jika tidak ada.

## Menambah atau mengubah data makanan

Semua data gizi ada di `js/foods.js`. Setiap baris berisi nama, porsi, kkal, protein, karbohidrat,
lemak, deskripsi visual dalam bahasa Inggris (`en`, untuk AI foto), dan nama lain (`a`, untuk
membaca menu). Setelah mengubahnya, naikkan `VERSION` di `sw.js` agar pengguna mendapat versi baru.
Kamus AI dibuat ulang otomatis di perangkat pengguna jika daftar makanan berubah.

## Batasan

- Kalori adalah **perkiraan**. Porsi dari foto, minyak, santan, dan gula yang tidak terlihat membuat angka bisa meleset.
- AI foto di perangkat lebih sederhana daripada AI di server: ia memilih dari 146 hidangan di database,
  dan paling akurat untuk foto satu hidangan yang jelas. Untuk piring campur, periksa centangnya.
- Membaca menu paling baik untuk menu cetak yang lurus dan terang. Tulisan tangan atau huruf hias sering gagal terbaca.
- Data tersimpan per perangkat. Pakai **Cadangkan data** dan **Pulihkan cadangan** untuk pindah HP.

## Lisensi pihak ketiga

Transformers.js (Apache-2.0), ONNX Runtime (MIT), Tesseract.js dan tesseract.js-core (Apache-2.0).
Salinan lisensi ada di `vendor/licenses/`. Model CLIP oleh OpenAI (MIT), versi ONNX oleh Xenova.
