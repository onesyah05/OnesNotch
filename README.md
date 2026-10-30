# OnesNotch

<p align="center">
  <img src="docs/screenshots/notch-idle.png" alt="OnesNotch — Notch dalam keadaan idle" width="640" />
</p>

**OnesNotch** adalah aplikasi overlay bergaya *Dynamic Island* untuk Windows. Sebuah pil hitam ramping muncul di bagian tengah atas layar dan mengembang saat di-hover, diklik, atau saat ada notifikasi masuk — memberikan akses cepat ke berbagai fitur tanpa mengganggu aktivitas Anda.

Secara bawaan, OnesNotch **tidak terlihat saat layar Anda dibagikan, direkam, atau di-screenshot**, sehingga privasi Anda tetap terjaga saat presentasi atau berbagi layar.

---

## Fitur

### 🤖 Asisten AI
- **Jawaban langsung di layar:** tangkap layar secara diam-diam, kirim ke model vision (Anthropic, OpenAI, Gemini, Ollama, atau endpoint apa pun yang kompatibel dengan OpenAI), dan tampilkan jawabannya langsung di dalam notch.
- **Mode deteksi otomatis:** pilih apakah AI harus aktif secara otomatis saat Anda menekan tombol pintas.
- **Jawaban streaming:** hasil AI ditampilkan secara bertahap seperti sedang mengetik.

### 🎵 Kontrol Media
- Kontrol pemutar musik (putar, jeda, lanjut, berhenti) langsung dari notch.
- Menampilkan informasi lagu yang sedang diputar (judul, artis, sampul album).

### 🔔 Notifikasi Windows
- **Notifikasi ter-mirror:** notifikasi Windows Anda diteruskan dan ditampilkan di notch.
- Kelola notifikasi dari berbagai aplikasi dengan pengaturan yang fleksibel.

### 🛠️ Alat Bantu (Tools)
- **Clipboard:** riwayat clipboard dengan akses cepat untuk menyalin ulang.
- **Timer:** hitung mundur dengan pengingat.
- **Stopwatch:** pencatat waktu.
- **Pomodoro:** teknik fokus 25 menit / istirahat 5 menit.
- **Ports:** lihat port yang sedang digunakan.
- **Runner:** jalankan perintah cepat.
- **Scanner:** pemindai kode QR dan barcode.

### 🎬 Pemutar Video
- Putar video langsung di dalam notch dengan kontrol pemutaran.

### 🎨 Tampilan
- **Mode gelap** dengan palet warna yang konsisten.
- **Efek gradien aurora** dan animasi *liquid ripple* yang halus.
- **Notch dapat disembunyikan** dari tangkapan layar (aktif/nonaktif).
- **Transparansi** yang dapat diatur.

### 🔄 Pembaruan Otomatis
- Mengecek versi baru saat dibuka dan setiap 6 jam; notch menampilkan **Pembaruan tersedia** dengan tombol **Perbarui**.
- Installer diunduh, tanda tangan digital diverifikasi, lalu dipasang dan aplikasi restart sendiri.

### ⚙️ Pengaturan Lengkap
- Atur tampilan, tombol pintas (hotkey), penyedia AI, notifikasi, dan video.
- Bahasa antarmuka: **Indonesia** dan **Inggris**.

---

## Teknologi

| Bagian | Teknologi |
|--------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Motion, Zustand, i18next |
| Backend | Rust (Tauri 2) |
| Basis data | SQLite (ter-bundel) |
| Penyimpanan kunci | Windows Credential Manager (keyring) |
| Pengemasan | NSIS Installer |

---

## Memulai & Instalasi

### Prasyarat

Sebelum menginstal, pastikan sistem Anda memiliki:

1. **Windows 10/11** (64-bit).
2. **WebView2 Runtime** — biasanya sudah terpasang di Windows 11. Jika belum, unduh dari [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
3. **Node.js 20+** dan **Rust** (toolchain MSVC) — diperlukan hanya jika ingin membangun dari sumber.
4. **Visual Studio Build Tools** dengan workload *Desktop development with C++* — diperlukan untuk kompilasi Rust di Windows.

### Instalasi (Pengguna)

1. Unduh installer `.exe` (NSIS) dari halaman [Releases](https://github.com/onesyah05/OnesNotch/releases).
2. Jalankan installer dan ikuti petunjuk di layar.
3. OnesNotch akan muncul sebagai pil di bagian atas layar.

### Membangun dari Sumber (Developer)

```bash
# 1. Instal dependensi frontend
npm install

# 2. Jalankan dalam mode pengembangan
npm run tauri dev

# 3. Buat build produksi (installer NSIS)
npm run tauri build
```

### Perintah Berguna

| Perintah | Deskripsi |
|----------|-----------|
| `npm run dev` | Jalankan frontend Vite dalam mode pengembangan |
| `npm run tauri dev` | Jalankan aplikasi lengkap dalam mode pengembangan |
| `npm run tauri build` | Buat installer produksi |
| `npm run typecheck` | Periksa tipe TypeScript |
| `npm run lint` | Periksa kualitas kode (ESLint + Prettier) |
| `npm test` | Jalankan pengujian (Vitest) |
| `npm run check:rust` | Periksa kualitas kode Rust (fmt + clippy + test) |

---

## Merilis Versi Baru

Pengguna yang sudah memasang OnesNotch 0.2.0 ke atas akan otomatis diberi tahu saat ada versi baru. Langkah merilis:

1. Naikkan versi di `package.json`, `src-tauri/tauri.conf.json`, dan `src-tauri/Cargo.toml` (ikuti [SemVer](https://semver.org/lang/id/): fitur baru → minor, perbaikan → patch).
2. Tulis perubahan di `CHANGELOG.md` dengan judul `## [x.y.z] - YYYY-MM-DD`. Isi bagian ini menjadi catatan rilis yang tampil di aplikasi.
3. Commit, lalu buat dan push tag yang sama dengan versinya:
   ```bash
   git tag v0.3.0
   git push origin main v0.3.0
   ```
4. Workflow **Release** di GitHub Actions membangun installer, menandatanganinya, dan menerbitkan rilis beserta `latest.json`. Setelah selesai, aplikasi pengguna menemukan pembaruan dalam ≤ 6 jam (atau langsung lewat Settings → Tentang → Cek pembaruan).

### Kunci tanda tangan (sekali saja)

Pembaruan ditandatangani supaya aplikasi hanya memasang installer asli. Kunci publik sudah ada di `src-tauri/tauri.conf.json`; kunci privat **tidak boleh** masuk repo.

- Kunci privat: `~/.tauri/onesnotch.key`. Simpan cadangannya di tempat aman (mis. password manager). Jika hilang, versi yang sudah terpasang tidak bisa menerima pembaruan lagi.
- Sudah ditambahkan sebagai secret repository `ONESNOTCH` (dipakai workflow Release). Untuk mengganti:
  ```bash
  gh secret set ONESNOTCH < ~/.tauri/onesnotch.key
  ```
- Build lokal dengan `npm run tauri build` juga butuh kunci ini:
  ```powershell
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\onesnotch.key"
  npm run tauri build
  ```

## Lisensi

© 2026 OnesNotch. Proyek ini dikembangkan untuk penggunaan pribadi.
