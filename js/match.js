// Mencocokkan teks (hasil baca menu atau ketikan pencarian) dengan database makanan.
import { FOODS } from './foods.js';

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(^|[a-z])0(?=[a-z])/g, '$1o')     // OCR sering membaca "o" sebagai "0"
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Kata dianggap sama jika persis, atau beda satu huruf untuk kata panjang (salah baca OCR).
function tokEq(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return lev(a, b) <= 1;
  return false;
}

// Indeks nama dan alias, masing-masing sebagai daftar kata.
const INDEX = [];
for (const f of FOODS) {
  const seen = new Set();
  for (const name of [f.n, ...f.a]) {
    const toks = norm(name).split(' ').filter(Boolean);
    const key = toks.join(' ');
    if (!toks.length || seen.has(key)) continue;
    seen.add(key);
    INDEX.push({ id: f.id, toks, len: key.length });
  }
}

// Apakah semua kata alias muncul berurutan di dalam baris?
function containsSeq(lineToks, aliasToks) {
  outer: for (let i = 0; i <= lineToks.length - aliasToks.length; i++) {
    for (let j = 0; j < aliasToks.length; j++) {
      if (!tokEq(lineToks[i + j], aliasToks[j])) continue outer;
    }
    return true;
  }
  return false;
}

const PRICE_RE = /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d)?\s?(?:k|rb|ribu)\b|\d{4,7})(?:,-|\.-|-)?/gi;

export function findPrice(line) {
  const m = String(line).match(PRICE_RE);
  if (!m) return '';
  const raw = m[m.length - 1].trim();
  let n;
  if (/k|rb|ribu/i.test(raw)) n = parseFloat(raw.replace(',', '.')) * 1000;
  else n = parseInt(raw.replace(/rp\.?\s*/i, '').replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(n) || n < 500 || n > 5000000) return '';
  return 'Rp ' + n.toLocaleString('id-ID');
}

// Kecocokan terbaik untuk satu potong teks: { id, score } atau null.
export function bestMatch(text) {
  const toks = norm(String(text).replace(PRICE_RE, ' ')).split(' ').filter((t) => t && !/^\d+$/.test(t));
  if (!toks.length) return null;
  let best = null;
  for (const e of INDEX) {
    if (e.toks.length > toks.length) continue;
    if (!containsSeq(toks, e.toks)) continue;
    const score = e.toks.length * 100 + e.len;
    if (!best || score > best.score) best = { id: e.id, score };
  }
  return best;
}

// Merapikan teks satu hidangan dari menu: buang harga, titik-titik, dan huruf kapital semua.
export function cleanLabel(s) {
  let t = String(s || '').replace(PRICE_RE, ' ').replace(/[.\-_=~*•·:|]{2,}/g, ' ').replace(/^[\s\d.)\-•*]+/, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[\s.,:;\-]+$/, '');
  if (t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return t.slice(0, 60);
}

// Membaca teks menu baris per baris. Mengembalikan item yang dikenali dan baris yang tidak.
export function matchMenu(text) {
  const items = [];
  const unknown = [];
  const got = new Set();
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const letters = line.replace(/[^a-z]/gi, '');
    if (letters.length < 3) continue;
    const price = findPrice(line);
    const parts = line.split(/\s[+&]\s|\s\+|\+\s|,|\bdan\b|\bdengan\b|\bpakai\b|\bplus\b/i).map((p) => p.trim()).filter(Boolean);
    let any = false;
    parts.forEach((part, idx) => {
      const m = bestMatch(part);
      if (!m) return;
      any = true;
      const label = cleanLabel(part) || cleanLabel(line);
      const key = m.id + '|' + norm(label);
      if (got.has(key)) return;
      got.add(key);
      items.push({ id: m.id, label, price: idx === 0 ? price : '' });
    });
    if (!any && letters.length >= 4) unknown.push(cleanLabel(line) || line);
  }
  return { items: items.slice(0, 40), unknown: unknown.slice(0, 40) };
}

// Pencarian manual untuk kotak "Cari makanan".
export function search(q, limit = 8) {
  const nq = norm(q);
  if (!nq) return [];
  const qt = nq.split(' ');
  const scored = [];
  for (const f of FOODS) {
    let best = 0;
    for (const name of [f.n, ...f.a]) {
      const nn = norm(name);
      let s = 0;
      if (nn === nq) s = 100;
      else if (nn.startsWith(nq)) s = 80;
      else if (nn.includes(nq)) s = 60;
      else if (qt.every((t) => nn.split(' ').some((w) => w.startsWith(t) || tokEq(w, t)))) s = 40;
      if (name === f.n && s) s += 5;
      best = Math.max(best, s);
    }
    if (best) scored.push({ f, s: best });
  }
  scored.sort((a, b) => b.s - a.s || a.f.n.localeCompare(b.f.n));
  return scored.slice(0, limit).map((x) => x.f);
}
