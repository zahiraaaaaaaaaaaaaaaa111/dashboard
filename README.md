# Dashboard Deteksi Helm / APD

## Cara menjalankan secara lokal

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

1. Di menu **Monitoring**, pilih sumber video: video dari daftar, **Kamera Live** (izinkan akses kamera), atau **Upload video dari perangkat**.
2. Tunggu tulisan hijau seperti "Model v2 siap".
3. Klik **Mulai** (atau tombol play pada video).
4. Orang tanpa helm yang terdeteksi tercatat di menu **Riwayat Data** dan **Laporan**.

### Jika ada masalah

| Gejala | Solusi |
|---|---|
| Halaman kosong atau model tidak termuat | Halaman dibuka dengan klik dua kali. Buka lewat Live Server atau `python -m http.server`. |
| Kamera tidak terbuka | Izinkan akses kamera di browser. Kamera hanya bekerja di `localhost` atau `https`. |
| "Model ... gagal dimuat" | Pastikan folder `onnx` ikut terunduh dan ada koneksi internet saat pertama dibuka. |