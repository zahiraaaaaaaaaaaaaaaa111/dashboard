// =====================================================
//  Dashboard Deteksi Helm / APD  -  app.js
//  Model best.onnx berjalan LANGSUNG di browser (tanpa backend)
//  Sumber video: file video ATAU kamera live (HP / webcam)
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
let detikTerakhir = -1, totalHelm = 0, totalNo = 0;

// Daftar video dummy. Tambah video baru = tambah satu baris di sini.
const daftarVideo = [
  { nama: 'Video 1 - dummy_01', file: 'data/detections_01.json' },
  { nama: 'Video 2 - dummy_02', file: 'data/detections_02.json' },
  { nama: 'Video 3 - dummy_03', file: 'data/detections_03.json' },
  { nama: 'Video 4 - dummy_04', file: 'data/detections_04.json' }
];

// ---------- PENGATURAN MODEL (ubah di sini saja) ----------
const FILE_MODEL = 'onnx/best.onnx';          // lokasi file model di folder dashboard
const VERSI_MODEL = 1;                        // NAIKKAN angka ini setiap mengganti file model
const UKURAN_MODEL = 416;                     // HARUS sama dengan imgsz saat export
const NAMA_KELAS = ['helmet', 'no_helmet'];   // urutan sama dengan model (0 = helmet, 1 = no_helmet)
const BATAS_YAKIN = 0.5;                      // deteksi di bawah 50% yakin diabaikan
const BATAS_IOU = 0.5;                        // untuk membuang kotak ganda
const MAKS_LEBAR_KOTAK = 1.0;                 // 1.0 = nonaktif. Isi 0.35 untuk mengabaikan kepala yang terlalu dekat

let sesiModel = null, sedangMuat = false, sedangProses = false;
let deteksiModel = [];
let kameraStream = null;
let terakhirFile = daftarVideo[0].file;

const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = UKURAN_MODEL;
bufferCanvas.height = UKURAN_MODEL;
const bufferCtx = bufferCanvas.getContext('2d', { willReadFrequently: true });

const modelAktif = () => {
  const cb = document.getElementById('pakaiModel');
  return !!cb && cb.checked;
};

function setKoneksi(status, pesan) {
  const el = document.getElementById('koneksi');
  if (!el) return;
  el.textContent = pesan;
  el.style.color = status === true ? '#22c55e' : status === false ? '#ef4444' : '#94a3b8';
}

// ---------- Memuat model ONNX ----------
async function muatModel() {
  if (sesiModel || sedangMuat) return;
  sedangMuat = true;
  setKoneksi(null, 'Memuat model...');
  try {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    sesiModel = await ort.InferenceSession.create(
      FILE_MODEL + '?v=' + VERSI_MODEL,
      { executionProviders: ['wasm'] }
    );
    setKoneksi(true, 'Model siap (berjalan di perangkat ini)');
  } catch (e) {
    console.error('Gagal memuat model:', e);
    setKoneksi(false, 'Gagal memuat model (lihat Console, tekan F12)');
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

function nms(kotak) {                              // buang kotak ganda pada objek yang sama
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

function bacaKeluaran(out, skala, padX, padY, vw, vh) {
  const d = out.data, dim = out.dims;              // dim = [1, a, b]
  const ke01 = (x1, y1, x2, y2) => ({              // dari piksel model ke pecahan 0-1 pada video asli
    x: (x1 - padX) / skala / vw,
    y: (y1 - padY) / skala / vh,
    w: (x2 - x1) / skala / vw,
    h: (y2 - y1) / skala / vh
  });
  const kotak = [];

  if (dim[2] === 6) {                              // format end-to-end: [1, jumlah, 6] = x1,y1,x2,y2,skor,kelas
    for (let i = 0; i < dim[1]; i++) {
      const o = i * 6, skor = d[o + 4];
      if (skor < BATAS_YAKIN) continue;
      kotak.push({ cls: NAMA_KELAS[Math.round(d[o + 5])], conf: skor,
                   ...ke01(d[o], d[o + 1], d[o + 2], d[o + 3]) });
    }
    return saring(kotak);
  }

  const n = dim[2], nk = dim[1] - 4;               // format biasa: [1, 4+jumlahKelas, N] = cx,cy,w,h,skor...
  for (let i = 0; i < n; i++) {
    let terbaik = 0, skor = 0;
    for (let c = 0; c < nk; c++) {
      const s = d[(4 + c) * n + i];
      if (s > skor) { skor = s; terbaik = c; }
    }
    if (skor < BATAS_YAKIN) continue;
    const cx = d[i], cy = d[n + i], w = d[2 * n + i], h = d[3 * n + i];
    kotak.push({ cls: NAMA_KELAS[terbaik], conf: skor,
                 ...ke01(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) });
  }
  return saring(nms(kotak));
}

// ---------- Menjalankan model pada 1 frame ----------
async function jalankanModelLokal() {
  const v = document.getElementById('video');
  if (!modelAktif() || !v || !v.videoWidth || v.paused || sedangProses) return;
  if (!sesiModel) { await muatModel(); if (!sesiModel) return; }
  sedangProses = true;
  try {
    const S = UKURAN_MODEL;
    const skala = Math.min(S / v.videoWidth, S / v.videoHeight);
    const lebar = Math.round(v.videoWidth * skala), tinggi = Math.round(v.videoHeight * skala);
    const padX = Math.floor((S - lebar) / 2), padY = Math.floor((S - tinggi) / 2);

    bufferCtx.fillStyle = 'rgb(114,114,114)';      // bingkai abu-abu agar rasio gambar terjaga
    bufferCtx.fillRect(0, 0, S, S);
    bufferCtx.drawImage(v, padX, padY, lebar, tinggi);
    const px = bufferCtx.getImageData(0, 0, S, S).data;

    const luas = S * S;
    const input = new Float32Array(3 * luas);      // susunan R..., G..., B...
    for (let i = 0; i < luas; i++) {
      input[i] = px[i * 4] / 255;
      input[i + luas] = px[i * 4 + 1] / 255;
      input[i + 2 * luas] = px[i * 4 + 2] / 255;
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, S, S]);
    const hasil = await sesiModel.run({ [sesiModel.inputNames[0]]: tensor });
    const out = hasil[sesiModel.outputNames[0]];
    deteksiModel = bacaKeluaran(out, skala, padX, padY, v.videoWidth, v.videoHeight);
  } catch (e) {
    console.error('Deteksi gagal:', e);
    setKoneksi(false, 'Error saat deteksi (lihat Console, tekan F12)');
  }
  sedangProses = false;
}

(async function loopModel() {
  await jalankanModelLokal();
  setTimeout(loopModel, 30);
})();

// ---------- Kamera live ----------
async function mulaiKamera() {
  const v = document.getElementById('video');
  try {
    kameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },        // kamera belakang HP; di laptop otomatis webcam
      audio: false
    });
  } catch (e) {
    alert('Kamera tidak bisa dibuka: ' + e.message +
          '\nPastikan izin kamera diberikan, dan halaman dibuka lewat https atau localhost.');
    document.getElementById('pilihVideo').value = terakhirFile;
    return;
  }
  v.removeAttribute('src');
  v.srcObject = kameraStream;
  v.controls = false;
  v.loop = false;
  v.play();
  const cb = document.getElementById('pakaiModel');
  cb.checked = true;                               // kamera live wajib memakai model
  cb.disabled = true;
  deteksiModel = [];
  resetHitungan();
  muatModel();
}

function hentikanKamera() {
  if (kameraStream) {
    kameraStream.getTracks().forEach(t => t.stop());
    kameraStream = null;
  }
  const v = document.getElementById('video');
  v.srcObject = null;
  v.controls = true;
  v.loop = true;
  document.getElementById('pakaiModel').disabled = false;
}

function resetHitungan() {
  detikTerakhir = -1;  totalHelm = 0;  totalNo = 0;
  grafikTren.data.labels = [];  grafikTren.data.datasets[0].data = [];  grafikTren.update();
  grafikDonat.data.datasets[0].data = [0, 0];  grafikDonat.update();
}

// ---------- Sumber kotak: model ATAU dummy ----------
function ambilDeteksi(t) {
  if (modelAktif()) return deteksiModel;           // dari model best.onnx

  const hasil = [];                                // dari keyframe dummy
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
    hasil.push({ ...kotak, conf: 0.85 + 0.1 * Math.abs(Math.sin(t + tr.id)) });
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
    const teks = d.cls + ' ' + d.conf.toFixed(2);
    ctx.fillStyle = warna;    ctx.fillRect(x, y - 20, ctx.measureText(teks).width + 8, 20);
    ctx.fillStyle = '#fff';   ctx.fillText(teks, x + 4, y - 5);
  }
}

function perbaruiAngka(dets) {
  const helm = dets.filter(d => d.cls === 'helmet').length;
  const no = dets.length - helm;
  const persen = dets.length ? Math.round(helm / dets.length * 100) : 0;
  const aman = persen >= dataLive.ambang_kepatuhan;

  document.getElementById('nHelm').textContent = helm;
  document.getElementById('nNo').textContent = no;
  const p = document.getElementById('persen');
  p.textContent = persen + '%';  p.className = 'angka ' + (aman ? 'hijau' : 'merah');
  const bar = document.getElementById('bar');
  bar.style.width = persen + '%';  bar.style.background = aman ? '#22c55e' : '#ef4444';
  const st = document.getElementById('status');
  st.textContent = no > 0 ? 'PELANGGARAN: ' + no + ' pekerja tanpa helm' : 'Aman: semua pekerja memakai helm';
  st.className = 'angka ' + (no > 0 ? 'merah' : 'hijau');

  const v = document.getElementById('video');
  const detik = Math.floor(v.currentTime);
  if (detik < detikTerakhir) {
    grafikTren.data.labels = [];  grafikTren.data.datasets[0].data = [];
    totalHelm = 0;  totalNo = 0;
  }
  if (detik !== detikTerakhir) {
    detikTerakhir = detik;  totalHelm += helm;  totalNo += no;
    grafikTren.data.labels.push(detik);
    grafikTren.data.datasets[0].data.push(persen);
    grafikTren.update();
    grafikDonat.data.datasets[0].data = [totalHelm, totalNo];
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
    <h2>Monitoring Live · sumber kotak: dummy atau model</h2>
    <select id="pilihVideo">
      ${daftarVideo.map(v => `<option value="${v.file}">${v.nama}</option>`).join('')}
      <option value="kamera">Kamera Live (HP / webcam)</option>
    </select>
    <div class="panel-model">
      <label><input type="checkbox" id="pakaiModel"> Pakai model deteksi (best.onnx)</label>
      <span id="koneksi" style="color:#94a3b8">belum dipakai</span>
    </div>
    <div class="live-grid">
      <div class="vwrap">
        <video id="video" src="${dataLive.video}" controls muted loop playsinline></video>
        <canvas id="kanvas"></canvas>
      </div>
      <div class="kolom-kpi">
        <div class="kartu"><div class="label">Helmet (pakai helm)</div><div class="angka hijau" id="nHelm">0</div></div>
        <div class="kartu"><div class="label">No Helmet (tanpa helm)</div><div class="angka merah" id="nNo">0</div></div>
        <div class="kartu"><div class="label">Persentase kepatuhan</div><div class="angka" id="persen">0%</div>
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
    data: { labels: [], datasets: [{ label: 'Kepatuhan (%)', data: [], borderColor: '#38bdf8', tension: .3 }] },
    options: { maintainAspectRatio: false, animation: false,
      scales: { y: { min: 0, max: 100, ...teks }, x: { ...teks, title: { display: true, text: 'Detik', color: '#94a3b8' } } },
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Tren Kepatuhan', color: '#e2e8f0' } } }
  });
  grafikDonat = new Chart(document.getElementById('cDonat'), {
    type: 'doughnut',
    data: { labels: ['helmet', 'no_helmet'], datasets: [{ data: [0, 0], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Total Deteksi', color: '#e2e8f0' } } }
  });

  // Saat kotak centang model diubah
  document.getElementById('pakaiModel').addEventListener('change', () => {
    deteksiModel = [];
    resetHitungan();
    if (modelAktif()) muatModel();
  });

  // Saat menu sumber diganti
  document.getElementById('pilihVideo').addEventListener('change', async (e) => {
    if (e.target.value === 'kamera') { await mulaiKamera(); return; }
    hentikanKamera();
    terakhirFile = e.target.value;
    dataLive = await muatJSON(terakhirFile);
    const v = document.getElementById('video');
    v.src = dataLive.video;
    v.play();
    resetHitungan();
  });

  putaran();
}
isiLive();