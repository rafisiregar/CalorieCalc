# Foto Kalori

Aplikasi penghitung kalori dari foto. Foto piring makanan atau foto daftar menu, lalu aplikasi
menebak isinya dan menghitung kalori, protein, karbohidrat, dan lemak. Catatan harian disimpan
di perangkat.

- **Tanpa API key, tanpa server, tanpa akun.** Semua proses berjalan di HP atau PC pengguna.
- **Bisa offline.** Setelah dibuka sekali dan AI foto disiapkan sekali, aplikasi jalan tanpa internet.
- **Gratis selamanya untuk di-hosting.** Isinya hanya file statis, cukup di GitHub Pages atau sejenisnya.

## Cara kerjanya

| Fitur | Teknologi | Di mana berjalan |
|---|---|---|
| Mengenali makanan dari foto | MobileCLIP-S0 dari Apple (Transformers.js + ONNX Runtime WebAssembly) | Di browser pengguna |
| Membaca tulisan di foto menu | Tesseract.js dengan data bahasa Indonesia dan Inggris | Di browser pengguna |
| Data gizi | `js/foods.js`, 146 hidangan Indonesia dan umum (acuan TKPI) | Ikut di aplikasi |
| Catatan harian | IndexedDB | Di perangkat pengguna |
| Offline | Service worker (`sw.js`) | Di browser pengguna |

AI foto disiapkan sekali dalam dua langkah (total ±90 MB), supaya ringan untuk iPhone:

1. **Kamus makanan** (±45 MB): model teks dipakai sekali untuk memahami 146 nama makanan, lalu langsung dihapus.
2. **Model foto** (±46 MB): disimpan di perangkat dan dipakai seterusnya, juga tanpa internet.

Jika perangkat kehabisan memori, aplikasi otomatis memakai **versi ringan** model foto (±12 MB).
File model diunduh dari Hugging Face (gratis, tanpa akun atau key). Agar sama sekali tidak
bergantung pada server lain, simpan model di dalam folder aplikasi (lihat "Opsional: simpan model sendiri").

## Memasang di internet (gratis, GitHub Pages)

1. Buat akun di github.com (gratis).
2. Klik **New repository**. Beri nama, misalnya `foto-kalori`, pilih **Public**, lalu **Create repository**.
3. Klik **uploading an existing file**. Tarik **isi** folder ini (bukan foldernya) ke halaman itu:
   `index.html`, `sw.js`, `manifest.webmanifest`, `.nojekyll`, dan folder `css`, `js`, `icons`,
   `vendor`, `models`, `scripts`. Klik **Commit changes**.
4. Buka **Settings → Pages**. Di **Source** pilih **Deploy from a branch**, branch **main**, folder **/ (root)**, lalu **Save**.
5. Tunggu 1–2 menit. Aplikasi bisa dibuka di `https://NAMA-AKUNMU.github.io/foto-kalori/`.

Alternatif lain yang juga gratis: Cloudflare Pages (pilih *Upload assets*) atau Netlify.

> Aplikasi harus dibuka lewat alamat `https://`. Membuka `index.html` langsung dari aplikasi
> File di iPhone atau dari folder di PC tidak akan menjalankan AI dan mode offline.

### Memperbarui dari versi sebelumnya

Unggah ulang file berikut ke repository yang sama (timpa yang lama), dengan cara yang sama seperti langkah 3:
`index.html`, `sw.js`, `README.md`, folder `css`, `js`, dan `scripts`. Folder `vendor` dan `icons` tidak berubah.
Buka aplikasinya sekali saat online; versi baru langsung terpakai.

## Memasang di HP dan PC

- **iPhone/iPad (Safari):** buka alamatnya, ketuk **Bagikan** → **Tambah ke Layar Utama**, lalu selalu buka
  dari ikon itu. Safari bisa menghapus data situs yang lama tidak dibuka, tetapi tidak untuk aplikasi di layar utama.
- **Android (Chrome):** buka alamatnya, ketuk menu ⋮ → **Instal aplikasi** atau **Tambahkan ke layar utama**.
  Tombol **Pasang aplikasi** juga muncul di bagian "Aplikasi & data".
- **PC (Chrome/Edge):** buka alamatnya, klik ikon pasang di kanan bilah alamat.

Setelah terpasang, buka aplikasinya, ketuk **Siapkan sekarang** di kotak "AI foto", lalu tunggu sampai
muncul "AI foto siap".

## Jika AI foto gagal disiapkan (terutama di iPhone)

- **Biarkan layar menyala dan aplikasi tetap terbuka** sampai selesai. iPhone menghentikan unduhan saat layar
  terkunci atau aplikasi ditutup. Jika terhenti, ketuk **Coba lagi**: bagian yang sudah selesai tidak diunduh ulang.
- **Pakai Wi-Fi.** Unduhan otomatis dicoba ulang dua kali jika koneksi putus sebentar.
- **Tutup aplikasi lain** jika muncul pesan memori tidak cukup. Jika aplikasi sempat tertutup sendiri,
  buka lagi lalu ketuk **Siapkan sekarang**; aplikasi otomatis memakai versi ringan.
- **Mode Penyamaran (Private)** di Safari tidak bisa menyimpan model. Buka di tab biasa atau dari layar utama.
- Di bawah pesan error ada baris **Detail**. Catat isinya jika perlu meminta bantuan.

Selama AI foto belum siap, **membaca foto menu** dan **cari dan tambah makanan** tetap bisa dipakai.

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
3. Unggah folder `models/` bersama file lainnya. Beberapa file model lebih dari 25 MB, jadi unggah
   lewat `git push` atau GitHub Desktop (unggahan lewat browser dibatasi 25 MB per file).

Aplikasi otomatis memakai model di `models/` jika ada, dan baru mengambil dari Hugging Face jika tidak ada.

## Menambah atau mengubah data makanan

Semua data gizi ada di `js/foods.js`. Setiap baris berisi nama, porsi, kkal, protein, karbohidrat,
lemak, deskripsi visual dalam bahasa Inggris (`en`, untuk AI foto), dan nama lain (`a`, untuk
membaca menu). Kamus AI disusun ulang otomatis di perangkat pengguna jika daftar makanan berubah.

## Batasan

- Kalori adalah **perkiraan**. Porsi dari foto, minyak, santan, dan gula yang tidak terlihat membuat angka bisa meleset.
- AI foto di perangkat lebih sederhana daripada AI di server: ia memilih dari 146 hidangan di database,
  dan paling akurat untuk foto satu hidangan yang jelas. Untuk piring campur, periksa centangnya.
- Membaca menu paling baik untuk menu cetak yang lurus dan terang. Tulisan tangan atau huruf hias sering gagal terbaca.
- Data tersimpan per perangkat. Pakai **Cadangkan data** dan **Pulihkan cadangan** untuk pindah HP.

## Lisensi pihak ketiga

Transformers.js (Apache-2.0), ONNX Runtime (MIT), Tesseract.js dan tesseract.js-core (Apache-2.0).
Salinan lisensi ada di `vendor/licenses/`. Model MobileCLIP oleh Apple Inc. (lisensi Apple yang
mengizinkan penggunaan, perubahan, dan penyebaran ulang), versi ONNX oleh Xenova.
