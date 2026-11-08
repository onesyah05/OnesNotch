# Changelog

Semua perubahan penting OnesNotch dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

## [0.3.1] - 2026-11-08

### Diperbaiki

- Login Codex gagal dengan pesan "Codex login returned an invalid response". Server OpenAI mengirim interval polling sebagai teks (`"5"`), bukan angka, sehingga respons pertama ditolak. Sekarang keduanya diterima.
- Tautan untuk memasukkan kode perangkat Codex kini mengarah ke halaman yang benar (`auth.openai.com/codex/device`).
- Setelah login Codex, status "Tersambung sebagai {email}" kini menampilkan email akun ChatGPT Anda.
- Login Codex kini menampilkan kode perangkat (sebelumnya kosong) dan otomatis membuka halaman untuk memasukkan kode di browser.
- Codex: daftar model diambil langsung dari akun ChatGPT Anda (sebelumnya selalu kosong), dan jawaban memakai mode streaming yang diwajibkan server. Model bawaan diganti dari `gpt-5.1-codex` (sudah dihentikan) ke `gpt-6-sol`.
- Antigravity: "The API key is not valid" padahal sudah login. Server Google hanya menerima permintaan dari klien Antigravity versi terbaru dan butuh project Cloud Code akun Anda; keduanya kini dikirim. Daftar model hanya berisi model chat (termasuk seri `gemini-3.8-flash-*`), dan model bawaan diganti ke `gemini-3-flash`.
- Login Codex selesai di browser tetapi gagal tersimpan ("Local storage failed"). Token Codex lebih panjang dari batas satu entri Windows Credential Manager (2560 byte); token panjang kini dipecah ke beberapa entri dan disatukan lagi saat dibaca.
- Claude Code (login langganan): permintaan kini memakai identitas klien Claude Code yang diminta server.
- Settings → AI: kolom Model kini berupa daftar pilihan yang dimuat otomatis dari provider (setelah login, setelah API key disimpan, atau untuk provider tanpa key seperti Ollama). Model di luar daftar tetap bisa diketik lewat opsi "Ketik model lain…". Kolom ini juga tidak lagi membawa model provider sebelumnya saat berganti provider.

## [0.3.0] - 2026-11-08

### Ditambahkan

- **Login provider langganan**: masuk ke Claude Code, Codex (ChatGPT), dan Antigravity (Gemini) memakai akun langganan yang sudah Anda bayar — tanpa menempel API key. Cukup klik **Masuk** di Settings → AI, selesaikan login di browser (atau masukkan kode perangkat untuk Codex), dan Notch langsung tersambung.
  - Claude Code: login lewat browser (PKCE).
  - Codex: alur kode perangkat — buka URL, ketik kode yang tampil di Notch.
  - Antigravity: login Google lewat browser.
- Status koneksi per provider ("Tersambung sebagai {email}") dan tombol **Keluar** untuk berpindah akun.

### Keamanan

- Token langganan hanya disimpan di Rust (Windows Credential Manager) dan tidak pernah dikirim ke antarmuka web.
- Validasi `state` OAuth diperketat: server callback memakai `state` yang sama dengan URL otorisasi, sehingga redirect palsu ditolak.

## [0.2.0] - 2026-10-30

### Ditambahkan

- **Jalankan saat Windows menyala** (autostart). Aktif secara bawaan dan bisa dimatikan di Settings → Umum.
- **Auto-hide**: notch bersembunyi di atas layar dan turun hanya saat ada event (notifikasi, video, timer selesai, pengingat minum, lagu baru). Notch juga muncul berkala setiap 3 menit selama 5 detik; keduanya bisa diatur. Arahkan kursor ke tepi atas tengah layar untuk membukanya.
- **Pengingat minum**: target harian = berat badan × 30 ml (rentang 30–35 ml/kg), dibagi dalam 12 jam mulai jam yang diatur. Pengingat bertahan sampai Anda klik "Minum" ("Nanti" menunda 15 menit). Ada menu Settings → Pengingat minum dan tool "Minum air" di tab Tools.
- **Pembaruan otomatis**: aplikasi mengecek versi baru saat dibuka dan setiap 6 jam. Jika ada, notch menampilkan "Pembaruan tersedia" dengan tombol **Perbarui**; installer diunduh, tanda tangannya diverifikasi, lalu dipasang dan OnesNotch restart sendiri. Bisa juga dicek manual di Settings → Tentang.
- Menu Settings baru: **Umum** dan **Pengingat minum**.

### Diubah

- Notch kini menempel ke tepi atas layar tanpa margin; sudut atas rata, sudut bawah membulat.
- Tampilan diseragamkan: warna sorotan mengikuti accent color pilihan Anda, switch on/off baru, dan teks yang tadinya tertulis langsung di kode kini tersedia dalam Bahasa Indonesia dan Inggris.

### Diperbaiki

- Window Settings yang tersembunyi tidak lagi muncul sebagai kotak putih di screenshot saat mode "Visible in capture" aktif.

## [0.1.1] - 2026-10-27

- Rilis awal: notch Dynamic Island, jawaban AI dari layar, kontrol media, notifikasi, dan tools.

[0.3.1]: https://github.com/onesyah05/OnesNotch/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/onesyah05/OnesNotch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/onesyah05/OnesNotch/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/onesyah05/OnesNotch/releases/tag/v0.1.1
