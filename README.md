# Dashboard Deteksi Helm / APD

## Bagian 1: Cara menjalankan secara lokal

Dashboard harus dibuka lewat **server lokal**, bukan dengan klik dua kali pada `index.html`.
Alasannya: browser memblokir pemuatan file model dan data bila halaman dibuka langsung dari folder.

### Yang dibutuhkan

- Browser terbaru (Google Chrome atau Microsoft Edge)
- Koneksi internet saat pertama kali membuka (Chart.js dan ONNX Runtime Web dimuat dari CDN)
- Visual Studio Code dengan ekstensi Live Server (disarankan), atau Python 3

### Langkah 1: Ambil kode dari GitHub

Pilih salah satu cara.

**Cara A, unduh ZIP (paling mudah)**
1. Buka https://github.com/zahiraaaaaaaaaaaaaaaa111/dashboard
2. Klik tombol hijau **Code**, lalu **Download ZIP**.
3. Ekstrak file ZIP. Hasilnya folder `dashboard` atau `dashboard-main`.

**Cara B, clone dengan Git**
```
git clone https://github.com/zahiraaaaaaaaaaaaaaaa111/dashboard.git
```

### Langkah 2: Jalankan server lokal

**Opsi 1, Visual Studio Code + Live Server (disarankan)**
1. Buka VS Code, pilih **File, Open Folder**, lalu pilih folder `dashboard` dari langkah 1.
2. Pilih **Yes, I trust the authors** bila ditanya.
3. Buka menu **Extensions** (`Ctrl+Shift+X`), cari **Live Server** (pembuat Ritwick Dey), lalu klik **Install**.
4. Klik kanan `index.html` di panel Explorer, lalu pilih **Open with Live Server**.
5. Browser terbuka otomatis di `http://127.0.0.1:5500`.

**Opsi 2, Python (tanpa VS Code)**
1. Buka terminal di dalam folder `dashboard`.
2. Jalankan:
   ```
   python -m http.server 5500
   ```
   (di Windows bisa juga `py -m http.server 5500`)
3. Buka `http://localhost:5500` di browser.
4. Hentikan server dengan `Ctrl+C`.

### Langkah 3: Coba dashboard

1. Di menu **Monitoring**, pilih model **v3** atau **v2**, lalu pilih sumber video: video dari daftar, **Kamera Live** (izinkan akses kamera), atau **Upload video dari perangkat**.
2. Tunggu tulisan hijau seperti "Model v3 siap".
3. Klik **Mulai** (atau tombol play pada video).
4. Orang tanpa helm yang terdeteksi tercatat di menu **Riwayat Data** dan **Laporan**.

### Jika ada masalah

| Gejala | Solusi |
|---|---|
| Halaman kosong atau model tidak termuat | Halaman dibuka dengan klik dua kali. Buka lewat Live Server atau `python -m http.server`. |
| Kamera tidak terbuka | Izinkan akses kamera di browser. Kamera hanya bekerja di `localhost` atau `https`. |
| "Model ... gagal dimuat" | Pastikan folder `onnx` ikut terunduh dan ada koneksi internet saat pertama dibuka. |

---

## Bagian 2: Pasang, uji, dan kirim ke Netlify

Urutannya: pindahkan file ke folder `dashboard`, uji di Live Server, kirim ke GitHub, lalu hubungkan GitHub ke Netlify.

### Langkah 1: Pindahkan file ke folder dashboard

Buka folder `dashboard` di VS Code, lalu:

1. **`app.js`**: buka file `app.js`, tekan `Ctrl+A`, lalu `Delete`. Tempel isi `app.js` versi baru, lalu simpan dengan `Ctrl+S`.
2. **Folder `onnx`**: salin file model v3 ke dalam folder `onnx`, di samping file model v2.
3. **`daftarVideo`**: buka `app.js`, cari `daftarVideo`, lalu isi dengan video barumu. Letakkan file videonya di folder video proyek, dan pastikan nama file di daftar sama persis dengan nama file aslinya. Kalau dibiarkan kosong, menu video hanya menampilkan "Pilih sumber video...", dan dashboard tetap bisa dipakai lewat Kamera Live dan Upload video.

### Langkah 2: Uji di Live Server

1. Klik kanan `index.html`, lalu pilih **Open with Live Server**.
2. Pilih sumber video, lalu coba tiap model: **v2** dan **v3**.
3. Pastikan kotak deteksi muncul di video dan tulisan hijau "Model ... siap" tampil untuk tiap model.
4. Jangan lanjut ke langkah berikutnya sebelum kedua model berjalan.

### Langkah 3: Kirim ke GitHub

Ganti `zahiraaaaaaaaaaaaaaaa111` dengan username GitHub-mu.

1. Buka terminal di VS Code (menu **Terminal, New Terminal**), pastikan posisinya di folder `dashboard`.
2. Jalankan:
   ```
   git add .
   git commit -m "Update ke model v3"
   git push
   ```
3. Jika folder belum terhubung ke repository, jalankan ini dulu:
   ```
   git init
   git branch -M main
   git remote add origin https://github.com/zahiraaaaaaaaaaaaaaaa111/dashboard.git
   git push -u origin main
   ```
4. Buka `https://github.com/zahiraaaaaaaaaaaaaaaa111/dashboard` dan pastikan `app.js`, folder `onnx`, dan video sudah ada di sana.

> Catatan: GitHub menolak file di atas 100 MB. Jika ada model atau video yang lebih besar, kecilkan dulu atau pakai Git LFS.

### Langkah 4: Hubungkan GitHub ke Netlify

1. Buka https://app.netlify.com lalu masuk dengan akun Netlify-mu (disarankan **Log in with GitHub**).
2. Klik **Add new site**, lalu **Import an existing project**.
3. Pilih **Deploy with GitHub**, lalu izinkan Netlify mengakses akunmu bila diminta.
4. Pilih repository **dashboard**.
5. Isi pengaturan build:
   - **Branch to deploy**: `main`
   - **Build command**: kosongkan
   - **Publish directory**: kosongkan atau isi `.` (titik)
6. Klik **Deploy**. Tunggu sampai statusnya **Published** (biasanya kurang dari 1 menit).
7. Klik alamat situs yang muncul (bentuknya `https://nama-acak.netlify.app`). Nama ini bisa diganti di **Site configuration, Change site name**.

**Cara alternatif tanpa GitHub (drag and drop)**
1. Buka https://app.netlify.com/drop
2. Tarik folder `dashboard` ke halaman tersebut.
3. Tunggu sampai selesai, lalu buka alamat situsnya.

### Langkah 5: Uji situs yang sudah online

1. Buka alamat Netlify di browser.
2. Pilih sumber video dan tunggu tulisan hijau "Model v3 siap".
3. Klik **Mulai** dan pastikan kotak deteksi muncul.
4. Coba **Kamera Live**. Di Netlify kamera bisa dipakai karena alamatnya sudah `https`.

### Cara memperbarui situs di kemudian hari

Setiap kali ada perubahan, cukup ulangi Langkah 3 (`git add .`, `git commit`, `git push`). Netlify otomatis memasang versi terbaru dalam beberapa saat. Jika perubahan belum tampil, tekan `Ctrl+F5` di browser.

### Jika ada masalah di Netlify

| Gejala | Solusi |
|---|---|
| Halaman 404 | Pastikan `index.html` berada di folder paling luar repository, bukan di dalam subfolder. Lalu kosongkan **Publish directory**. |
| Model gagal dimuat | Pastikan folder `onnx` ikut ter-push ke GitHub dan nama file model sama persis (huruf besar/kecil berpengaruh). |
| Video tidak muncul | Pastikan file video ada di GitHub dan namanya sama dengan yang tertulis di `daftarVideo`. |
| Tampilan masih versi lama | Tekan `Ctrl+F5`, atau cek tab **Deploys** di Netlify sampai statusnya **Published**. |