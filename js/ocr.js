// Membaca teks dari foto menu, sepenuhnya di perangkat (Tesseract.js).
// Semua file (mesin OCR dan data bahasa Indonesia/Inggris) ikut di folder vendor/.

let workerPromise = null;
let progressCb = null;

const abs = (p) => new URL(p, import.meta.url).href;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const Tesseract = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
      return Tesseract.createWorker(['ind', 'eng'], 1, {
        workerPath: abs('../vendor/tesseract/worker.min.js'),
        corePath: abs('../vendor/tesseract/core/'),
        langPath: abs('../vendor/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
        logger: (m) => { if (progressCb) progressCb(m); },
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// Menyiapkan gambar agar mudah dibaca: abu-abu, kontras dinaikkan, ukuran wajar.
function prepare(img) {
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const s = Math.min(1, 2000 / Math.max(W, H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * s); c.height = Math.round(H * s);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// onProgress menerima angka 0..1 dan keterangan tahap.
export async function readText(img, onProgress) {
  progressCb = (m) => {
    if (!onProgress || !m) return;
    if (m.status === 'recognizing text') onProgress(m.progress || 0, 'membaca');
    else onProgress(m.progress || 0, 'menyiapkan');
  };
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(prepare(img));
    return data && data.text ? data.text : '';
  } finally {
    progressCb = null;
  }
}
