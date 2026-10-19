// =====================================================
//  Dashboard Deteksi Helm / APD  -  app.js (versi final dummy)
// =====================================================

// ---------- Tab (navigasi) ----------
const tombol = document.querySelectorAll('nav button');
const tab = document.querySelectorAll('.tab');

function bukaTab(nama) {
  tab.forEach(t => t.classList.toggle('active', t.id === nama));
  tombol.forEach(b => b.classList.toggle('active', b.dataset.tab === nama));
}

tombol.forEach(b => {
  b.addEventListener('click', () => bukaTab(b.dataset.tab));
});

bukaTab('live');   // tab awal

// ---------- Membaca file JSON ----------
async function muatJSON(path) {
  const respon = await fetch(path);   // minta file
  return await respon.json();         // ubah teks jadi objek JavaScript
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

// ---------- Tab Monitoring Live ----------
let dataLive, grafikTren, grafikDonat;
let detikTerakhir = -1, totalHelm = 0, totalNo = 0;

// Daftar video / kamera. Tambah video baru = tambah satu baris di sini.
const daftarVideo = [
  { nama: 'Video 1 - dummy_01', file: 'data/detections_01.json' },
  { nama: 'Video 2 - dummy_02', file: 'data/detections_02.json' },
  { nama: 'Video 3 - dummy_03', file: 'data/detections_03.json' },
  { nama: 'Video 4 - dummy_04', file: 'data/detections_04.json' }
];

// Satu-satunya fungsi yang nanti diganti saat model asli siap
function ambilDeteksi(t) {
  const hasil = [];
  for (const tr of dataLive.tracks) {
    const k = tr.keyframes, awal = k[0], akhir = k[k.length - 1];
    if (t < awal.t - 0.5 || t > akhir.t + 0.5) continue;   // di luar rentang: tidak tampil
    let kotak = awal;
    if (t >= akhir.t) kotak = akhir;
    else if (t > awal.t) {
      for (let i = 0; i < k.length - 1; i++) {
        if (t >= k[i].t && t <= k[i + 1].t) {
          const u = (t - k[i].t) / (k[i + 1].t - k[i].t);   // 0 sampai 1
          const m = (a, b) => a + (b - a) * u;              // titik di antara a dan b
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

  // grafik diperbarui sekali per detik video
  const v = document.getElementById('video');
  const detik = Math.floor(v.currentTime);
  if (detik < detikTerakhir) {                       // video diulang atau diputar mundur
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
  dataLive = await muatJSON(daftarVideo[0].file);   // video pertama sebagai awalan
  document.getElementById('live').innerHTML = `
    <h2>Monitoring Live (dari AI Engineer) · mode dummy</h2>
    <select id="pilihVideo">
      ${daftarVideo.map(v => `<option value="${v.file}">${v.nama}</option>`).join('')}
    </select>
    <div class="live-grid">
      <div class="vwrap">
        <video id="video" src="${dataLive.video}" controls muted loop></video>
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
      scales: { y: { min: 0, max: 100, ...teks }, x: { ...teks, title: { display: true, text: 'Detik video', color: '#94a3b8' } } },
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Tren Kepatuhan', color: '#e2e8f0' } } }
  });
  grafikDonat = new Chart(document.getElementById('cDonat'), {
    type: 'doughnut',
    data: { labels: ['helmet', 'no_helmet'], datasets: [{ data: [0, 0], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e2e8f0' } }, title: { display: true, text: 'Total Deteksi', color: '#e2e8f0' } } }
  });

  // Saat menu pilihan video diganti
  document.getElementById('pilihVideo').addEventListener('change', async (e) => {
    dataLive = await muatJSON(e.target.value);        // baca JSON video yang dipilih
    const v = document.getElementById('video');
    v.src = dataLive.video;                           // ganti videonya
    v.play();
    detikTerakhir = -1;  totalHelm = 0;  totalNo = 0; // reset hitungan
    grafikTren.data.labels = [];  grafikTren.data.datasets[0].data = [];  grafikTren.update();
    grafikDonat.data.datasets[0].data = [0, 0];  grafikDonat.update();
  });

  putaran();
}
isiLive();