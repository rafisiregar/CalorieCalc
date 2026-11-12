// AI foto yang berjalan di perangkat: MobileCLIP-S0 (Apple), lewat Transformers.js + ONNX Runtime WebAssembly.
//
// Dimuat dalam dua langkah supaya hemat memori (penting untuk iPhone):
//   1. Model teks (±45 MB) dipakai sekali untuk menyusun "kamus" makanan, disimpan di perangkat,
//      lalu dibuang dari memori dan dari simpanan browser.
//   2. Model foto (±46 MB) diunduh dan disimpan untuk dipakai seterusnya, juga tanpa internet.
// Jika perangkat kehabisan memori, aplikasi otomatis beralih ke model foto versi ringan (±12 MB).
//
// Jika folder models/ berisi file model (lihat scripts/unduh-model.mjs), semua dimuat dari situs
// ini sendiri. Jika tidak, diunduh sekali dari Hugging Face (gratis, tanpa akun atau API key).
import { FOODS, NON_FOOD } from './foods.js';
import * as store from './db.js';

export const MODEL_ID = 'Xenova/mobileclip_s0';
const TEXT_DTYPE = 'q8';
const SIZE = 256; // ukuran masukan MobileCLIP-S0

const LABELS = [
  ...FOODS.map((f) => ({ id: f.id, food: true, prompt: 'a photo of ' + f.en + (f.k === 'minum' ? ', a drink.' : ', a type of food.') })),
  ...NON_FOOD.map((x) => ({ id: x.id, food: false, kind: x.kind, prompt: 'a photo of ' + x.en + '.' })),
];
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const EMB_KEY = 'emb:' + MODEL_ID + ':' + hash(LABELS.map((l) => l.id + l.prompt).join('|'));
const READY_KEY = 'vision-ready:' + MODEL_ID;
const LITE_KEY = 'vision-lite:' + MODEL_ID;
// Penanda di localStorage (ditulis seketika) untuk mendeteksi halaman yang tertutup paksa
// karena memori habis saat model foto disiapkan atau dijalankan.
const LS_PENDING = 'fk-vision-pending';
const LS_RUNNING = 'fk-vision-running';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

let T = null;
let processor = null;
let vision = null;
let visionDtype = null;
let textEmb = null; // Float32Array [jumlah label × dim], tiap baris sudah dinormalisasi
let dim = 512;
let loading = null;

export const isReady = () => !!(vision && processor && textEmb);
export const isLite = () => visionDtype === 'q8';
export async function wasReadyBefore() {
  try { return !!(await store.get(READY_KEY)); } catch (e) { return false; }
}

const errText = (e) => String((e && (e.message || e.name)) || e || '');
export const isMemoryError = (e) => /out of memory|memory access|RangeError|bad_alloc|Aborted|allocation|OOM/i.test(errText(e));
export const isNetworkError = (e) => /failed to fetch|load failed|network|fetch|timed? ?out|ERR_|404|50\d|Could not locate file|Unable to (get|load)/i.test(errText(e));

function progressTracker(onProgress, step, onFileDone) {
  const files = new Map();
  return (p) => {
    if (!p) return;
    if (p.status === 'done' && onFileDone) onFileDone(p.file || '');
    if (!onProgress) return;
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      onProgress({ phase: 'download', step, loaded, total });
    }
  };
}

async function loadLib() {
  if (T) return T;
  T = await import('../vendor/transformers/transformers.min.js');
  const { env } = T;
  env.allowLocalModels = true;
  env.localModelPath = new URL('../models/', import.meta.url).href;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  return T;
}

async function cacheDelete(test) {
  try {
    if (!self.caches) return;
    const c = await caches.open('transformers-cache');
    for (const req of await c.keys()) if (test(req.url)) await c.delete(req);
  } catch (e) {}
}

// Membersihkan sisa model lama (versi pertama aplikasi memakai model yang lebih besar).
async function cleanupOld() {
  await cacheDelete((u) => /clip-vit-base-patch32/.test(u));
  try {
    for (const prefix of ['emb:', 'vision-ready:', 'vision-lite:']) {
      for (const [k] of await store.entries(prefix)) if (!k.includes(MODEL_ID)) await store.del(k);
    }
  } catch (e) {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mencoba ulang langkah yang gagal karena jaringan. File yang sudah selesai diunduh tidak diunduh lagi.
async function withRetry(fn, onRetry) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= 3 || !isNetworkError(e) || (self.navigator && navigator.onLine === false)) throw e;
      onRetry && onRetry(attempt);
      await sleep(2500 * attempt);
    }
  }
}

// Memuat AI foto. onProgress menerima:
//   { phase: 'download', step: 1|2, loaded, total }   mengunduh (langkah 1 kamus, langkah 2 model foto)
//   { phase: 'prepare', done, count }                  menyusun kamus makanan
//   { phase: 'init', step }                            menyiapkan model di memori
//   { phase: 'retry', attempt }                        mencoba ulang setelah unduhan terputus
export function load(onProgress) {
  if (isReady()) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    await loadLib();
    await cleanupOld();
    const retry = (attempt) => onProgress && onProgress({ phase: 'retry', attempt });

    // Langkah 1: kamus makanan.
    if (!textEmb) {
      const saved = await store.get(EMB_KEY).catch(() => null);
      if (saved && saved.data && saved.dim && saved.data.length === LABELS.length * saved.dim) {
        textEmb = saved.data; dim = saved.dim;
      } else {
        await withRetry(() => buildTextEmbeddings(onProgress), retry);
      }
    }

    // Langkah 2: model foto.
    if (!vision) {
      let lite = !!(await store.get(LITE_KEY).catch(() => null));
      const crashed = ls.get(LS_PENDING) === 'fp32:loaded' || ls.get(LS_RUNNING) === 'fp32';
      if (!lite && crashed) { lite = true; await store.set(LITE_KEY, true).catch(() => {}); }
      ls.del(LS_RUNNING);
      let dtype = lite ? 'q8' : 'fp32';
      try {
        await withRetry(() => loadVision(dtype, onProgress), retry);
      } catch (e) {
        if (dtype !== 'fp32' || !isMemoryError(e)) throw e;
        dtype = 'q8';
        await store.set(LITE_KEY, true).catch(() => {});
        await withRetry(() => loadVision(dtype, onProgress), retry);
      }
    }
    await store.set(READY_KEY, Date.now()).catch(() => {});
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

async function loadVision(dtype, onProgress) {
  ls.set(LS_PENDING, dtype);
  const onFileDone = (file) => {
    if (/onnx/.test(file)) { ls.set(LS_PENDING, dtype + ':loaded'); onProgress && onProgress({ phase: 'init', step: 2 }); }
  };
  const cb = progressTracker(onProgress, 2, onFileDone);
  processor = processor || await T.AutoImageProcessor.from_pretrained(MODEL_ID, { progress_callback: cb });
  vision = await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype, device: 'wasm', progress_callback: cb });
  visionDtype = dtype;
  ls.del(LS_PENDING);
  // Hapus versi lain model foto dari simpanan agar tidak memakan ruang.
  const keep = dtype === 'q8' ? /vision_model_quantized\.onnx/ : /vision_model\.onnx/;
  await cacheDelete((u) => u.includes(MODEL_ID) && /vision_model/.test(u) && !keep.test(u));
}

// Menyusun "kamus" makanan sekali saja, lalu menyimpannya di perangkat.
async function buildTextEmbeddings(onProgress) {
  const cb = progressTracker(onProgress, 1, (file) => { if (/onnx/.test(file)) onProgress && onProgress({ phase: 'init', step: 1 }); });
  const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: cb });
  const textModel = await T.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: TEXT_DTYPE, device: 'wasm', progress_callback: cb });
  try {
    const texts = LABELS.map((l) => l.prompt);
    let out = null;
    const CHUNK = 8;
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK);
      // MobileCLIP butuh panjang token tetap (77), jadi padding harus 'max_length'.
      const inputs = tokenizer(chunk, { padding: 'max_length', truncation: true, max_length: 77 });
      const { text_embeds } = await textModel(inputs);
      const d = text_embeds.dims[1];
      if (!out) { dim = d; out = new Float32Array(texts.length * d); }
      const data = text_embeds.data;
      for (let r = 0; r < chunk.length; r++) {
        let n = 0;
        for (let k = 0; k < d; k++) n += data[r * d + k] ** 2;
        n = Math.sqrt(n) || 1;
        for (let k = 0; k < d; k++) out[(i + r) * d + k] = data[r * d + k] / n;
      }
      try { text_embeds.dispose && text_embeds.dispose(); } catch (e) {}
      onProgress && onProgress({ phase: 'prepare', done: Math.min(i + CHUNK, texts.length), count: texts.length });
      await sleep(0);
    }
    textEmb = out;
    await store.set(EMB_KEY, { dim, data: out }).catch(() => {});
  } finally {
    try { if (textModel.dispose) await textModel.dispose(); } catch (e) {}
  }
  // Model teks dan tokenizer hanya perlu sekali. Hapus dari simpanan browser.
  await cacheDelete((u) => u.includes(MODEL_ID) && /text_model|tokenizer/.test(u));
}

function square(img, sx, sy, sw, sh) {
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const s = Math.min(SIZE / sw, SIZE / sh);
  const w = sw * s, h = sh * s;
  ctx.drawImage(img, sx, sy, sw, sh, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return c;
}

function softmax(arr, scale) {
  let m = -Infinity;
  for (const v of arr) m = Math.max(m, v * scale);
  const ex = arr.map((v) => Math.exp(v * scale - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / s);
}

// Mengenali isi foto. `img` adalah HTMLImageElement atau canvas.
// Hasil: { kind: 'food'|'menu'|'other', candidates: [{ id, score, topInView }] }
export async function classify(img) {
  if (!isReady()) throw new Error('not_ready');
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const cw = W * 0.6, ch = H * 0.6;
  const views = [
    [0, 0, W, H],                          // seluruh foto
    [W * 0.15, H * 0.15, W * 0.7, H * 0.7], // bagian tengah
    [0, 0, cw, ch],                        // kiri atas
    [W - cw, 0, cw, ch],                   // kanan atas
    [0, H - ch, cw, ch],                   // kiri bawah
    [W - cw, H - ch, cw, ch],              // kanan bawah
  ];

  ls.set(LS_RUNNING, visionDtype);
  const perView = [];
  try {
    // Satu per satu, bukan sekaligus, supaya pemakaian memori tetap kecil.
    for (const v of views) {
      const inputs = await processor(T.RawImage.fromCanvas(square(img, ...v)).rgb());
      const { image_embeds } = await vision(inputs);
      const d = image_embeds.dims[1];
      const e = image_embeds.data;
      let n = 0;
      for (let k = 0; k < d; k++) n += e[k] ** 2;
      n = Math.sqrt(n) || 1;
      perView.push(LABELS.map((_, li) => {
        let s = 0;
        for (let k = 0; k < d; k++) s += (e[k] / n) * textEmb[li * d + k];
        return s;
      }));
      try { image_embeds.dispose && image_embeds.dispose(); } catch (err) {}
      try { inputs.pixel_values && inputs.pixel_values.dispose && inputs.pixel_values.dispose(); } catch (err) {}
      await sleep(0);
    }
  } finally {
    ls.del(LS_RUNNING);
  }

  const foodIdx = [], nonIdx = [];
  LABELS.forEach((l, i) => (l.food ? foodIdx : nonIdx).push(i));

  // Jenis foto ditentukan dari foto utuh terhadap semua label.
  const allFull = softmax(perView[0], 100);
  let top = 0;
  allFull.forEach((p, i) => { if (p > allFull[top]) top = i; });
  let menuP = 0, otherP = 0;
  nonIdx.forEach((i) => { if (LABELS[i].kind === 'menu') menuP += allFull[i]; else otherP += allFull[i]; });
  let kind = 'food';
  if (!LABELS[top].food) kind = LABELS[top].kind === 'menu' || menuP > otherP ? 'menu' : 'other';
  if (kind === 'food' && menuP > 0.45) kind = 'menu';

  // Skor makanan per tampilan (hanya di antara label makanan).
  const foodProbs = perView.map((sims) => softmax(foodIdx.map((i) => sims[i]), 100));
  const tops = foodProbs.map((ps) => ps.indexOf(Math.max(...ps)));
  const scores = foodIdx.map((li, j) => {
    const full = foodProbs[0][j], center = foodProbs[1][j];
    const quad = Math.max(foodProbs[2][j], foodProbs[3][j], foodProbs[4][j], foodProbs[5][j]);
    return { id: LABELS[li].id, score: Math.max(full, center, quad * 0.8), topInView: tops.includes(j) };
  });
  scores.sort((a, b) => b.score - a.score);
  const candidates = scores.filter((s, i) => i < 3 || s.score >= 0.05).slice(0, 8);
  return { kind, candidates };
}
