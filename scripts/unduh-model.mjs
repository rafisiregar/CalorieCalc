// Opsional: simpan model AI foto di dalam folder aplikasi sendiri.
// Setelah ini dijalankan dan folder models/ ikut diunggah ke hosting, aplikasi
// tidak perlu menghubungi server lain sama sekali, bahkan untuk unduhan pertama.
//
// Cara pakai (butuh Node.js 18 atau lebih baru):
//   node scripts/unduh-model.mjs

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'Xenova/mobileclip_s0';
const FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/text_model_quantized.onnx',   // ±43 MB, dipakai sekali untuk menyusun kamus makanan
  'onnx/vision_model.onnx',           // ±46 MB, model foto utama
  'onnx/vision_model_quantized.onnx', // ±12 MB, versi ringan untuk HP dengan memori terbatas
];
const OPTIONAL = new Set();

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', ...MODEL.split('/'));

for (const f of FILES) {
  const out = join(root, f);
  try {
    if ((await stat(out)).size > 0) { console.log('sudah ada  ', f); continue; }
  } catch (e) { /* belum ada */ }
  const url = `https://huggingface.co/${MODEL}/resolve/main/${f}`;
  process.stdout.write('mengunduh  ' + f + ' … ');
  const res = await fetch(url);
  if (!res.ok) {
    if (OPTIONAL.has(f)) { console.log('dilewati'); continue; }
    console.log('GAGAL (' + res.status + ')');
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  console.log((buf.length / 1048576).toFixed(1) + ' MB');
}
console.log('\nSelesai. Model tersimpan di models/' + MODEL + '/');
console.log('Unggah folder models/ bersama file aplikasi lainnya.');
