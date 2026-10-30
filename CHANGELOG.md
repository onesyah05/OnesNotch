# Changelog

Semua perubahan penting OnesNotch dicatat di sini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/lang/id/).

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

[0.2.0]: https://github.com/onesyah05/OnesNotch/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/onesyah05/OnesNotch/releases/tag/v0.1.1
