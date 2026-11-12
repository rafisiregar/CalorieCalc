// AI foto yang berjalan di perangkat (CLIP, lewat Transformers.js + ONNX Runtime WebAssembly).
// Model diunduh sekali, lalu disimpan oleh browser sehingga bisa dipakai tanpa internet.
// Jika folder models/ berisi file model (lihat scripts/unduh-model.mjs), model dimuat dari
// situs ini sendiri dan tidak perlu menghubungi server lain sama sekali.
import { FOODS, NON_FOOD } from './foods.js';
import * as store from './db.js';

export const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DTYPE = 'q8';
const LABELS = [
  ...FOODS.map((f) => ({ id: f.id, food: true, prompt: (f.k === 'minum' ? 'a photo of ' + f.en + ', a drink.' : 'a photo of ' + f.en + ', a type of food.') })),
  ...NON_FOOD.map((x) => ({ id: x.id, food: false, kind: x.kind, prompt: 'a photo of ' + x.en + '.' })),
];
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const EMB_KEY = 'emb:' + MODEL_ID + ':' + DTYPE + ':' + hash(LABELS.map((l) => l.id + l.prompt).join('|'));
const READY_KEY = 'vision-ready:' + MODEL_ID + ':' + DTYPE;

let T = null;
let processor = null;
let vision = null;
let textEmb = null; // Float32Array [labels × dim], baris sudah dinormalisasi
let dim = 512;
let loading = null;

export async function wasReadyBefore() {
  try { return !!(await store.get(READY_KEY)); } catch (e) { return false; }
}
export const isReady = () => !!(vision && processor && textEmb);

function progressTracker(onProgress, phase) {
  const files = new Map();
  return (p) => {
    if (!onProgress || !p) return;
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      onProgress({ phase, loaded, total });
    } else if (p.status === 'done' && p.file && files.has(p.file)) {
      const f = files.get(p.file); f.loaded = f.total;
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
  if (!self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = 1;
  return T;
}

// Memuat model. onProgress menerima { phase: 'download'|'prepare', loaded, total, done, count }.
export function load(onProgress) {
  if (isReady()) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    await loadLib();
    const cb = progressTracker(onProgress, 'download');
    const opts = { dtype: DTYPE, device: 'wasm', progress_callback: cb };
    processor = processor || await T.AutoImageProcessor.from_pretrained(MODEL_ID, { progress_callback: cb });
    vision = vision || await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, opts);
    const saved = await store.get(EMB_KEY).catch(() => null);
    if (saved && saved.data && saved.data.length === LABELS.length * saved.dim) {
      textEmb = saved.data; dim = saved.dim;
    } else {
      await buildTextEmbeddings(onProgress);
    }
    await store.set(READY_KEY, Date.now()).catch(() => {});
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Menghitung "kamus" makanan untuk AI sekali saja, lalu disimpan di perangkat.
async function buildTextEmbeddings(onProgress) {
  const cb = progressTracker(onProgress, 'download');
  const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: cb });
  const textModel = await T.CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: DTYPE, device: 'wasm', progress_callback: cb });
  const texts = LABELS.map((l) => l.prompt);
  let out = null;
  const CHUNK = 16;
  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);
    const inputs = tokenizer(chunk, { padding: true, truncation: true });
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
    onProgress && onProgress({ phase: 'prepare', done: Math.min(i + CHUNK, texts.length), count: texts.length });
    await new Promise((r) => setTimeout(r, 0));
  }
  textEmb = out;
  await store.set(EMB_KEY, { dim, data: out }).catch(() => {});
  try { if (textModel.dispose) await textModel.dispose(); } catch (e) {}
  // Model teks hanya perlu sekali. Hapus dari cache browser agar hemat ruang.
  try {
    if (self.caches) {
      const c = await caches.open('transformers-cache');
      for (const req of await c.keys()) if (/text_model/.test(req.url)) await c.delete(req);
    }
  } catch (e) {}
}

function square(img, sx, sy, sw, sh, size = 336) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  const s = Math.min(size / sw, size / sh);
  const w = sw * s, h = sh * s;
  ctx.drawImage(img, sx, sy, sw, sh, (size - w) / 2, (size - h) / 2, w, h);
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
// Hasil: { kind: 'food'|'menu'|'other', candidates: [{ id, score }] }
export async function classify(img) {
  if (!isReady()) throw new Error('not_ready');
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const cw = W * 0.6, ch = H * 0.6;
  const views = [
    square(img, 0, 0, W, H),                                  // seluruh foto
    square(img, W * 0.15, H * 0.15, W * 0.7, H * 0.7),        // bagian tengah
    square(img, 0, 0, cw, ch),                                // kiri atas
    square(img, W - cw, 0, cw, ch),                           // kanan atas
    square(img, 0, H - ch, cw, ch),                           // kiri bawah
    square(img, W - cw, H - ch, cw, ch),                      // kanan bawah
  ];
  const images = views.map((c) => T.RawImage.fromCanvas(c).rgb());
  const inputs = await processor(images);
  const { image_embeds } = await vision(inputs);
  const d = image_embeds.dims[1];
  const emb = image_embeds.data;

  const foodIdx = [], nonIdx = [];
  LABELS.forEach((l, i) => (l.food ? foodIdx : nonIdx).push(i));

  const perView = views.map((_, v) => {
    let n = 0;
    for (let k = 0; k < d; k++) n += emb[v * d + k] ** 2;
    n = Math.sqrt(n) || 1;
    const sims = LABELS.map((_, li) => {
      let s = 0;
      for (let k = 0; k < d; k++) s += (emb[v * d + k] / n) * textEmb[li * d + k];
      return s;
    });
    return sims;
  });

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
