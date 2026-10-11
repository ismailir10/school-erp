# Skenario Uji Lintas-Peran — Pilot Talib

> Panduan manual untuk siapa saja yang bantu uji pilot. Satu skenario = satu peran lakukan aksi, peran lain verifikasi hasilnya. Bukan bagian `/spec → /build → /ship`; jalankan kapan saja selama pilot berjalan.

## Cara Pakai

1. Pilih modul di bawah, jalankan skenario sesuai fase pilot saat ini (lihat kolom **Fase**).
2. Login pakai akun sesuai peran (lihat tabel akun).
3. Ikuti Langkah, cocokkan Hasil Diharapkan. Kalau beda → catat sebagai temuan (blocker/minor) dan lapor ke CTO harness yang jalan (`/ship` signed-in staging check atau langsung ke owner).
4. Fase pilot saat ini: **staff-only** (admin + guru aktif, wali murid/parent belum diundang). Skenario bertanda **Fase: parent-live** ditunda sampai wali murid diundang — tetap dicatat di sini sebagai referensi lengkap.

### Akun uji per peran

Sumber: `.claude/verify-accounts.json`. Pakai akun ini di staging, bukan akun pribadi murid/wali asli.

| Peran | Akun | Catatan |
|---|---|---|
| SUPER_ADMIN | `ismailir10@gmail.com` | Akses penuh termasuk payroll/salary |
| SCHOOL_ADMIN | *(seed manual jika belum ada)* | Semua akses admin kecuali payroll/salary |
| TEACHER | `ismail10rabbanii@gmail.com` | Terhubung ke Employee "Guru Dua" di staging |
| GUARDIAN (parent) | `rightjet.hq@gmail.com` | Untuk fase parent-live |

Kalau butuh SCHOOL_ADMIN, buat via `/admin/settings` (User + role SCHOOL_ADMIN) — jangan pakai akun SUPER_ADMIN pilot (`ismailir10@gmail.com`) untuk tes yang seharusnya dibatasi.

---

## Modul: core (Auth, Tenant, Kalender Libur)

### CORE-01 — Login pertama kali (auto-provision)
- **Peran:** TEACHER (baru)
- **Fase:** staff-only
- **Setup:** Buat Employee baru + assign email Google baru, JANGAN buat User row manual.
- **Langkah:** Login pakai Google OAuth dengan email tsb.
- **Hasil diharapkan:** Masuk langsung ke `/teacher`, User row otomatis dibuat.
- **Catatan pilot:** **Bug diketahui** — auto-provision pernah gagal (loop balik ke `/`) kalau User row belum ada duluan. Kalau ini masih terjadi, ini blocker P0 untuk onboarding guru baru — jangan lanjut undang guru lain sebelum ini fix. Mitigasi sementara: admin pre-create User row manual saat onboarding staff baru.

### CORE-02 — SUPER_ADMIN vs SCHOOL_ADMIN batasan akses
- **Peran:** SCHOOL_ADMIN
- **Fase:** staff-only
- **Langkah:** Login SCHOOL_ADMIN, coba buka `/admin/payroll` dan `/admin/settings/salary-components`.
- **Hasil diharapkan:** Ditolak (403 atau menu tidak muncul di sidebar). SCHOOL_ADMIN hanya lihat siswa, admisi, akademik, kehadiran, invoice, karyawan (tanpa gaji).

---

## Modul: students (Siswa, Wali, Admisi)

### STUDENT-01 — Admin buat siswa baru → guru lihat di kelasnya
- **Peran:** SUPER_ADMIN → TEACHER
- **Fase:** staff-only
- **Langkah:**
  1. Admin: `/admin/students` → tambah siswa baru, assign ke kelas milik guru uji, isi ≥1 data wali.
  2. Guru: buka `/teacher` → tab Kelas → cek roster.
- **Hasil diharapkan:** Siswa baru muncul di roster guru tanpa refresh manual/relogin.

### STUDENT-02 — Alur admisi publik → convert jadi siswa
- **Peran:** Publik (tanpa login) → SUPER_ADMIN
- **Fase:** staff-only (data admisi diisi tim admin dulu, publik belum diarahkan ke `/daftar` sungguhan)
- **Langkah:**
  1. Publik: isi form `/daftar` (satu halaman pendek: nama orang tua + satu kontak; data anak opsional).
  2. Admin: `/admin/admissions` → baris Tahap *Baru* → "Kirim Formulir" (pilih Program + Day Care; email tidak wajib, bisa WA atau salin tautan).
  3. Buka link tokenized `/pendaftaran/[token]`: layar *Bayar dulu*, bayar (atau admin Tandai lunas / Bebaskan), lalu isi wizard 7 langkah, submit.
  4. Admin: baris jadi *Formulir masuk* → "Terima & Jadikan Siswa" (satu konfirmasi; jawab pertanyaan duplikat siswa/wali bila muncul).
- **Hasil diharapkan:** Admission → EnrollmentApplication → Student + 2 Parent row ter-generate, baris berakhir *Siswa*. Data konsisten (bukan hilang) dari form ke record final. Sibling auto-detect muncul kalau email/telp cocok data existing.

### STUDENT-03 — Export data siswa (CSV)
- **Peran:** SUPER_ADMIN
- **Fase:** staff-only
- **Langkah:** `/admin/students` → Unduh Data → pilih kriteria baris + kolom → export.
- **Hasil diharapkan:** CSV terunduh, kolom sesuai pilihan, tidak ada formula-injection (cell diawali `=`/`+`/`-`/`@` di-escape).

---

## Modul: academic (Kelas, Tahun Ajaran, Promosi)

### ACADEMIC-01 — Buat sesi kelas harian + guru pengganti
- **Peran:** SUPER_ADMIN → TEACHER
- **Fase:** staff-only
- **Langkah:**
  1. Admin: `/admin/classes` → kelas guru uji → buat sesi hari ini, opsional swap guru pengganti.
  2. Guru (atau guru pengganti): buka `/teacher` → cek sesi hari ini muncul di dashboard.
- **Hasil diharapkan:** Sesi + guru yang benar (pengganti jika di-swap) muncul di dashboard teacher yang login.

### ACADEMIC-02 — Naik Kelas Massal (promosi)
- **Peran:** SUPER_ADMIN
- **Fase:** staff-only — **jangan jalankan di prod sampai tahun ajaran baru benar-benar mulai**, dampak luas ke semua siswa aktif
- **Langkah:** `/admin/classes` → Naik Kelas Massal → cek preview roster + exclude list + capacity hint sebelum submit.
- **Hasil diharapkan:** Preview akurat sebelum commit; siswa yang di-exclude tidak ikut naik kelas.

---

## Modul: finance (Invoice, Pembayaran)

### FINANCE-01 — Admin generate invoice → parent bayar (Xendit) → admin lihat di ledger
- **Peran:** SUPER_ADMIN → GUARDIAN → SUPER_ADMIN
- **Fase:** parent-live (butuh wali murid aktif; sementara staff bisa simulasi pakai akun parent uji)
- **Langkah:**
  1. Admin: generate invoice manual/bulk untuk siswa uji.
  2. Parent: `/parent` → tab invoice → checkout via Xendit (sandbox).
  3. Admin: `/admin/payments` → cek payment masuk di ledger tanggal ini.
- **Hasil diharapkan:** Invoice status berubah PAID setelah bayar sukses, muncul di Penerimaan dengan metode benar, jumlah rekonsiliasi cocok (total kartu = total tabel).

### FINANCE-02 — Kuitansi PDF
- **Peran:** SUPER_ADMIN
- **Fase:** staff-only
- **Langkah:** Buka invoice PAID → generate kuitansi PDF.
- **Hasil diharapkan:** PDF berisi data benar (nama siswa, jumlah, tanggal bayar).

---

## Modul: learning (Kehadiran, Buku Penghubung)

### LEARNING-01 — Guru absen siswa → admin lihat rekap → parent lihat grid (jika live)
- **Peran:** TEACHER → SUPER_ADMIN → GUARDIAN
- **Fase:** staff-only untuk langkah 1-2, parent-live untuk langkah 3
- **Langkah:**
  1. Guru: `/teacher` → Kelas → absen hari ini (tap-cycle status per siswa).
  2. Admin: `/admin/student-attendance` → cek muncul di list harian + tab Rekap Bulanan.
  3. Parent: `/parent` → tab attendance → cek week grid cocok.
- **Hasil diharapkan:** Data absensi konsisten di 3 sisi tanpa delay/cache basi. CSV export rekap bulanan cocok dengan tampilan.

### LEARNING-02 — Buku Penghubung dua arah
- **Peran:** TEACHER → GUARDIAN → TEACHER
- **Fase:** parent-live
- **Langkah:**
  1. Guru: isi catatan sekolah (school scope) untuk siswa.
  2. Parent: buka Buku Penghubung, baca catatan sekolah, tambah catatan rumah.
  3. Guru: cek catatan rumah dari parent muncul di sisi guru.
- **Hasil diharapkan:** Audit trail dua arah tercatat, tidak ada data hilang/timpa antar peran.

### LEARNING-03 — Guru cek slip gaji sendiri
- **Peran:** TEACHER
- **Fase:** staff-only
- **Langkah:** `/teacher` → tab slip gaji → tap baris bulan ini → download PDF.
- **Hasil diharapkan:** Slip guru lain TIDAK bisa diakses (coba ganti ID di URL kalau memungkinkan → harus 403/404). Placeholder muncul kalau slip bulan lalu belum publish.

---

## Modul: curriculum + reportCard (Penilaian, Raport — cutover Juli 2026)

### CURRICULUM-01 — Guru isi penilaian mingguan (walas) + harian (sentra)
- **Peran:** TEACHER → SUPER_ADMIN
- **Fase:** staff-only
- **Langkah:**
  1. Guru walas: `/teacher/assessments/weekly` → isi skala 3-level (Konsisten/Belum/Penguatan) untuk kelasnya.
  2. Guru sentra: `/teacher/assessments/center/[center]` → isi entri harian.
  3. Admin: `/admin/assessments` → cek completion monitor menunjukkan progress benar (walas-weekly + sentra-daily).
- **Hasil diharapkan:** Entry tersimpan dengan source benar (WEEKLY vs CENTER), admin monitor real-time reflect status.

### CURRICULUM-02 — Admin susun & terbitkan raport → parent baca
- **Peran:** SUPER_ADMIN → GUARDIAN
- **Fase:** staff-only untuk langkah 1, parent-live untuk langkah 2
- **Langkah:**
  1. Admin: `/admin/report-cards` → pilih siswa+term → cek draft auto-generated dari AssessmentEntry (dominant level + attendance), override field jika perlu, Publish, cek PDF.
  2. Parent: `/parent/reports` → cek hanya raport yang PUBLISHED muncul, isi (narasi + skala 3-level + kehadiran) cocok dengan yang admin publish.
- **Hasil diharapkan:** Draft-before-publish tidak terlihat parent. Setelah publish, PDF via `/api/guardian/report-cards/...` bisa diunduh parent. Unpublish menyembunyikan lagi dari parent.

### CURRICULUM-03 — Void entri penilaian (SCHOOL_ADMIN, bukan TEACHER)
- **Peran:** SCHOOL_ADMIN
- **Fase:** staff-only
- **Langkah:** Coba void satu AssessmentEntry sebagai TEACHER (harus gagal/403), lalu sebagai SCHOOL_ADMIN (harus berhasil, isi voidReason).
- **Hasil diharapkan:** Hanya SCHOOL_ADMIN (+ SUPER_ADMIN) bisa void. Entry voided tidak dihitung lagi di rollup parent/admin monitor.

---

## Modul: hr (Karyawan, Absensi Staff, Payroll)

### HR-01 — Payroll run end-to-end
- **Peran:** SUPER_ADMIN
- **Fase:** staff-only — **hati-hati, ini data gaji riil kalau di prod**
- **Langkah:** `/admin/payroll` → DRAFT → APPROVED → EXPORTED → SLIPS_SENT, cek tiap transisi.
- **Hasil diharapkan:** Slip terkirim ke guru (cross-check LEARNING-03). AuditLog tercatat untuk approve/cancel/employee-status (before/after JSON, tenant-scoped).

### HR-02 — Absensi & cuti staff
- **Peran:** SUPER_ADMIN + TEACHER
- **Fase:** staff-only
- **Langkah:**
  1. Guru: ajukan cuti dari `/teacher`.
  2. Admin: `/admin/employee-attendance` atau leave-requests → approve/reject.
- **Hasil diharapkan:** Status cuti guru berubah sesuai keputusan admin, tercermin di kalender absensi guru.

---

## Skenario Lintas-Tenant / Keamanan (jalankan sekali per pilot phase, bukan per fitur)

### SECURITY-01 — Isolasi data antar keluarga
- **Peran:** GUARDIAN (2 akun parent berbeda)
- **Fase:** parent-live
- **Langkah:** Login parent A, coba akses data siswa milik keluarga B (ganti ID di URL kalau ada akses langsung).
- **Hasil diharapkan:** 403/404, tidak ada leak data anak lain. (Rujuk `[[reference_parent_email_null_leak]]` — guardian/parent routes wajib require parentId-or-nonempty-email sebelum query.)

### SECURITY-02 — Guru hanya lihat kelas yang di-assign
- **Peran:** TEACHER (2 akun guru berbeda)
- **Fase:** staff-only
- **Langkah:** Guru A coba akses roster/attendance kelas milik guru B.
- **Hasil diharapkan:** Ditolak atau kosong — hanya assigned classes yang terlihat.

---

## Format Laporan Temuan

Kalau skenario gagal, catat singkat (bukan file baru — tempel ke cycle doc aktif kalau ada, atau ke issue tracker):

```
[MODUL-ID] Blocker|Minor — <apa yang terjadi> vs <hasil diharapkan>
Peran: <role>  Fase: <staff-only|parent-live>  Repro: <langkah singkat>
```
