import { FOOD_BY_ID } from './foods.js';
import * as store from './db.js';
import { matchMenu, search } from './match.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (n) => Math.round(n || 0).toLocaleString('id-ID');
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 });
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
const newId = () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const MB = (b) => (b / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 0 });

const SLOTS = [['pagi', 'Sarapan'], ['siang', 'Makan siang'], ['malam', 'Makan malam'], ['camilan', 'Camilan']];
const MULTS = [0.5, 1, 1.5, 2, 3];
const multLabel = (m) => (m === 0.5 ? '½' : m === 1.5 ? '1½' : String(m));
const DAYN = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function dateKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function slotByTime(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 10) return 'pagi';
  if (h >= 10 && h < 15) return 'siang';
  if (h >= 17 && h < 22) return 'malam';
  return 'camilan';
}
const timeLabel = (t) => { try { return new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

// Satu baris hasil, dibuat dari data makanan di database.
function itemFrom(id, extra = {}) {
  const f = FOOD_BY_ID[id];
  return {
    id, nama: f.n, porsi: f.porsi, kalori: f.kcal, protein: f.p, karbo: f.c, lemak: f.f,
    label: '', harga: '', conf: null, on: true, mult: 1, ...extra,
  };
}
const exampleResult = () => ({
  kind: 'example', saved: false, unknown: [],
  items: ['nasi-putih', 'ayam-goreng', 'tempe-goreng', 'sayur-asem', 'sambal'].map((id) => itemFrom(id)),
});

const S = {
  target: 2150, days: {},
  photo: null, result: exampleResult(), mode: 'food',
  busy: false, run: 0,
  vision: 'unknown', // unknown | none | loading | ready | error
};

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
function status(msg, isErr) { const s = $('#scanMsg'); s.textContent = msg || ''; s.classList.toggle('err', !!isErr); }
function work(msg, frac) {
  const w = $('#work');
  if (msg == null) { w.hidden = true; return; }
  w.hidden = false;
  $('#workMsg').textContent = msg;
  $('#workFill').style.width = (frac == null ? 100 : Math.max(3, Math.min(100, frac * 100))) + '%';
}
const totals = (items) => items.reduce((a, i) => ({
  kcal: a.kcal + i.kalori * i.mult, p: a.p + i.protein * i.mult, c: a.c + i.karbo * i.mult, f: a.f + i.lemak * i.mult,
}), { kcal: 0, p: 0, c: 0, f: 0 });
const dayTotals = (day) => ((day && day.entries) || []).reduce((a, e) => ({
  kcal: a.kcal + (+e.kcal || 0), p: a.p + (+e.p || 0), c: a.c + (+e.c || 0), f: a.f + (+e.f || 0),
}), { kcal: 0, p: 0, c: 0, f: 0 });

/* ================= Kartu hasil ================= */
const CONF_TEXT = { tinggi: 'Cocok', sedang: 'Mungkin', rendah: 'Kurang yakin' };

function renderResult() {
  const card = $('#result'), r = S.result;
  card.hidden = !r;
  if (!r) return;
  const kind = $('#resKind');
  kind.textContent = { example: 'Contoh', food: 'Dari foto makanan', menu: 'Dari daftar menu', manual: 'Pilihan sendiri' }[r.kind] || '';
  kind.classList.toggle('example', r.kind === 'example');
  $('#resLead').textContent = {
    example: 'Begini hasilnya nanti. Coba atur porsi atau hapus centang.',
    food: 'Tebakan AI untuk isi fotomu. Centang yang benar, atur porsinya. Ada yang kurang? Cari dan tambahkan di atas.',
    menu: 'Hidangan yang terbaca dari menu. Centang yang kamu pesan, lalu atur porsinya.',
    manual: 'Atur porsi dengan − dan +, lalu catat.',
  }[r.kind] || '';

  const list = $('#items'); list.replaceChildren();
  if (!r.items.length) list.append(el('li', 'empty-items', r.kind === 'menu' ? 'Belum ada hidangan yang dikenali dari menu ini.' : 'Belum ada makanan. Cari dan tambahkan di atas.'));
  r.items.forEach((it, i) => {
    const li = el('li', 'item' + (it.on ? '' : ' off')); li.dataset.i = i;
    const cb = el('input'); cb.type = 'checkbox'; cb.id = 'it-' + i; cb.checked = it.on; cb.dataset.act = 'toggle';
    const lab = el('label', 'item-main'); lab.htmlFor = cb.id;
    lab.append(el('span', 'item-name', it.label || it.nama));
    const meta = [it.label ? '≈ ' + it.nama : '', it.porsi, it.harga].filter(Boolean).join(' · ');
    lab.append(el('span', 'item-portion', meta));
    if (it.conf) lab.append(el('span', 'conf ' + (it.conf === 'tinggi' ? 'high' : it.conf === 'rendah' ? 'low' : ''), CONF_TEXT[it.conf]));
    const right = el('div', 'item-right');
    right.append(el('span', 'item-kcal', fmt(it.kalori * it.mult)));
    const st = el('div', 'stepper');
    const minus = el('button', null, '−'); minus.type = 'button'; minus.dataset.act = 'minus';
    minus.setAttribute('aria-label', 'Kurangi porsi ' + it.nama); minus.disabled = !it.on || it.mult <= MULTS[0];
    const out = el('output', null, '×' + multLabel(it.mult));
    const plus = el('button', null, '+'); plus.type = 'button'; plus.dataset.act = 'plus';
    plus.setAttribute('aria-label', 'Tambah porsi ' + it.nama); plus.disabled = !it.on || it.mult >= MULTS[MULTS.length - 1];
    st.append(minus, out, plus); right.append(st);
    li.append(cb, lab, right); list.append(li);
  });

  const t = totals(r.items.filter((i) => i.on));
  $('#totKcal').textContent = fmt(t.kcal);
  $('#totPct').textContent = Math.round((t.kcal / S.target) * 100) + '% dari target harian ' + fmt(S.target) + ' kkal';
  $('#mP').textContent = fmt1(t.p) + ' g';
  $('#mC').textContent = fmt1(t.c) + ' g';
  $('#mF').textContent = fmt1(t.f) + ' g';
  const pe = t.p * 4, ce = t.c * 4, fe = t.f * 9, sum = pe + ce + fe;
  $('#spP').style.width = (sum ? (pe / sum) * 100 : 0) + '%';
  $('#spC').style.width = (sum ? (ce / sum) * 100 : 0) + '%';
  $('#spF').style.width = (sum ? (fe / sum) * 100 : 0) + '%';

  const unk = r.unknown || [];
  $('#unknownBox').hidden = !unk.length;
  $('#unknownSum').textContent = unk.length + ' baris menu lain yang terbaca';
  const ul = $('#unknownList'); ul.replaceChildren(...unk.map((u) => el('li', null, u)));

  $('#saveRow').hidden = r.kind === 'example';
  $('#exampleFoot').hidden = r.kind !== 'example';
  $('#disclaimer').hidden = r.kind === 'example';
  const btn = $('#saveBtn');
  btn.disabled = t.kcal <= 0 || r.saved;
  btn.textContent = r.saved ? 'Sudah dicatat' : t.kcal <= 0 ? 'Pilih hidangan dulu' : 'Catat ' + fmt(t.kcal) + ' kkal';
}

$('#items').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b || !S.result) return;
  const i = +b.closest('li').dataset.i, it = S.result.items[i], k = MULTS.indexOf(it.mult);
  if (b.dataset.act === 'minus' && k > 0) it.mult = MULTS[k - 1];
  if (b.dataset.act === 'plus' && k < MULTS.length - 1) it.mult = MULTS[k + 1];
  S.result.saved = false; renderResult();
  const again = document.querySelector('#items li[data-i="' + i + '"] button[data-act="' + b.dataset.act + '"]');
  if (again && !again.disabled) again.focus();
});
$('#items').addEventListener('change', (e) => {
  if (e.target.dataset.act !== 'toggle' || !S.result) return;
  const i = +e.target.closest('li').dataset.i;
  S.result.items[i].on = e.target.checked; S.result.saved = false; renderResult();
  const cb = document.getElementById('it-' + i); if (cb) cb.focus();
});

/* ================= Cari dan tambah ================= */
const qIn = $('#q'), qList = $('#qList');
function renderSearch() {
  const res = search(qIn.value, 8);
  qList.replaceChildren();
  if (!qIn.value.trim()) { qList.hidden = true; return; }
  qList.hidden = false;
  if (!res.length) { qList.append(el('li', 'none', 'Tidak ditemukan. Coba nama lain, misalnya "ayam" atau "mie".')); return; }
  for (const f of res) {
    const li = el('li'); const b = el('button'); b.type = 'button'; b.dataset.id = f.id;
    b.append(el('b', null, f.n), el('span', null, f.porsi), el('em', null, fmt(f.kcal)));
    b.setAttribute('aria-label', 'Tambah ' + f.n + ', ' + f.porsi + ', ' + fmt(f.kcal) + ' kkal');
    li.append(b); qList.append(li);
  }
}
qIn.addEventListener('input', renderSearch);
qIn.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { qIn.value = ''; renderSearch(); }
  if (e.key === 'Enter') { e.preventDefault(); const first = qList.querySelector('button'); if (first) first.click(); }
});
qList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-id]'); if (!b) return;
  addManual(b.dataset.id);
  qIn.value = ''; renderSearch(); qIn.focus();
});
function addManual(id) {
  if (!S.result || S.result.kind === 'example') S.result = { kind: 'manual', saved: false, unknown: [], items: [] };
  S.result.items.push(itemFrom(id));
  S.result.saved = false;
  renderResult();
  toast('Ditambahkan: ' + FOOD_BY_ID[id].n);
}

/* ================= Hari ini ================= */
function renderToday() {
  const key = dateKey(), day = S.days[key];
  const entries = [...((day && day.entries) || [])].sort((a, b) => (a.t || 0) - (b.t || 0));
  const t = dayTotals(day), over = t.kcal > S.target;
  $('#todayKcal').textContent = fmt(t.kcal);
  $('#todayTarget').textContent = fmt(S.target);
  $('#miniKcal').textContent = fmt(t.kcal);
  $('#miniTarget').textContent = fmt(S.target);
  $('#targetVal').textContent = fmt(S.target);
  const bar = $('#bar');
  bar.classList.toggle('over', over);
  bar.setAttribute('aria-valuemax', String(S.target));
  bar.setAttribute('aria-valuenow', String(Math.round(t.kcal)));
  $('#barFill').style.width = Math.min(100, (t.kcal / S.target) * 100) + '%';
  const rem = $('#remain'); rem.classList.toggle('over', over);
  rem.textContent = over ? 'Lewat ' + fmt(t.kcal - S.target) + ' kkal dari target'
    : t.kcal === 0 ? 'Belum ada yang dicatat hari ini'
    : 'Sisa ' + fmt(S.target - t.kcal) + ' kkal lagi';
  $('#tP').textContent = fmt1(t.p) + ' g';
  $('#tC').textContent = fmt1(t.c) + ' g';
  $('#tF').textContent = fmt1(t.f) + ' g';

  const box = $('#meals'); box.replaceChildren();
  if (!entries.length) {
    box.append(el('p', 'meals-empty', 'Catatan makanmu hari ini muncul di sini. Foto makanan, lalu tekan "Catat" di bawah hasilnya.'));
    return;
  }
  for (const [k, label] of SLOTS) {
    const es = entries.filter((e) => (e.slot || 'camilan') === k);
    if (!es.length) continue;
    const sec = el('section', 'slot');
    const h = el('h3'); h.append(el('span', null, label), el('span', null, fmt(es.reduce((a, e) => a + (+e.kcal || 0), 0)) + ' kkal'));
    const ul = el('ul', 'meal-list');
    for (const e of es) {
      const li = el('li', 'meal');
      if (typeof e.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(e.thumb)) {
        const im = el('img'); im.src = e.thumb; im.alt = ''; li.append(im);
      } else li.append(el('span', 'noimg'));
      const mid = el('div', 'meal-mid');
      mid.append(el('span', 'meal-name', e.name || 'Makanan'),
        el('span', 'meal-time', timeLabel(e.t) + ' · P ' + fmt1(e.p) + ' g · K ' + fmt1(e.c) + ' g · L ' + fmt1(e.f) + ' g'));
      const del = el('button', 'del', '×'); del.type = 'button'; del.dataset.id = e.id;
      del.setAttribute('aria-label', 'Hapus ' + (e.name || 'catatan'));
      li.append(mid, el('span', 'meal-kcal', fmt(e.kcal)), del);
      ul.append(li);
    }
    sec.append(h, ul); box.append(sec);
  }
}

$('#meals').addEventListener('click', (e) => {
  const b = e.target.closest('button.del'); if (!b) return;
  if (!b.classList.contains('armed')) {
    b.classList.add('armed'); b.textContent = 'Hapus';
    clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('armed'); b.textContent = '×'; }, 3000);
    return;
  }
  const key = dateKey(), day = clone(S.days[key]); if (!day) return;
  day.entries = (day.entries || []).filter((x) => x.id !== b.dataset.id);
  saveDay(key, day); toast('Catatan dihapus');
});

function renderWeek() {
  const bars = $('#weekBars'), labels = $('#weekLabels');
  bars.querySelectorAll('.wcol').forEach((n) => n.remove()); labels.replaceChildren();
  const now = new Date(), vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    vals.push({ d, kcal: dayTotals(S.days[dateKey(d)]).kcal, isToday: i === 0 });
  }
  const max = Math.max(S.target * 1.25, ...vals.map((v) => v.kcal));
  $('#targetLine').style.bottom = (S.target / max) * 100 + '%';
  for (const v of vals) {
    const c = el('div', 'wcol' + (v.isToday ? ' is-today' : '') + (v.kcal > S.target ? ' over' : '') + (v.kcal ? '' : ' zero'));
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', DAYN[v.d.getDay()] + ' ' + v.d.getDate() + ': ' + fmt(v.kcal) + ' kkal');
    const i = el('i'); i.style.height = v.kcal ? Math.max(4, (v.kcal / max) * 100) + '%' : '3px';
    c.append(i); bars.append(c);
    const lab = el('div', 'wlab' + (v.isToday ? ' is-today' : ''));
    lab.append(el('b', null, v.isToday ? 'Ini' : DAYN[v.d.getDay()]), el('span', null, v.kcal ? fmt(v.kcal) : '–'));
    labels.append(lab);
  }
  const logged = vals.filter((v) => v.kcal > 0);
  $('#weekAvg').textContent = logged.length
    ? 'Rata-rata ' + fmt(logged.reduce((a, v) => a + v.kcal, 0) / logged.length) + ' kkal/hari'
    : 'Belum ada catatan';
}
function renderAll() { renderResult(); renderToday(); renderWeek(); }

/* ================= Simpan di perangkat ================= */
let persistAsked = false;
async function saveDay(key, data) {
  S.days = { ...S.days, [key]: data };
  renderToday(); renderWeek();
  try { await store.set('day:' + key, data); }
  catch (e) { toast('Gagal menyimpan. Ruang penyimpanan HP mungkin penuh.'); }
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
}
async function saveSettings() {
  try { await store.set('settings', { target: S.target }); } catch (e) {}
}
async function loadData() {
  try {
    const st = await store.get('settings');
    if (st && Number.isFinite(+st.target)) S.target = +st.target;
    const days = {};
    for (const [k, v] of await store.entries('day:')) days[k.slice(4)] = v;
    S.days = days;
  } catch (e) {}
  if (store.isMemoryOnly()) {
    const chip = $('#storeChip');
    chip.textContent = 'Tidak tersimpan'; chip.classList.add('memory');
    chip.title = 'Browser ini tidak mengizinkan penyimpanan. Catatan hilang saat aplikasi ditutup.';
  }
}

$('#saveBtn').addEventListener('click', () => {
  const r = S.result; if (!r || r.kind === 'example' || r.saved) return;
  const on = r.items.filter((i) => i.on); const t = totals(on);
  if (t.kcal <= 0) return;
  const entry = {
    id: newId(), t: Date.now(), slot: $('#slot').value,
    name: on.map((i) => (i.label || i.nama) + (i.mult !== 1 ? ' ×' + multLabel(i.mult) : '')).join(', ').slice(0, 160),
    kcal: Math.round(t.kcal), p: r1(t.p), c: r1(t.c), f: r1(t.f),
    thumb: (S.photo && S.photo.thumb) || '',
  };
  const key = dateKey();
  const day = clone(S.days[key]) || { date: key, entries: [] };
  day.date = key; day.entries = day.entries || [];
  day.entries.push(entry);
  saveDay(key, day);
  r.saved = true; renderResult();
  const label = (SLOTS.find((s) => s[0] === entry.slot) || ['', ''])[1];
  toast('Dicatat ke ' + label.toLowerCase() + ': ' + fmt(entry.kcal) + ' kkal');
});

$('#editTarget').addEventListener('click', () => {
  $('#targetRow').hidden = true; $('#targetForm').hidden = false;
  const inp = $('#targetIn'); inp.value = S.target; inp.focus(); inp.select();
});
$('#cancelTarget').addEventListener('click', () => { $('#targetForm').hidden = true; $('#targetRow').hidden = false; $('#editTarget').focus(); });
$('#targetForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = Math.round(+$('#targetIn').value);
  if (!Number.isFinite(v) || v < 800 || v > 6000) { toast('Isi target antara 800 dan 6.000 kkal.'); return; }
  $('#targetForm').hidden = true; $('#targetRow').hidden = false;
  S.target = v; saveSettings(); renderAll();
  toast('Target diubah ke ' + fmt(v) + ' kkal');
});

/* Cadangan */
$('#exportBtn').addEventListener('click', () => {
  const data = { app: 'foto-kalori', version: 1, exported: new Date().toISOString(), settings: { target: S.target }, days: S.days };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'foto-kalori-cadangan-' + dateKey() + '.json';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('File cadangan dibuat');
});
$('#importIn').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (err) { toast('File ini bukan cadangan Foto Kalori.'); return; }
  if (!data || data.app !== 'foto-kalori' || typeof data.days !== 'object') { toast('File ini bukan cadangan Foto Kalori.'); return; }
  let added = 0;
  for (const [key, day] of Object.entries(data.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || !Array.isArray(day.entries)) continue;
    const cur = clone(S.days[key]) || { date: key, entries: [] };
    const ids = new Set(cur.entries.map((x) => x.id));
    for (const en of day.entries) {
      if (!en || ids.has(en.id) || !Number.isFinite(+en.kcal)) continue;
      cur.entries.push({ id: String(en.id || newId()), t: +en.t || Date.now(), slot: String(en.slot || 'camilan'), name: String(en.name || 'Makanan').slice(0, 160), kcal: +en.kcal, p: +en.p || 0, c: +en.c || 0, f: +en.f || 0, thumb: typeof en.thumb === 'string' ? en.thumb : '' });
      added++;
    }
    S.days[key] = cur;
    try { await store.set('day:' + key, cur); } catch (err) {}
  }
  if (data.settings && Number.isFinite(+data.settings.target)) { S.target = +data.settings.target; saveSettings(); }
  renderAll();
  toast(added ? added + ' catatan dipulihkan' : 'Semua catatan di cadangan ini sudah ada');
});

/* ================= Foto ================= */
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('decode'));
    im.src = src;
  });
}
function toJpegBlob(img, max, q) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', q));
}
function toThumb(img, size) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight, side = Math.min(w0, h0);
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(img, (w0 - side) / 2, (h0 - side) / 2, side, side, 0, 0, size, size);
  try { return c.toDataURL('image/jpeg', 0.6); } catch (e) { return ''; }
}

async function takeFile(file) {
  if (S.busy) return;
  if (!file || (file.type && !/^image\//.test(file.type))) { status('Pilih file gambar, misalnya JPG atau PNG.', true); return; }
  const tmpUrl = URL.createObjectURL(file);
  let raw;
  try { raw = await loadImage(tmpUrl); }
  catch (e) { status('Foto ini tidak bisa dibuka. Coba foto lain dalam format JPG atau PNG.', true); return; }
  finally { URL.revokeObjectURL(tmpUrl); }
  const blob = await toJpegBlob(raw, 2000, 0.88);
  if (!blob) { status('Foto ini tidak bisa diproses. Coba foto lain.', true); return; }
  if (S.photo && S.photo.url) URL.revokeObjectURL(S.photo.url);
  const url = URL.createObjectURL(blob);
  const img = await loadImage(url);
  S.photo = { blob, url, img, thumb: toThumb(img, 96) };
  const ph = $('#photo'); ph.src = url; ph.hidden = false; $('#plate').hidden = true;
  $('#modeRow').hidden = false;
  status('');
  analyze('auto');
}

['#camIn', '#galIn'].forEach((sel) => {
  $(sel).addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) takeFile(f); });
});
const cap = $('#capture');
cap.addEventListener('dragover', (e) => { e.preventDefault(); cap.classList.add('drag'); });
cap.addEventListener('dragleave', (e) => { if (!cap.contains(e.relatedTarget)) cap.classList.remove('drag'); });
cap.addEventListener('drop', (e) => {
  e.preventDefault(); cap.classList.remove('drag');
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) takeFile(f);
});
document.addEventListener('paste', (e) => {
  const files = e.clipboardData && e.clipboardData.files;
  const f = files && [...files].find((x) => /^image\//.test(x.type));
  if (f) { e.preventDefault(); takeFile(f); }
});

function setMode(m) {
  S.mode = m;
  $('#asFood').setAttribute('aria-pressed', String(m === 'food'));
  $('#asMenu').setAttribute('aria-pressed', String(m === 'menu'));
}
$('#asFood').addEventListener('click', () => { if (!S.busy && S.photo) analyze('food'); });
$('#asMenu').addEventListener('click', () => { if (!S.busy && S.photo) analyze('menu'); });

function setBusy(b) {
  S.busy = b;
  $('#preview').classList.toggle('scanning', b);
  $('#camIn').disabled = b; $('#galIn').disabled = b;
  $('#asFood').disabled = b; $('#asMenu').disabled = b;
  $('#stopBtn').hidden = !b;
  if (!b) work(null);
}
$('#stopBtn').addEventListener('click', () => {
  S.run++; setBusy(false); status('Dibatalkan. Pilih "Makanan" atau "Daftar menu" untuk mencoba lagi.');
});

/* ================= AI foto ================= */
let visionMod = null;
const getVision = async () => (visionMod = visionMod || await import('./vision.js'));

function renderAi(extra) {
  const box = $('#aiBox'), t = $('#aiTitle'), p = $('#aiText'), b = $('#aiBtn');
  box.classList.toggle('ready', S.vision === 'ready');
  b.hidden = !(S.vision === 'none' || S.vision === 'error');
  if (S.vision === 'ready') { t.textContent = 'AI foto siap'; p.textContent = 'Berjalan di perangkat ini dan bisa dipakai tanpa internet.'; }
  else if (S.vision === 'loading') { t.textContent = 'Menyiapkan AI foto…'; p.textContent = extra || 'Tunggu sebentar.'; }
  else if (S.vision === 'error') { t.textContent = 'AI foto belum bisa disiapkan'; p.textContent = extra || 'Periksa koneksi internet, lalu coba lagi. Membaca menu dan pencarian tetap bisa dipakai.'; b.textContent = 'Coba lagi'; }
  else { t.textContent = 'AI foto belum disiapkan'; p.textContent = 'Unduh sekali (±150 MB), setelah itu bisa dipakai tanpa internet. Pakai Wi-Fi bila bisa.'; b.textContent = 'Siapkan sekarang'; }
}

function describeLoad(pr) {
  if (!pr) return ['Menyiapkan AI foto…', null];
  if (pr.phase === 'prepare') return ['Menyusun kamus makanan untuk AI… ' + pr.done + '/' + pr.count, pr.done / pr.count];
  if (pr.total > 0) return ['Mengunduh AI foto (sekali saja)… ' + MB(pr.loaded) + ' / ' + MB(pr.total) + ' MB', pr.loaded / pr.total];
  return ['Memuat AI foto…', null];
}

async function ensureVision(showWork) {
  const v = await getVision();
  if (v.isReady()) { S.vision = 'ready'; renderAi(); return v; }
  S.vision = 'loading'; renderAi();
  try {
    await v.load((pr) => {
      const [msg, frac] = describeLoad(pr);
      renderAi(msg);
      if (showWork()) work(msg, frac);
    });
    S.vision = 'ready'; renderAi();
    return v;
  } catch (e) {
    console.error(e);
    S.vision = 'error';
    renderAi(navigator.onLine === false
      ? 'Kamu sedang offline. Sambungkan ke internet sekali untuk mengunduh AI foto.'
      : 'Unduhan gagal. Periksa koneksi internet, lalu coba lagi.');
    throw e;
  }
}
$('#aiBtn').addEventListener('click', () => { ensureVision(() => false).then(() => toast('AI foto siap dipakai')).catch(() => {}); });

const levelOf = (s) => (s >= 0.5 ? 'tinggi' : s >= 0.15 ? 'sedang' : 'rendah');

async function analyze(mode) {
  if (!S.photo) return;
  const run = ++S.run;
  const alive = () => run === S.run;
  setBusy(true); status('');
  try {
    let kind = mode;
    let found = null;
    let noVision = false;
    if (mode === 'auto' || mode === 'food') {
      setMode('food');
      let v = null;
      try { v = await ensureVision(alive); }
      catch (e) {
        if (!alive()) return;
        if (mode !== 'auto') throw e;
        // AI foto belum ada: coba baca sebagai menu (pembaca menu selalu tersedia).
        noVision = true;
      }
      if (!alive()) return;
      if (v) {
        work('Mengenali isi foto…', null);
        await new Promise((r) => setTimeout(r, 30));
        found = await v.classify(S.photo.img);
        if (!alive()) return;
      }
      kind = noVision || (mode === 'auto' && found.kind === 'menu') ? 'menu' : 'food';
    }

    if (kind === 'menu') {
      setMode('menu');
      work('Membaca tulisan di menu…', 0.02);
      const ocr = await import('./ocr.js');
      const text = await ocr.readText(S.photo.img, (p, stage) => {
        if (alive()) work(stage === 'membaca' ? 'Membaca tulisan di menu… ' + Math.round(p * 100) + '%' : 'Menyiapkan pembaca menu…', stage === 'membaca' ? p : 0.05);
      });
      if (!alive()) return;
      const m = matchMenu(text);
      if (noVision && m.items.length < 2) {
        setMode('food');
        status('AI foto belum siap, jadi foto makanan ini belum bisa dikenali. Siapkan AI foto di bawah, atau cari dan tambahkan makanannya.', true);
        S.result = null;
        return;
      }
      S.result = {
        kind: 'menu', saved: false, unknown: m.unknown,
        items: m.items.map((x) => itemFrom(x.id, { label: x.label, harga: x.price, on: false })),
      };
      if (!m.items.length) {
        status(text.trim() ? 'Tulisan terbaca, tapi belum ada hidangan yang dikenali. Lihat teks yang terbaca di bawah, lalu cari manual.' : 'Tulisan di foto belum terbaca. Coba foto lebih dekat, lurus, dan terang.', true);
      } else {
        toast(m.items.length + ' hidangan dikenali dari menu');
      }
    } else {
      const cands = found.candidates;
      let onCount = 0;
      const items = cands.map((c, i) => {
        const on = onCount < 4 && (i === 0 || c.score >= 0.35 || (c.topInView && c.score >= 0.2));
        if (on) onCount++;
        return itemFrom(c.id, { conf: levelOf(c.score), on });
      });
      S.result = { kind: 'food', saved: false, unknown: [], items };
      if (found.kind === 'other') status('Sepertinya ini bukan foto makanan. Pilih yang cocok di bawah, atau cari manual.', true);
      $('#slot').value = slotByTime();
    }
  } catch (e) {
    console.error(e);
    if (alive()) status(S.mode === 'menu' ? 'Menu belum bisa dibaca. Coba lagi, atau foto ulang dengan cahaya lebih terang.' : 'Foto belum bisa dikenali. Coba lagi, atau cari makanan secara manual.', true);
  } finally {
    if (alive()) { setBusy(false); renderResult(); }
  }
}

/* ================= Aplikasi terpasang & offline ================= */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; installEvt = null; toast('Foto Kalori terpasang'); });
$('#installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  try { await installEvt.userChoice; } catch (e) {}
  installEvt = null; $('#installBtn').hidden = true;
});
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (isIos && !standalone) $('#iosHint').hidden = false;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/* ================= Mulai ================= */
(async function boot() {
  try {
    const d = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#dateLabel').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  } catch (e) {}
  $('#slot').value = slotByTime();
  renderAll();
  await loadData();
  renderAll();
  // Jika AI foto pernah disiapkan, muat diam-diam supaya foto pertama cepat.
  try {
    const v = await getVision();
    if (await v.wasReadyBefore()) {
      S.vision = 'loading'; renderAi('Memuat dari perangkat…');
      const go = () => ensureVision(() => false).catch(() => {});
      if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 800);
    } else { S.vision = 'none'; renderAi(); }
  } catch (e) { S.vision = 'none'; renderAi(); }
})();
