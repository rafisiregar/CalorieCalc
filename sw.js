// Service worker Foto Kalori: membuat aplikasi tetap terbuka tanpa internet.
// Naikkan VERSION setiap kali isi folder vendor/ atau models/ diganti.
const VERSION = 'v1';
const SHELL = 'fk-shell-' + VERSION;
const RUNTIME = 'fk-files-' + VERSION;

const SHELL_FILES = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/foods.js', './js/db.js', './js/match.js', './js/vision.js', './js/ocr.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
// File besar yang disimpan di latar belakang agar pembaca menu dan AI foto bisa jalan offline.
const HEAVY_FILES = [
  './vendor/transformers/transformers.min.js',
  './vendor/ort/ort-wasm-simd-threaded.jsep.mjs',
  './vendor/ort/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/tesseract/tesseract.esm.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/lang/ind.traineddata.gz',
  './vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

async function warmHeavy() {
  const c = await caches.open(RUNTIME);
  for (const f of HEAVY_FILES) {
    const url = new URL(f, self.registration.scope).href;
    if (await c.match(url)) continue;
    try {
      const res = await fetch(url);
      if (res.ok) await c.put(url, res);
    } catch (e) { /* coba lagi lain kali */ }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    for (const k of await caches.keys()) {
      if (k.startsWith('fk-') && !keep.has(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
  warmHeavy();
});

self.addEventListener('message', (event) => {
  if (event.data === 'warm') warmHeavy();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // unduhan model dari luar dikelola oleh Transformers.js

  const path = url.pathname;
  const heavy = /\/(vendor|models)\//.test(path);

  if (heavy) {
    // File besar tidak berubah: ambil dari simpanan dulu.
    event.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // Halaman dan kode aplikasi: tampilkan versi tersimpan, perbarui di latar belakang.
  event.respondWith((async () => {
    const c = await caches.open(SHELL);
    const key = req.mode === 'navigate' ? new URL('./index.html', self.registration.scope).href : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(req).then((res) => {
      if (res.ok && res.status === 200 && res.type === 'basic') c.put(key, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (hit) { event.waitUntil(net); return hit; }
    const res = await net;
    return res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
