// =====================================================
//  Dashboard Deteksi Helm / APD  -  app.js
//  Model ONNX berjalan di browser. Fitur:
//  - Webcam / kamera HP real-time + FPS + slider confidence
//  - Penanganan error kamera dan model
//  - Hitung pelanggar SEKALI per orang (tracking ID)
//  - Upload video sebagai cadangan
//  - Pilihan model v1 / v2 (menu di atas video)
// =====================================================

// ---------- Tab (navigasi) ----------
const tombol = document.querySelectorAll('nav button');
const tab = document.querySelectorAll('.tab');

function bukaTab(nama) {
  tab.forEach(t => t.classList.toggle('active', t.id === nama));
  tombol.forEach(b => b.classList.toggle('active', b.dataset.tab === nama));
}
tombol.forEach(b => b.addEventListener('click', () => bukaTab(b.dataset.tab)));
bukaTab('live');

// ---------- Membaca file JSON ----------
async function muatJSON(path) {
  const respon = await fetch(path);
  return await respon.json();
}

function kartu(label, angka, warna = '') {
  return `<div class="kartu">
            <div class="label">${label}</div>
            <div class="angka ${warna}">${angka}</div>
          </div>`;
}

// ---------- Tab Dataset ----------
async function isiDataset() {
  const d = await muatJSON('data/dataset.json');
  document.getElementById('dataset').innerHTML = `
    <h2>Ringkasan Dataset (dari Dataset Engineer)</h2>
    <div class="kartu-grid">
      ${kartu('Total gambar', d.total_gambar)}
      ${kartu('Data train', d.pembagian.train)}
      ${kartu('Data val', d.pembagian.val)}
      ${kartu('Data test', d.pembagian.test)}
      ${kartu('Label helmet', d.label_per_kelas.helmet, 'hijau')}
      ${kartu('Label no_helmet', d.label_per_kelas.no_helmet, 'merah')}
    </div>
    <p style="color:#94a3b8;font-size:13px">Sumber: ${d.sumber} · Diperbarui: ${d.diperbarui}</p>`;
}
isiDataset();

// ---------- Tab Performa Model ----------
async function isiModel() {
  const m = await muatJSON('data/metrics.json');
  const persen = x => (x * 100).toFixed(1) + '%';
  const lab = m.confusion_matrix.labels;
  const v = m.confusion_matrix.nilai;

  document.getElementById('model').innerHTML = `
    <h2>Performa Model (dari Data Scientist) · ${m.model}</h2>
    <div class="kartu-grid">
      ${kartu('Precision', persen(m.precision))}
      ${kartu('Recall', persen(m.recall))}
      ${kartu('mAP@50', persen(m.map50), 'hijau')}
    </div>
    <div class="dua-kolom">
      <div class="chart-box"><canvas id="grafikKelas"></canvas></div>
      <div class="chart-box">
        <h2>Confusion Matrix</h2>
        <table class="cm">
          <tr><th></th><th>Prediksi: ${lab[0]}</th><th>Prediksi: ${lab[1]}</th></tr>
          <tr><th>Asli: ${lab[0]}</th><td class="benar">${v[0][0]}</td><td class="salah">${v[0][1]}</td></tr>
          <tr><th>Asli: ${lab[1]}</th><td class="salah">${v[1][0]}</td><td class="benar">${v[1][1]}</td></tr>
        </table>
      </div>
    </div>`;

  const kelas = Object.keys(m.per_kelas);
  const nilai = Object.values(m.per_kelas);
  new Chart(document.getElementById('grafikKelas'), {
    type: 'bar',
    data: {
      labels: kelas,
      datasets: [
        { label: 'Precision', data: nilai.map(k => k.precision * 100), backgroundColor: '#38bdf8' },
        { label: 'Recall',    data: nilai.map(k => k.recall * 100),    backgroundColor: '#22c55e' }
      ]
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 100, ticks: { color: '#94a3b8' } },
        x: { ticks: { color: '#94a3b8' } }
      },
      plugins: {
        legend: { labels: { color: '#e2e8f0' } },
        title: { display: true, text: 'Precision dan Recall per Kelas (%)', color: '#e2e8f0' }
      }
    }
  });
}
isiModel();

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

// ---------- DAFTAR MODEL (v1 dan v2) ----------
// Model baru: taruh file .onnx di folder onnx, lalu tambah satu baris di daftar ini.
// - ukuran : harus sama dengan imgsz saat export (yolo export ... imgsz=416)
// - kelas  : urutan harus sama dengan model.names (0 = helmet, 1 = no_helmet)
// - versi  : NAIKKAN angkanya bila isi file diganti dengan nama yang sama (supaya cache HP diperbarui)
const daftarModel = [
  { nama: 'Model v1', file: 'onnx/best.onnx',    versi: 1, ukuran: 416, kelas: ['helmet', 'no_helmet'] },
  { nama: 'Model v2', file: 'onnx/best_v2.onnx', versi: 1, ukuran: 416, kelas: ['helmet', 'no_helmet'] }
];
let indeksModel = 0;
const modelSekarang = () => daftarModel[indeksModel];

// ---------- Pengaturan deteksi ----------
let batasYakin = 0.5;                  // diatur lewat slider
const BATAS_IOU = 0.5;                 // membuang kotak ganda
const MAKS_LEBAR_KOTAK = 1.0;          // 1.0 = nonaktif. Isi 0.35 untuk mengabaikan kepala yang terlalu dekat

// ---------- Pengaturan pelacakan (tracking) ----------
const IOU_PASANG = 0.2;                // kemiripan minimum agar kotak dianggap orang yang sama
const MAKS_HILANG = 8;                 // jumlah deteksi tanpa terlihat sebelum ID dibuang
const FRAME_KONFIRMASI = 3;            // ID baru dihitung setelah terlihat minimal sekian kali
const RIWAYAT_KELAS = 7;               // kelas ditentukan dari suara terbanyak beberapa deteksi terakhir

let sesiModel = null, sedangMuat = false, sedangProses = false;
let deteksiModel = [];
let kameraStream = null;
let urlUpload = null;
let terakhirSumber = daftarVideo[0].file;
let waktuSelesai = [], msTerakhir = 0, daftarMs = [];

let trek = [], idBerikut = 1;
let orangUnik = new Set(), pelanggarUnik = new Set();

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

function nms(kotak) {
  kotak.sort((a, b) => b.conf - a.conf);
  const hasil = [];
  for (const k of kotak) {
    if (hasil.every(h => h.cls !== k.cls || iou(h, k) < BATAS_IOU)) hasil.push(k);
  }
  return hasil;
}

function saring(kotak) {
  return kotak.filter(k => k.cls && k.w <= MAKS_LEBAR_KOTAK);
}

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
      if (skor < batasYakin) continue;
      kotak.push({ cls: namaKelas[Math.round(d[o + 5])], conf: skor,
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
    if (skor < batasYakin) continue;
    const cx = d[i], cy = d[n + i], w = d[2 * n + i], h = d[3 * n + i];
    kotak.push({ cls: namaKelas[terbaik], conf: skor,
                 ...ke01(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) });
  }
  return saring(nms(kotak));
}

// ---------- Pelacakan: memberi ID pada tiap orang ----------
function lacak(dets) {
  const pasangan = [];
  for (const t of trek) for (const d of dets) {
    const v = iou(t, d);
    if (v >= IOU_PASANG) pasangan.push({ t, d, v });
  }
  pasangan.sort((a, b) => b.v - a.v);
  const tPakai = new Set(), dPakai = new Set();

  for (const p of pasangan) {                      // pasangkan deteksi ke ID lama (kemiripan tertinggi dulu)
    if (tPakai.has(p.t) || dPakai.has(p.d)) continue;
    tPakai.add(p.t);  dPakai.add(p.d);
    Object.assign(p.t, { x: p.d.x, y: p.d.y, w: p.d.w, h: p.d.h, hilang: 0 });
    p.t.umur++;
    p.t.riwayat.push(p.d.cls);
    if (p.t.riwayat.length > RIWAYAT_KELAS) p.t.riwayat.shift();
    p.d.track = p.t;
  }
  for (const t of trek) if (!tPakai.has(t)) t.hilang++;

  for (const d of dets) {                          // deteksi tanpa pasangan = orang baru
    if (dPakai.has(d)) continue;
    const t = { id: idBerikut++, x: d.x, y: d.y, w: d.w, h: d.h, umur: 1, hilang: 0, riwayat: [d.cls] };
    trek.push(t);
    d.track = t;
  }
  trek = trek.filter(t => t.hilang <= MAKS_HILANG);

  for (const d of dets) {                          // kelas stabil = suara terbanyak
    const r = d.track.riwayat;
    const tanpa = r.filter(c => c === 'no_helmet').length;
    d.cls = tanpa > r.length - tanpa ? 'no_helmet' : 'helmet';
    d.id = d.track.id;
    d.pasti = d.track.umur >= FRAME_KONFIRMASI;
    delete d.track;
  }
  return dets;
}

// ---------- Hitung orang unik (setiap orang hanya sekali) ----------
function catatUnik(dets) {
  for (const d of dets) {
    if (!d.pasti) continue;
    orangUnik.add(d.id);
    if (d.cls === 'no_helmet') pelanggarUnik.add(d.id);
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
    deteksiModel = lacak(mentah);

    const sekarang = performance.now();
    msTerakhir = sekarang - mulai;
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
  const ambang = (dataLive && dataLive.ambang_kepatuhan) || 80;
  const aman = persen >= ambang;

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

  // Pilihan model v1 / v2
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

  putaran();
}
isiLive();