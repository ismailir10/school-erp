import { AccessMatrix } from "./access-matrix";
import { BillingArt } from "./art/billing-art";
import { DayArt } from "./art/day-art";
import { JourneyArt } from "./art/journey-art";
import { ReportArt } from "./art/report-art";
import { SpineArt } from "./art/spine-art";
import { StructureArt } from "./art/structure-art";
import { TeamArt } from "./art/team-art";
import { CoverArt } from "./cover-art";
import { ModuleMap } from "./module-map";
import type { Slide } from "./types";

/*
 * The ten slides. Copy is Indonesian, sentence case, staff register (.claude/standards/voice.md):
 * teachers are "guru" or "Bu Guru", never "Ustadzah". No vendor names but DOKU, matching the legal pages.
 *
 * Every claim below was checked against live code when this deck was written; the register of
 * claim → file is in docs/cycles/2026-10-09-talib-deck.md. Change a claim, update the register.
 */
export const SLIDES: Slide[] = [
  {
    id: "sampul",
    nav: "Sampul",
    kicker: "Panduan Talib",
    title: "Cara Talib bekerja, dari pendaftaran sampai rapor",
    lead: "Panduan ini menunjukkan apa yang dikerjakan di Talib, siapa yang mengerjakannya, dan bagaimana satu bagian bersambung ke bagian lain.",
    who: ["admin", "guru"],
    variant: "cover",
    art: <CoverArt />,
  },
  {
    id: "gambaran",
    nav: "Gambaran umum",
    kicker: "Gambaran umum",
    title: "Satu data, tiga portal",
    lead: "Admin, guru, dan orang tua masing-masing punya portal sendiri, tetapi data yang dibaca sama. Absensi yang dicatat guru, misalnya, bisa dilihat admin dan orang tua.",
    who: ["admin", "guru"],
    art: <ModuleMap />,
  },
  {
    id: "kesiswaan",
    nav: "Kesiswaan",
    kicker: "Kesiswaan",
    title: "Pendaftaran: isi formulir, bayar, jadi siswa",
    lead: "Orang tua mengisi datanya lewat tautan, atau diisi bersama di meja admin saat datang langsung, lalu membayar biaya pendaftaran setelah formulir dikirim. Admin memeriksa berkas, lalu satu ketukan mengubah pendaftar menjadi data siswa dan wali.",
    steps: [
      { title: "Catat pertanyaan", text: "Admin mencatat nama orang tua dan satu kontak, atau orang tua mengisi form singkat di halaman pendaftaran." },
      {
        title: "Kirim Formulir",
        text: "Satu ketukan, tanpa memilih program atau biaya. Tautan dikirim lewat WhatsApp atau email; orang tua memilih program dan Day Care di formulir, biayanya dibayar setelah formulir dikirim.",
      },
      {
        title: "Formulir masuk",
        text: "Tujuh langkah: data anak dan orang tua, berkas, persetujuan. Cukup ketik kode pos, alamatnya terisi. Tiap orang tua menandatangani dari ponselnya, atau diisi bersama admin; biaya dibayar setelah formulir dikirim.",
      },
      { title: "Siswa", text: "Admin memeriksa berkas, lalu menekan Terima & Jadikan Siswa. Data siswa dan wali ikut dibuat." },
    ],
    who: ["admin"],
    art: <JourneyArt />,
  },
  {
    id: "akademik",
    nav: "Akademik",
    kicker: "Akademik",
    title: "Struktur sekolah: tahun ajaran, kelas, guru",
    lead: "Tahun ajaran baru dimulai dari salinan kelas tahun lalu. Penugasan guru, guru pengganti, dan kenaikan kelas diatur dari halaman kelas.",
    steps: [
      { title: "Salin kelas", text: "Kelas aktif tahun lalu disalin ke tahun ajaran baru." },
      { title: "Atur guru", text: "Wali kelas dan pendamping ditugaskan per kelas." },
      { title: "Pasang pengganti", text: "Jika guru berhalangan, tukar dengan pengganti untuk satu sesi." },
      { title: "Naik kelas", text: "Pindahkan banyak siswa ke kelas berikutnya sekaligus." },
    ],
    who: ["admin", "guru"],
    art: <StructureArt />,
  },
  {
    id: "harian",
    nav: "Hari di kelas",
    kicker: "Kehadiran dan Buku Penghubung",
    title: "Absensi dan catatan harian dari kelas",
    lead: "Guru menandai siswa yang sakit, izin, atau alpa, lalu satu ketukan menandai sisanya hadir. Buku Penghubung membawa catatan dua arah antara sekolah dan rumah.",
    steps: [
      { title: "Absensi kelas", text: "Dicatat guru dari ponsel, dilihat orang tua di portal mereka." },
      { title: "Buku Penghubung", text: "Indikator harian dan percakapan, dengan penanda belum dibaca." },
      { title: "Pemantauan admin", text: "Rekap bulanan per kelas dan ekspor CSV." },
    ],
    who: ["admin", "guru"],
    art: <DayArt />,
  },
  {
    id: "kurikulum",
    nav: "Kurikulum",
    kicker: "Kurikulum dan penilaian",
    title: "Penilaian mengikuti rangkaian kurikulum",
    lead: "Kurikulum disusun berjenjang, dari semester sampai minggu. Guru menilai pada jenjang itu, dan admin memantau mana yang belum terisi.",
    badge: "Tahap peralihan 2026",
    steps: [
      { title: "Susun", text: "Pemilik menyusun semester, tema, dan indikator, atau mengimpor PROMES dari xlsx." },
      { title: "Nilai", text: "Wali kelas menilai mingguan, guru sentra menilai harian, dengan skala tiga tingkat." },
      { title: "Pantau", text: "Admin melihat penilaian yang belum terisi di tiap kelas." },
    ],
    who: ["admin", "guru"],
    art: <SpineArt />,
  },
  {
    id: "rapor",
    nav: "Rapor",
    kicker: "Rapor",
    title: "Rapor triwulan disusun dari penilaian",
    lead: "Draf rapor terisi otomatis dari penilaian yang sudah masuk. Admin menyunting dan menerbitkan; orang tua membacanya di portal.",
    badge: "Tahap peralihan 2026",
    steps: [
      { title: "Draf", text: "Satu rapor per siswa, terisi dari penilaian triwulan itu." },
      { title: "Sunting dan terbitkan", text: "Admin menimpa isian bila perlu, memakai Bank Narasi untuk kalimat siap pakai." },
      { title: "Dibaca dan dicetak", text: "Orang tua membaca di portal; PDF tersedia untuk dicetak." },
    ],
    who: ["admin"],
    art: <ReportArt />,
  },
  {
    id: "keuangan",
    nav: "Keuangan",
    kicker: "Keuangan",
    title: "Biaya, tagihan, dan pembayaran",
    lead: "Biaya per program menjadi tagihan lewat wizard tiga langkah. Orang tua membayar daring lewat DOKU; pembayaran manual melewati tinjauan dan bisa dibatalkan dengan jejak audit.",
    steps: [
      { title: "Biaya dan keringanan", text: "Komponen biaya per program, potongan per siswa bila ada." },
      { title: "Buat tagihan", text: "Cakupan, tinjau, komit: tagihan massal untuk banyak siswa sekaligus." },
      { title: "Pembayaran dan kuitansi", text: "Pembayaran daring tercatat otomatis; kuitansi PDF tersedia." },
    ],
    who: ["admin"],
    art: <BillingArt />,
  },
  {
    id: "tim",
    nav: "Tim dan gaji",
    kicker: "SDM",
    title: "Kehadiran, cuti, dan slip gaji",
    lead: "Guru dan karyawan mencatat kehadiran dan mengajukan cuti dari ponsel. Penggajian dijalankan pemilik; guru hanya melihat slipnya sendiri.",
    steps: [
      { title: "Kehadiran", text: "Check-in dan check-out harian, direkap per bulan." },
      { title: "Cuti", text: "Diajukan guru, disetujui pemilik atau peran dengan akses SDM." },
      { title: "Penggajian", text: "Komponen gaji per karyawan, proses bulanan, persetujuan, slip." },
    ],
    who: ["admin", "guru"],
    art: <TeamArt />,
  },
  {
    id: "akses",
    nav: "Akses",
    kicker: "Akses dan langkah pertama",
    title: "Akses per peran dan langkah pertama",
    lead: "Masuk hanya dengan akun Google yang sudah diundang. Peran menentukan halaman yang terbuka, dan perubahan penting tercatat di jejak audit.",
    steps: [
      { title: "Admin", text: "Mulai dari Dasbor, lalu Antrean pekerjaan untuk melihat yang menunggu keputusan." },
      { title: "Guru", text: "Mulai dari Beranda untuk kelas hari ini, lalu Absensi." },
    ],
    who: ["admin", "guru"],
    art: <AccessMatrix />,
  },
];
