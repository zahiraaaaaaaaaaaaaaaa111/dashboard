// =====================================================
//  Dashboard Deteksi Helm / APD  -  app.js
//  Model ONNX berjalan di browser (hanya halaman Monitoring Live). Fitur:
//  - Webcam / kamera HP real-time + FPS + slider confidence
//  - Penanganan error kamera dan model
//  - Hitung pelanggar SEKALI per orang (tracking ID)
//  - Upload video sebagai cadangan
//  - Riwayat pelanggaran (Orang#ID, foto, jam, sumber) + unduh CSV
//  - Ringkasan sesi: tanggal/jam, status AMAN/WASPADA/BAHAYA, kalimat otomatis,
//    waktu pelanggaran + grafik, kinerja aplikasi, tombol salin untuk slide
//  - Pilihan model v1 / v2 (menu di atas video)
// =====================================================

// ---------- Membaca file JSON ----------
async function muatJSON(path) {
  const respon = await fetch(path);
  return await respon.json();
}

// =====================================================
//  Tab Monitoring Live
// =====================================================
let dataLive, grafikTren, grafikDonat;
let detikTerakhir = -1;

// Daftar video dummy (kotak dari keyframe)
const daftarVideo = [
  { nama: 'Video 1 - dummy_01', file: 'data/detections_01.json' },
  { nama: 'Video 2 - dummy_02', file: 'data/detections_02.json' },
  { nama: 'Video 3 - dummy_03', file: 'data/detections_03.json' },
  { nama: 'Video 4 - dummy_04', file: 'data/detections_04.json' }
];

// ---------- DAFTAR MODEL (v2 dan v1) ----------
// Model baru: taruh file .onnx di folder onnx, lalu tambah satu baris di daftar ini.
// Model PERTAMA di daftar = pilihan awal saat halaman dibuka.
// - ukuran : harus sama dengan imgsz saat export (yolo export ... imgsz=416)
// - kelas  : urutan harus sama dengan model.names (0 = helmet, 1 = no_helmet)
// - versi  : NAIKKAN angkanya bila isi file diganti dengan nama yang sama (supaya cache HP diperbarui)
// Hapus baris yang file-nya belum ada di folder onnx.
// (Untuk memasang v3 lagi nanti: taruh best_v3_640.onnx / best_v3_416.onnx di folder onnx,
//  lalu tambahkan barisnya di sini, misalnya:
//  { nama: 'Model v3 (akurat 640)', file: 'onnx/best_v3_640.onnx', versi: 1, ukuran: 640, kelas: ['helmet', 'no_helmet'] },)
const daftarModel = [
  { nama: 'Model v2',            file: 'onnx/best_v2.onnx', versi: 1, ukuran: 416, kelas: ['helmet', 'no_helmet'] },
  { nama: 'Model v1 (cadangan)', file: 'onnx/best.onnx',    versi: 1, ukuran: 416, kelas: ['helmet', 'no_helmet'] }
];
let indeksModel = 0;
const modelSekarang = () => daftarModel[indeksModel];

// ---------- Pengaturan deteksi ----------
let batasYakin = 0.5;                  // diatur lewat slider
const BATAS_IOU = 0.45;                // kotak yang tumpang tindih lebih dari ini dianggap ganda
const BATAS_TUMPANG = 0.7;             // kotak kecil yang 70% berada di dalam kotak lain dianggap ganda
const MAKS_LEBAR_KOTAK = 1.0;          // 1.0 = nonaktif. Isi 0.35 untuk mengabaikan kepala yang terlalu dekat

// ---------- Pengaturan pelacakan (tracking) ----------
const BATAS_RENDAH = 0.25;             // tebakan di bawah slider tapi di atas ini HANYA dipakai untuk melanjutkan ID yang sudah ada
const IOU_PASANG = 0.15;               // kemiripan minimum antara posisi perkiraan dan deteksi baru
const JARAK_PASANG = 2.5;              // orang yang bergeser sejauh ini (x ukuran kotak) tetap dianggap orang yang sama
const MAKS_HILANG_DETIK = 3;           // ID dibuang bila tidak terlihat selama sekian detik
const FRAME_KONFIRMASI = 4;            // ID baru dihitung setelah terlihat minimal sekian kali
const RIWAYAT_KELAS = 7;               // kelas ditentukan dari suara terbanyak beberapa deteksi terakhir
const HALUS_POSISI = 0.7;              // 1 = ikut deteksi baru sepenuhnya, makin kecil makin halus
const REDAM_KECEPATAN = 0.3;           // 0 = kecepatan hanya dari gerakan terakhir, makin besar makin stabil

let sesiModel = null, sedangMuat = false, sedangProses = false;
let deteksiModel = [];
let kameraStream = null;
let urlUpload = null;
let terakhirSumber = daftarVideo[0].file;
let waktuSelesai = [], msTerakhir = 0, daftarMs = [];

let trek = [], idBerikut = 1;
let orangUnik = new Set(), pelanggarUnik = new Set();

// ---------- Riwayat pelanggaran ----------
const SIMPAN_FOTO = true;              // simpan foto kecil sebagai bukti tiap pelanggaran
const MAKS_RIWAYAT = 300;              // batas jumlah catatan di layar
let riwayat = [], nomorRiwayat = 0;
let namaUpload = '';

// ---------- Statistik sesi (untuk ringkasan) ----------
const targetminimal_WASPADA = 20;             // status WASPADA bila kepatuhan di bawah target minimal tetapi masih dalam selisih ini (poin %)
let sesiMulai = null, sesiAkhir = null, durasiMs = 0, tPutaranTerakhir = performance.now();
let fpsJumlah = 0, fpsHitung = 0, msJumlah = 0, msHitung = 0, confJumlah = 0, confHitung = 0;
let grafikBucket = null, kunciBucket = '';

const bufferCanvas = document.createElement('canvas');
const bufferCtx = bufferCanvas.getContext('2d', { willReadFrequently: true });

const modelAktif = () => {
  const cb = document.getElementById('pakaiModel');
  return !!cb && cb.checked;
};

function paksaModel(nyala) {                       // untuk kamera dan upload: model wajib aktif
  const cb = document.getElementById('pakaiModel');
  cb.checked = nyala ? true : cb.checked;
  cb.disabled = nyala;
}

// ---------- Pesan status dan error ----------
function setKoneksi(status, pesan) {
  const el = document.getElementById('koneksi');
  if (!el) return;
  el.textContent = pesan;
  el.style.color = status === true ? '#22c55e' : status === false ? '#ef4444' : '#94a3b8';
}

function tampilkanError(pesan) {
  const el = document.getElementById('pesanError');
  if (!el) return;
  el.textContent = pesan;
  el.classList.add('tampil');
}

function bersihkanError() {
  const el = document.getElementById('pesanError');
  if (el) el.classList.remove('tampil');
}

// ---------- Memuat model ONNX ----------
async function muatModel() {
  if (sesiModel || sedangMuat) return;
  sedangMuat = true;
  const m = modelSekarang();
  bufferCanvas.width = m.ukuran;
  bufferCanvas.height = m.ukuran;
  setKoneksi(null, 'Memuat ' + m.nama + '...');
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    sesiModel = await ort.InferenceSession.create(
      m.file + '?v=' + m.versi,
      { executionProviders: ['wasm'] }
    );
    setKoneksi(true, m.nama + ' siap (berjalan di perangkat ini)');
    bersihkanError();
  } catch (e) {
    console.error('Gagal memuat model:', e);
    setKoneksi(false, 'Model gagal dimuat');
    tampilkanError('Model "' + m.nama + '" gagal dimuat. Periksa file ' + m.file +
                   ' ada di folder dashboard dan sudah ter-push ke GitHub.');
  }
  sedangMuat = false;
}

// ---------- Pengolah keluaran model ----------
function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter + 1e-9);
}

function tumpangTindih(a, b) {                     // seberapa besar kotak kecil berada di dalam kotak lain
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (Math.min(a.w * a.h, b.w * b.h) + 1e-9);
}

function nms(kotak) {                              // 1 kepala = 1 kotak, apa pun kelasnya
  kotak.sort((a, b) => b.conf - a.conf);
  const hasil = [];
  for (const k of kotak) {
    const ganda = hasil.some(h => iou(h, k) >= BATAS_IOU || tumpangTindih(h, k) >= BATAS_TUMPANG);
    if (!ganda) hasil.push(k);
  }
  return hasil;
}

function saring(kotak) {
  return kotak.filter(k => k.cls && k.w <= MAKS_LEBAR_KOTAK);
}

const targetminimalDeteksi = () => Math.min(batasYakin, BATAS_RENDAH);

function bacaKeluaran(out, skala, padX, padY, vw, vh, namaKelas) {
  const d = out.data, dim = out.dims;
  const ke01 = (x1, y1, x2, y2) => ({
    x: (x1 - padX) / skala / vw,
    y: (y1 - padY) / skala / vh,
    w: (x2 - x1) / skala / vw,
    h: (y2 - y1) / skala / vh
  });
  const kotak = [];

  if (dim[2] === 6) {                              // format end-to-end: [1, jumlah, 6]
    for (let i = 0; i < dim[1]; i++) {
      const o = i * 6, skor = d[o + 4];
      if (skor < targetminimalDeteksi()) continue;
      kotak.push({ cls: namaKelas[Math.round(d[o + 5])], conf: skor, rendah: skor < batasYakin,
                   ...ke01(d[o], d[o + 1], d[o + 2], d[o + 3]) });
    }
    return saring(kotak);
  }

  const n = dim[2], nk = dim[1] - 4;               // format biasa: [1, 4+jumlahKelas, N]
  for (let i = 0; i < n; i++) {
    let terbaik = 0, skor = 0;
    for (let c = 0; c < nk; c++) {
      const s = d[(4 + c) * n + i];
      if (s > skor) { skor = s; terbaik = c; }
    }
    if (skor < targetminimalDeteksi()) continue;
    const cx = d[i], cy = d[n + i], w = d[2 * n + i], h = d[3 * n + i];
    kotak.push({ cls: namaKelas[terbaik], conf: skor, rendah: skor < batasYakin,
                 ...ke01(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) });
  }
  return saring(nms(kotak));
}

// ---------- Pelacakan: memberi ID pada tiap orang ----------
// Cara kerja ringkas (terinspirasi ByteTrack):
// 1. Tiap orang punya posisi dan KECEPATAN. Posisi diperkirakan maju sesuai waktu yang berlalu.
// 2. Tahap 1: deteksi yakin dipasangkan ke perkiraan posisi. Yang tidak cocok = orang baru.
// 3. Tahap 2: deteksi kurang yakin hanya boleh melanjutkan ID lama (tidak boleh membuat ID baru).
// 4. ID yang menghilang ditahan beberapa detik, sehingga orang yang tertutup sebentar tidak dihitung ganda.
function perkiraan(t, tSekarang) {
  const dt = Math.min((tSekarang - t.waktu) / 1000, 1.0);
  return { x: t.x + t.vx * dt, y: t.y + t.vy * dt, w: t.w, h: t.h };
}

function kecocokan(p, d) {                         // 0 = tidak cocok, makin besar makin cocok
  const v = iou(p, d);
  const jarak = Math.hypot((p.x + p.w / 2) - (d.x + d.w / 2), (p.y + p.h / 2) - (d.y + d.h / 2));
  const batas = JARAK_PASANG * Math.max(p.w, p.h, d.w, d.h);
  if (v < IOU_PASANG && jarak > batas) return 0;
  return v + (1 - Math.min(jarak / batas, 1)) * 0.5 + 0.01;
}

function perbaruiTrek(t, d, tSekarang) {
  const dt = Math.max((tSekarang - t.waktu) / 1000, 0.05);
  const batasV = 2;                                // batas kecepatan wajar (layar per detik)
  const vx = Math.max(-batasV, Math.min(batasV, (d.x - t.x) / dt));
  const vy = Math.max(-batasV, Math.min(batasV, (d.y - t.y) / dt));
  t.vx = REDAM_KECEPATAN * t.vx + (1 - REDAM_KECEPATAN) * vx;
  t.vy = REDAM_KECEPATAN * t.vy + (1 - REDAM_KECEPATAN) * vy;
  t.x = t.x * (1 - HALUS_POSISI) + d.x * HALUS_POSISI;
  t.y = t.y * (1 - HALUS_POSISI) + d.y * HALUS_POSISI;
  t.w = t.w * (1 - HALUS_POSISI) + d.w * HALUS_POSISI;
  t.h = t.h * (1 - HALUS_POSISI) + d.h * HALUS_POSISI;
  t.waktu = tSekarang;
  t.umur++;
  t.riwayat.push(d.cls);
  if (t.riwayat.length > RIWAYAT_KELAS) t.riwayat.shift();
  d.track = t;
}

function pasangkan(daftarTrek, dets, tPakai, dPakai, tSekarang) {
  const pasangan = [];
  for (const t of daftarTrek) {
    const p = perkiraan(t, tSekarang);
    for (const d of dets) {
      const v = kecocokan(p, d);
      if (v > 0) pasangan.push({ t, d, v });
    }
  }
  pasangan.sort((a, b) => b.v - a.v);
  for (const q of pasangan) {
    if (tPakai.has(q.t) || dPakai.has(q.d)) continue;
    tPakai.add(q.t);  dPakai.add(q.d);
    perbaruiTrek(q.t, q.d, tSekarang);
  }
}

function lacak(dets, tSekarang) {
  const yakin = dets.filter(d => !d.rendah);
  const ragu = dets.filter(d => d.rendah);
  const tPakai = new Set(), dPakai = new Set();

  pasangkan(trek, yakin, tPakai, dPakai, tSekarang);                       // tahap 1
  pasangkan(trek.filter(t => !tPakai.has(t)), ragu, tPakai, dPakai, tSekarang);   // tahap 2

  for (const d of yakin) {                         // deteksi yakin tanpa pasangan = orang baru
    if (dPakai.has(d)) continue;
    const t = { id: idBerikut++, x: d.x, y: d.y, w: d.w, h: d.h, vx: 0, vy: 0,
                waktu: tSekarang, umur: 1, riwayat: [d.cls] };
    trek.push(t);
    d.track = t;
  }
  trek = trek.filter(t => tSekarang - t.waktu <= MAKS_HILANG_DETIK * 1000);

  const hasil = [];
  for (const d of dets) {
    if (!d.track) continue;                        // deteksi ragu tanpa ID lama: diabaikan
    const t = d.track;
    const r = t.riwayat;
    const tanpa = r.filter(c => c === 'no_helmet').length;
    hasil.push({ cls: tanpa > r.length - tanpa ? 'no_helmet' : 'helmet',
                 conf: d.conf, id: t.id, pasti: t.umur >= FRAME_KONFIRMASI,
                 x: t.x, y: t.y, w: t.w, h: t.h });
  }
  return hasil;
}

// ---------- Hitung orang unik (setiap orang hanya sekali) ----------
function catatUnik(dets) {
  for (const d of dets) {
    if (!d.pasti) continue;
    orangUnik.add(d.id);
    if (d.cls === 'no_helmet' && !pelanggarUnik.has(d.id)) {
      pelanggarUnik.add(d.id);
      catatPelanggaran(d);                         // orang ini baru pertama kali tercatat melanggar
    }
  }
}

// ---------- Riwayat pelanggaran: pencatatan dan tampilan ----------
const dua = n => String(n).padStart(2, '0');
const formatJam = t => dua(t.getHours()) + ':' + dua(t.getMinutes()) + ':' + dua(t.getSeconds());
const formatTanggal = t => t.getFullYear() + '-' + dua(t.getMonth() + 1) + '-' + dua(t.getDate());
const formatMenit = detik => dua(Math.floor(detik / 60)) + ':' + dua(Math.floor(detik % 60));
const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function namaSumber() {
  if (kameraStream) return 'Kamera live';
  if (terakhirSumber === 'upload') return 'Upload: ' + (namaUpload || 'video');
  const sel = document.getElementById('pilihVideo');
  return sel && sel.selectedOptions[0] ? sel.selectedOptions[0].text : '-';
}

function ambilFoto(d) {                            // potongan kecil frame di sekitar orang tersebut
  try {
    const v = document.getElementById('video');
    const vw = v.videoWidth, vh = v.videoHeight;
    const cx = (d.x + d.w / 2) * vw, cy = (d.y + d.h / 2) * vh;
    const sisi = Math.min(Math.max(d.w * vw, d.h * vh) * 2.5, vw, vh);
    const sx = Math.max(0, Math.min(cx - sisi / 2, vw - sisi));
    const sy = Math.max(0, Math.min(cy - sisi / 2, vh - sisi));
    const c = document.createElement('canvas');
    c.width = 96;  c.height = 96;
    c.getContext('2d').drawImage(v, sx, sy, sisi, sisi, 0, 0, 96, 96);
    return c.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    return '';
  }
}

function catatPelanggaran(d) {
  const v = document.getElementById('video');
  const sekarang = new Date();
  riwayat.push({
    no: ++nomorRiwayat,
    id: d.id,
    tanggal: formatTanggal(sekarang),
    jam: formatJam(sekarang),
    posisi: formatMenit(v ? v.currentTime : 0),
    sumber: namaSumber(),
    model: modelAktif() ? modelSekarang().nama : 'Dummy (keyframe)',
    detikSesi: durasiMs / 1000,
    conf: d.conf,
    foto: SIMPAN_FOTO ? ambilFoto(d) : ''
  });
  if (riwayat.length > MAKS_RIWAYAT) riwayat.shift();
  gambarRiwayat();
  perbaruiRingkasan();
}

function gambarRiwayat() {
  const tb = document.getElementById('isiRiwayat');
  if (!tb) return;
  document.getElementById('kosongRiwayat').style.display = riwayat.length ? 'none' : 'block';
  document.getElementById('jumlahRiwayat').textContent = riwayat.length;
  tb.innerHTML = riwayat.slice().reverse().map(r => `
    <tr>
      <td>${r.no}</td>
      <td>${r.foto ? '<img src="' + r.foto + '" alt="Orang#' + r.id + '">' : '-'}</td>
      <td><span class="badge-orang">Orang#${r.id}</span></td>
      <td>${r.jam}</td>
      <td>${r.posisi}</td>
      <td>${esc(r.sumber)}</td>
      <td>${esc(r.model)}</td>
      <td>${r.conf.toFixed(2)}</td>
    </tr>`).join('');
}

function unduhCSV() {
  if (!riwayat.length) { tampilkanError('Belum ada pelanggaran yang bisa diunduh.'); return; }
  const kutip = x => '"' + String(x).replace(/"/g, '""') + '"';
  const kepala = ['No', 'Orang', 'Tanggal', 'Jam', 'Posisi video', 'Sumber', 'Model', 'Keyakinan'];
  const baris = riwayat.map(r => [r.no, 'Orang#' + r.id, r.tanggal, r.jam, r.posisi,
                                  r.sumber, r.model, r.conf.toFixed(2)].map(kutip).join(','));
  const isi = '\ufeff' + [kepala.map(kutip).join(','), ...baris].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([isi], { type: 'text/csv;charset=utf-8' }));
  a.download = 'riwayat_pelanggaran.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Ringkasan sesi ----------
const ZONA = () => (new Date().getTimezoneOffset() === -420 ? ' WIB' : '');
const tanggalPanjang = t => t.toLocaleDateString('id-ID',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const KELOMPOK_RINGKAS = [
  ['Tanggal dan Waktu', [['rkTanggal', 'Tanggal'], ['rkMulai', 'Mulai pemantauan'],
                         ['rkSelesai', 'Terakhir aktif'], ['rkDurasi', 'Durasi pemantauan']]],
  ['Orang dan Kepatuhan', [['rkTotal', 'Total orang terdeteksi'], ['rkPelanggar', 'Pelanggar (tanpa helm)'],
                           ['rkPatuh', 'Patuh (berhelm)'], ['rkKepatuhan', 'Kepatuhan per orang']]],
  ['Waktu Pelanggaran', [['rkPertama', 'Pelanggaran pertama'], ['rkTerakhir', 'Pelanggaran terakhir'],
                         ['rkTersibuk', 'Periode tersibuk']]],
  ['Kinerja Aplikasi', [['rkSumber', 'Sumber video'], ['rkModel', 'Model deteksi'], ['rkResolusi', 'Resolusi video'],
                        ['rkFps', 'Rata-rata FPS'], ['rkMs', 'Rata-rata latensi'],
                        ['rkConf', 'Rata-rata keyakinan'], ['rkJumlahDeteksi', 'Frame diproses']]]
];

function ringkasanHTML() {
  return KELOMPOK_RINGKAS.map(([judul, item]) => `
    <h3>${judul}</h3>
    <div class="grid-ringkas">${item.map(([id, label]) =>
      `<div class="mini"><div class="label">${label}</div><div class="nilai" id="${id}">-</div></div>`).join('')}</div>`
  ).join('');
}

function kelompokPelanggaran() {                   // pelanggar baru per 10 detik (sesi pendek) atau per menit
  const total = durasiMs / 1000;
  const lebar = total < 180 ? 10 : 60;
  const maksR = riwayat.reduce((m, r) => Math.max(m, r.detikSesi), 0);
  const jumlah = Math.max(1, Math.ceil(Math.max(total, maksR) / lebar));
  const isi = new Array(jumlah).fill(0);
  for (const r of riwayat) isi[Math.min(Math.floor(r.detikSesi / lebar), jumlah - 1)]++;
  const label = isi.map((_, i) => formatMenit(i * lebar));
  let puncak = '-', maks = 0;
  isi.forEach((n, i) => {
    if (n > maks) { maks = n; puncak = formatMenit(i * lebar) + '–' + formatMenit((i + 1) * lebar) + ' (' + n + ' pelanggar)'; }
  });
  return { lebar, isi, label, puncak };
}

function hitungRingkasan() {
  const total = orangUnik.size, pel = pelanggarUnik.size, patuh = total - pel;
  const targetminimal = (dataLive && dataLive.targetminimal_kepatuhan) || 80;
  const kep = total ? Math.round(patuh / total * 100) : null;
  let status = 'MENUNGGU DATA', warna = '#94a3b8';
  if (total) {
    if (kep >= targetminimal) { status = 'AMAN'; warna = '#22c55e'; }
    else if (kep >= targetminimal - TARGETMINIMAL_WASPADA) { status = 'WASPADA'; warna = '#f59e0b'; }
    else { status = 'BAHAYA'; warna = '#ef4444'; }
  }
  const v = document.getElementById('video');
  const kel = kelompokPelanggaran();
  const detail = r => r ? 'Orang#' + r.id + ' pada ' + formatMenit(r.detikSesi) + ' (jam ' + r.jam + ')' : '-';
  return {
    total, pel, patuh, targetminimal, kep, status, warna, kel,
    durasi: Math.floor(durasiMs / 1000),
    tanggal: sesiMulai ? tanggalPanjang(sesiMulai) : '-',
    mulai: sesiMulai ? formatJam(sesiMulai) + ZONA() : '-',
    selesai: sesiAkhir ? formatJam(sesiAkhir) + ZONA() : '-',
    pertama: detail(riwayat[0]), terakhir: detail(riwayat[riwayat.length - 1]),
    tersibuk: kel.puncak,
    sumber: namaSumber(),
    model: modelAktif() ? modelSekarang().nama + ' (input ' + modelSekarang().ukuran + ')' : 'Dummy (keyframe)',
    resolusi: v && v.videoWidth ? v.videoWidth + ' × ' + v.videoHeight : '-',
    fps: fpsHitung ? (fpsJumlah / fpsHitung).toFixed(1) + ' FPS' : '-',
    ms: msHitung ? Math.round(msJumlah / msHitung) + ' ms' : '-',
    conf: confHitung ? (confJumlah / confHitung).toFixed(2) : '-',
    jumlahDeteksi: msHitung ? msHitung + ' frame' : '-',
    daftarPelanggar: [...pelanggarUnik].slice(0, 6).map(i => 'Orang#' + i)
  };
}

function susunKalimat(r) {
  if (!r.total) return 'Belum ada orang terdeteksi. Putar video atau aktifkan kamera dengan model deteksi menyala, lalu ringkasan akan tersusun otomatis.';
  let k = 'Pada ' + r.tanggal + ' pukul ' + r.mulai + '–' + r.selesai + ' (durasi ' + formatMenit(r.durasi) + '), ';
  k += 'dashboard mendeteksi ' + r.total + ' orang dari sumber "' + r.sumber + '". ';
  if (r.pel) {
    k += r.pel + ' orang tidak memakai helm (' + r.daftarPelanggar.join(', ') + (r.pel > 6 ? ', dan lainnya' : '') + ') dan ' +
         r.patuh + ' orang patuh, sehingga kepatuhan per orang ' + r.kep + '% (targetminimal ' + r.targetminimal + '%). ';
    k += 'Pelanggaran pertama: ' + r.pertama + '. ';
  } else {
    k += 'Semua orang memakai helm (kepatuhan 100%), tidak ada pelanggaran tercatat. ';
  }
  return k + 'Status keseluruhan: ' + r.status + '.';
}

function teksLengkap(r) {
  return [
    'RINGKASAN SESI PEMANTAUAN APD (HELM)',
    'Tanggal               : ' + r.tanggal,
    'Mulai                 : ' + r.mulai,
    'Terakhir aktif        : ' + r.selesai,
    'Durasi pemantauan     : ' + formatMenit(r.durasi),
    'Total orang terdeteksi: ' + r.total,
    'Pelanggar             : ' + r.pel,
    'Patuh                 : ' + r.patuh,
    'Kepatuhan per orang   : ' + (r.kep === null ? '-' : r.kep + '% (targetminimal ' + r.targetminimal + '%)'),
    'Status                : ' + r.status,
    'Pelanggaran pertama   : ' + r.pertama,
    'Pelanggaran terakhir  : ' + r.terakhir,
    'Periode tersibuk      : ' + r.tersibuk,
    'Sumber video          : ' + r.sumber,
    'Model deteksi         : ' + r.model,
    'Resolusi video        : ' + r.resolusi,
    'Rata-rata FPS         : ' + r.fps,
    'Rata-rata latensi     : ' + r.ms,
    'Rata-rata keyakinan   : ' + r.conf,
    '',
    susunKalimat(r)
  ].join('\n');
}

function perbaruiRingkasan() {
  const st = document.getElementById('statusSesi');
  if (!st) return;
  const r = hitungRingkasan();
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  st.textContent = r.status;
  st.style.background = r.warna;
  set('kalimatRingkasan', susunKalimat(r));
  set('rkTanggal', r.tanggal);       set('rkMulai', r.mulai);
  set('rkSelesai', r.selesai);       set('rkDurasi', r.total || r.durasi ? formatMenit(r.durasi) : '-');
  set('rkTotal', r.total);           set('rkPelanggar', r.pel);
  set('rkPatuh', r.patuh);           set('rkKepatuhan', r.kep === null ? '-' : r.kep + '%');
  set('rkPertama', r.pertama);       set('rkTerakhir', r.terakhir);
  set('rkTersibuk', r.tersibuk);     set('rkSumber', r.sumber);
  set('rkModel', r.model);           set('rkResolusi', r.resolusi);
  set('rkFps', r.fps);               set('rkMs', r.ms);
  set('rkConf', r.conf);             set('rkJumlahDeteksi', r.jumlahDeteksi);
  if (grafikBucket) {
    const kunci = r.kel.lebar + '|' + r.kel.isi.join(',');
    if (kunci !== kunciBucket) {
      kunciBucket = kunci;
      grafikBucket.data.labels = r.kel.label;
      grafikBucket.data.datasets[0].data = r.kel.isi;
      grafikBucket.options.plugins.title.text =
        'Pelanggar baru per ' + (r.kel.lebar === 10 ? '10 detik' : 'menit') + ' (waktu sesi)';
      grafikBucket.update();
    }
  }
}
setInterval(perbaruiRingkasan, 1000);

function salinRingkasan() {
  const teks = teksLengkap(hitungRingkasan());
  const tombol = document.getElementById('btnSalin');
  const selesai = () => { tombol.textContent = 'Tersalin!'; setTimeout(() => { tombol.textContent = 'Salin ringkasan'; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(teks).then(selesai).catch(() => tampilkanError('Gagal menyalin. Salin manual dari kartu ringkasan.'));
  } else {
    tampilkanError('Browser tidak mendukung salin otomatis. Salin manual dari kartu ringkasan.');
  }
}

// ---------- Menjalankan model pada 1 frame ----------
async function jalankanModelLokal() {
  const v = document.getElementById('video');
  if (!modelAktif() || !v || !v.videoWidth || v.paused || sedangProses) return;
  if (!sesiModel) { await muatModel(); if (!sesiModel) return; }
  sedangProses = true;
  const mulai = performance.now();
  try {
    const m = modelSekarang(), S = m.ukuran;
    const skala = Math.min(S / v.videoWidth, S / v.videoHeight);
    const lebar = Math.round(v.videoWidth * skala), tinggi = Math.round(v.videoHeight * skala);
    const padX = Math.floor((S - lebar) / 2), padY = Math.floor((S - tinggi) / 2);

    bufferCtx.fillStyle = 'rgb(114,114,114)';
    bufferCtx.fillRect(0, 0, S, S);
    bufferCtx.drawImage(v, padX, padY, lebar, tinggi);
    const px = bufferCtx.getImageData(0, 0, S, S).data;

    const luas = S * S;
    const input = new Float32Array(3 * luas);
    for (let i = 0; i < luas; i++) {
      input[i] = px[i * 4] / 255;
      input[i + luas] = px[i * 4 + 1] / 255;
      input[i + 2 * luas] = px[i * 4 + 2] / 255;
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, S, S]);
    const hasil = await sesiModel.run({ [sesiModel.inputNames[0]]: tensor });
    const out = hasil[sesiModel.outputNames[0]];
    const mentah = bacaKeluaran(out, skala, padX, padY, v.videoWidth, v.videoHeight, m.kelas);
    deteksiModel = lacak(mentah, performance.now());
    for (const dd of deteksiModel) { confJumlah += dd.conf; confHitung++; }

    const sekarang = performance.now();
    msTerakhir = sekarang - mulai;
    msJumlah += msTerakhir;  msHitung++;
    daftarMs.push(msTerakhir);
    if (daftarMs.length > 10) daftarMs.shift();
    waktuSelesai.push(sekarang);
    if (waktuSelesai.length > 10) waktuSelesai.shift();
  } catch (e) {
    console.error('Deteksi gagal:', e);
    tampilkanError('Terjadi error saat mendeteksi. Buka Console (F12) untuk detailnya.');
  }
  sedangProses = false;
}

(async function loopModel() {
  await jalankanModelLokal();
  setTimeout(loopModel, 30);
})();

// ---------- Tampilan FPS ----------
setInterval(() => {
  const el = document.getElementById('fps');
  if (!el) return;
  const n = waktuSelesai.length;
  const baru = n > 0 && performance.now() - waktuSelesai[n - 1] < 2000;
  if (!modelAktif() || n < 2 || !baru) { el.textContent = 'FPS deteksi: -'; return; }
  const fps = (n - 1) / ((waktuSelesai[n - 1] - waktuSelesai[0]) / 1000);
  fpsJumlah += fps;  fpsHitung++;
  const rata = daftarMs.reduce((a, b) => a + b, 0) / daftarMs.length;
  el.textContent = 'FPS deteksi: ' + fps.toFixed(1) + ' · rata-rata ' + rata.toFixed(0) + ' ms';
}, 500);

// ---------- Kamera live ----------
function pesanErrorKamera(e) {
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser, lalu pilih Kamera Live lagi.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'Kamera tidak ditemukan di perangkat ini.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Kamera tidak bisa dibaca. Kemungkinan sedang dipakai aplikasi atau tab lain. Tutup yang lain lalu coba lagi.';
    case 'SecurityError':
      return 'Kamera diblokir oleh pengaturan keamanan browser. Buka halaman lewat https atau localhost.';
    default:
      return 'Kamera tidak bisa dibuka (' + (e && e.message ? e.message : 'penyebab tidak diketahui') + ').';
  }
}

async function mulaiKamera() {
  const v = document.getElementById('video');
  bersihkanError();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    tampilkanError('Browser ini tidak mendukung kamera, atau halaman tidak dibuka lewat https atau localhost.');
    document.getElementById('pilihVideo').value = terakhirSumber;
    return;
  }
  try {
    hentikanKamera();
    kameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },        // kamera belakang HP; di laptop otomatis webcam
      audio: false
    });
  } catch (e) {
    tampilkanError(pesanErrorKamera(e));
    document.getElementById('pilihVideo').value = terakhirSumber;
    return;
  }
  kameraStream.getVideoTracks()[0].addEventListener('ended', () => {
    tampilkanError('Kamera terputus. Pilih Kamera Live lagi untuk mencoba kembali.');
  });
  v.removeAttribute('src');
  v.srcObject = kameraStream;
  v.controls = false;
  v.loop = false;
  v.play();
  paksaModel(true);
  resetHitungan();
  muatModel();
}

function hentikanKamera() {
  if (kameraStream) {
    kameraStream.getTracks().forEach(t => t.stop());
    kameraStream = null;
  }
  const v = document.getElementById('video');
  if (v) { v.srcObject = null; v.controls = true; v.loop = true; }
}

// ---------- Upload video (cadangan) ----------
function pakaiVideoUpload(file) {
  bersihkanError();
  hentikanKamera();
  if (urlUpload) URL.revokeObjectURL(urlUpload);
  urlUpload = URL.createObjectURL(file);
  namaUpload = file.name;
  const v = document.getElementById('video');
  v.src = urlUpload;
  v.loop = true;
  v.play();
  paksaModel(true);
  resetHitungan();
  muatModel();
}

function resetHitungan() {
  detikTerakhir = -1;
  trek = [];  idBerikut = 1;
  orangUnik = new Set();  pelanggarUnik = new Set();
  deteksiModel = [];
  waktuSelesai = [];  daftarMs = [];
  riwayat = [];  nomorRiwayat = 0;  gambarRiwayat();
  sesiMulai = null;  sesiAkhir = null;  durasiMs = 0;
  fpsJumlah = 0;  fpsHitung = 0;  msJumlah = 0;  msHitung = 0;  confJumlah = 0;  confHitung = 0;
  kunciBucket = '';  perbaruiRingkasan();
  if (grafikTren) {
    grafikTren.data.labels = [];  grafikTren.data.datasets[0].data = [];  grafikTren.update();
    grafikDonat.data.datasets[0].data = [0, 0];  grafikDonat.update();
  }
}

// ---------- Sumber kotak: model ATAU dummy ----------
function ambilDeteksi(t) {
  if (modelAktif()) return deteksiModel;

  const hasil = [];
  for (const tr of dataLive.tracks) {
    const k = tr.keyframes, awal = k[0], akhir = k[k.length - 1];
    if (t < awal.t - 0.5 || t > akhir.t + 0.5) continue;
    let kotak = awal;
    if (t >= akhir.t) kotak = akhir;
    else if (t > awal.t) {
      for (let i = 0; i < k.length - 1; i++) {
        if (t >= k[i].t && t <= k[i + 1].t) {
          const u = (t - k[i].t) / (k[i + 1].t - k[i].t);
          const m = (a, b) => a + (b - a) * u;
          kotak = { cls: k[i].cls, x: m(k[i].x, k[i+1].x), y: m(k[i].y, k[i+1].y),
                    w: m(k[i].w, k[i+1].w), h: m(k[i].h, k[i+1].h) };
          break;
        }
      }
    }
    hasil.push({ ...kotak, conf: 0.85 + 0.1 * Math.abs(Math.sin(t + tr.id)), id: tr.id, pasti: true });
  }
  return hasil;
}

function gambarKotak(dets) {
  const v = document.getElementById('video');
  const c = document.getElementById('kanvas');
  const ctx = c.getContext('2d');
  c.width = v.clientWidth;  c.height = v.clientHeight;
  ctx.lineWidth = 3;  ctx.font = 'bold 14px Arial';
  for (const d of dets) {
    const warna = d.cls === 'helmet' ? '#22c55e' : '#ef4444';
    const x = d.x * c.width, y = d.y * c.height, w = d.w * c.width, h = d.h * c.height;
    ctx.strokeStyle = warna;  ctx.strokeRect(x, y, w, h);
    const teks = '#' + d.id + ' ' + d.cls + ' ' + d.conf.toFixed(2);
    ctx.fillStyle = warna;    ctx.fillRect(x, y - 20, ctx.measureText(teks).width + 8, 20);
    ctx.fillStyle = '#fff';   ctx.fillText(teks, x + 4, y - 5);
  }
}

function perbaruiAngka(dets) {
  const helm = dets.filter(d => d.cls === 'helmet').length;
  const no = dets.length - helm;
  const persen = dets.length ? Math.round(helm / dets.length * 100) : 0;
  const targetminimal = (dataLive && dataLive.targetminimal_kepatuhan) || 80;
  const aman = persen >= targetminimal;

  const v = document.getElementById('video');
  const detik = Math.floor(v.currentTime);
  if (detik < detikTerakhir) resetHitungan();      // video diulang atau diputar mundur

  catatUnik(dets);

  document.getElementById('nHelm').textContent = helm;
  document.getElementById('nNo').textContent = no;
  const p = document.getElementById('persen');
  p.textContent = persen + '%';  p.className = 'angka ' + (aman ? 'hijau' : 'merah');
  const bar = document.getElementById('bar');
  bar.style.width = persen + '%';  bar.style.background = aman ? '#22c55e' : '#ef4444';
  const st = document.getElementById('status');
  st.textContent = no > 0 ? 'PELANGGARAN: ' + no + ' pekerja tanpa helm' : 'Aman: semua pekerja memakai helm';
  st.className = 'angka ' + (no > 0 ? 'merah' : 'hijau');

  document.getElementById('nUnikPelanggar').textContent = pelanggarUnik.size;
  document.getElementById('nUnikTotal').textContent =
    'dari ' + orangUnik.size + ' orang yang terdeteksi (tiap orang dihitung sekali)';

  if (detik !== detikTerakhir) {
    detikTerakhir = detik;
    grafikTren.data.labels.push(detik);
    grafikTren.data.datasets[0].data.push(persen);
    grafikTren.update();
    grafikDonat.data.datasets[0].data = [orangUnik.size - pelanggarUnik.size, pelanggarUnik.size];
    grafikDonat.update();
  }
}

function putaran() {
  const v = document.getElementById('video');
  const tNow = performance.now();
  if (v && v.videoWidth && !v.paused) {            // hitung durasi pemantauan yang benar-benar berjalan
    if (!sesiMulai) sesiMulai = new Date();
    durasiMs += Math.min(tNow - tPutaranTerakhir, 250);
    sesiAkhir = new Date();
  }
  tPutaranTerakhir = tNow;
  if (v && v.videoWidth) {
    const dets = ambilDeteksi(v.currentTime);
    gambarKotak(dets);
    perbaruiAngka(dets);
  }
  requestAnimationFrame(putaran);
}

async function isiLive() {
  dataLive = await muatJSON(daftarVideo[0].file);

  document.getElementById('live').innerHTML = `
    <h2>Monitoring Live · deteksi APD (helm)</h2>
    <div id="pesanError" class="error-box"></div>

    <div class="panel-model">
      <select id="pilihVideo">
        ${daftarVideo.map(v => `<option value="${v.file}">${v.nama}</option>`).join('')}
        <option value="kamera">Kamera Live (HP / webcam)</option>
        <option value="upload">Upload video dari perangkat...</option>
      </select>
      <select id="pilihModel">
        ${daftarModel.map((m, i) => `<option value="${i}">${m.nama}</option>`).join('')}
      </select>
      <input type="file" id="fileVideo" accept="video/*" hidden>
    </div>

    <div class="panel-model">
      <label><input type="checkbox" id="pakaiModel"> Pakai model deteksi</label>
      <label>Confidence: <input type="range" id="slider" min="0.10" max="0.90" step="0.05" value="0.50">
        <b id="nilaiSlider">0.50</b></label>
      <span class="badge" id="fps">FPS deteksi: -</span>
      <span id="koneksi" style="color:#94a3b8">model belum dipakai</span>
    </div>

    <div class="panel-model">
      <button id="btnMulai">Mulai</button>
      <button id="btnJeda">Jeda</button>
      <button id="btnReset">Reset</button>
    </div>

    <div class="live-grid">
      <div class="vwrap">
        <video id="video" src="${dataLive.video}" controls muted loop playsinline></video>
        <canvas id="kanvas"></canvas>
      </div>
      <div class="kolom-kpi">
        <div class="kartu"><div class="label">Pelanggar (unik, tiap orang sekali)</div>
          <div class="angka merah" id="nUnikPelanggar">0</div>
          <div class="sub" id="nUnikTotal">dari 0 orang yang terdeteksi</div></div>
        <div class="kartu"><div class="label">Helmet (saat ini)</div><div class="angka hijau" id="nHelm">0</div></div>
        <div class="kartu"><div class="label">No Helmet (saat ini)</div><div class="angka merah" id="nNo">0</div></div>
        <div class="kartu"><div class="label">Kepatuhan (saat ini)</div><div class="angka" id="persen">0%</div>
          <div class="bar"><div id="bar"></div></div></div>
        <div class="kartu"><div class="label">Status</div><div class="angka" id="status" style="font-size:16px">Menunggu video...</div></div>
      </div>
    </div>
    <div class="kartu ringkasan">
      <div class="judul">
        <h2>Ringkasan Sesi</h2>
        <div class="aksi">
          <span id="statusSesi" class="status-besar">MENUNGGU DATA</span>
          <button id="btnSalin">Salin ringkasan</button>
        </div>
      </div>
      <p id="kalimatRingkasan" class="kalimat">Belum ada data.</p>
      ${ringkasanHTML()}
      <div class="chart-box kecil"><canvas id="cBucket"></canvas></div>
      <div class="sub">Jumlah orang dihitung dari ID pelacak. Bila orang tertutup atau bergerak cepat, satu orang bisa mendapat dua ID.
        Ringkasan ikut dikosongkan saat Reset, saat berganti sumber atau model, dan saat video mengulang.</div>
    </div>

    <div class="kartu riwayat">
      <div class="judul">
        <h2>Riwayat Pelanggaran (<span id="jumlahRiwayat">0</span> orang)</h2>
        <button id="btnCsv">Unduh CSV</button>
      </div>
      <div class="gulir">
        <table class="tabel-riwayat">
          <thead><tr><th>No</th><th>Foto</th><th>Orang</th><th>Jam</th><th>Posisi video</th><th>Sumber</th><th>Model</th><th>Yakin</th></tr></thead>
          <tbody id="isiRiwayat"></tbody>
        </table>
      </div>
      <div class="sub" id="kosongRiwayat">Belum ada pelanggaran tercatat. Setiap orang yang terdeteksi tanpa helm dicatat satu kali.</div>
    </div>

    <div class="dua-kolom">
      <div class="chart-box"><canvas id="cTren"></canvas></div>
      <div class="chart-box"><canvas id="cDonat"></canvas></div>
    </div>`;

  const teks = { ticks: { color: '#94a3b8' } };
  grafikTren = new Chart(document.getElementById('cTren'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Kepatuhan saat ini (%)', data: [], borderColor: '#38bdf8', tension: .3 }] },
    options: { maintainAspectRatio: false, animation: false,
      scales: { y: { min: 0, max: 100, ...teks }, x: { ...teks, title: { display: true, text: 'Detik', color: '#94a3b8' } } },
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Tren Kepatuhan', color: '#e2e8f0' } } }
  });
  grafikDonat = new Chart(document.getElementById('cDonat'), {
    type: 'doughnut',
    data: { labels: ['Patuh (orang)', 'Pelanggar (orang)'], datasets: [{ data: [0, 0], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Orang Unik: Patuh vs Pelanggar', color: '#e2e8f0' } } }
  });

  grafikBucket = new Chart(document.getElementById('cBucket'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Pelanggar baru', data: [], backgroundColor: '#ef4444' }] },
    options: { maintainAspectRatio: false, animation: false,
      scales: { y: { min: 0, ticks: { color: '#94a3b8', precision: 0 } }, x: { ticks: { color: '#94a3b8' } } },
      plugins: { legend: { display: false },
                 title: { display: true, text: 'Pelanggar baru per 10 detik (waktu sesi)', color: '#e2e8f0' } } }
  });

  const v = document.getElementById('video');
  v.addEventListener('error', () => {
    if (!v.srcObject) tampilkanError('Video tidak bisa diputar. Periksa file video di folder videos atau gunakan format mp4.');
  });

  // Slider confidence
  document.getElementById('slider').addEventListener('input', (e) => {
    batasYakin = parseFloat(e.target.value);
    document.getElementById('nilaiSlider').textContent = batasYakin.toFixed(2);
  });

  // Kotak centang model
  document.getElementById('pakaiModel').addEventListener('change', () => {
    resetHitungan();
    bersihkanError();
    if (modelAktif()) muatModel();
  });

  // Pilihan model (v2 / v1)
  document.getElementById('pilihModel').addEventListener('change', (e) => {
    indeksModel = parseInt(e.target.value, 10);
    sesiModel = null;
    resetHitungan();
    if (modelAktif()) muatModel();
  });

  // Menu sumber video
  const fileInput = document.getElementById('fileVideo');
  document.getElementById('pilihVideo').addEventListener('change', async (e) => {
    bersihkanError();
    if (e.target.value === 'kamera') { await mulaiKamera(); return; }
    if (e.target.value === 'upload') { fileInput.click(); return; }
    hentikanKamera();
    paksaModel(false);
    terakhirSumber = e.target.value;
    try {
      dataLive = await muatJSON(terakhirSumber);
    } catch (err) {
      tampilkanError('Data video tidak bisa dibaca: ' + terakhirSumber);
      return;
    }
    v.src = dataLive.video;
    v.play();
    resetHitungan();
  });

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) { terakhirSumber = 'upload'; pakaiVideoUpload(f); }
    fileInput.value = '';
  });
  fileInput.addEventListener('cancel', () => {
    document.getElementById('pilihVideo').value = terakhirSumber;
  });

  // Kontrol Mulai / Jeda / Reset
  document.getElementById('btnMulai').addEventListener('click', () => {
    bersihkanError();
    v.play().catch(() => {});
  });
  document.getElementById('btnJeda').addEventListener('click', () => v.pause());
  document.getElementById('btnReset').addEventListener('click', () => {
    resetHitungan();                               // hitungan, ID, dan grafik dikosongkan
    if (!v.srcObject) v.currentTime = 0;           // video file diputar dari awal
    bersihkanError();
  });

  document.getElementById('btnCsv').addEventListener('click', unduhCSV);
  document.getElementById('btnSalin').addEventListener('click', salinRingkasan);
  perbaruiRingkasan();

  putaran();
}
isiLive();