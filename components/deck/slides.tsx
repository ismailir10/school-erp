import { AccessMatrix } from "./access-matrix";
import { AssessArt } from "./art/assess-art";
import { BillingArt } from "./art/billing-art";
import { DashboardArt } from "./art/dashboard-art";
import { DayArt } from "./art/day-art";
import { FeesArt } from "./art/fees-art";
import { JournalArt } from "./art/journal-art";
import { JourneyArt } from "./art/journey-art";
import { ParentHomeArt } from "./art/parent-home-art";
import { PaymentArt } from "./art/payment-art";
import { ReportArt } from "./art/report-art";
import { SpineArt } from "./art/spine-art";
import { StructureArt } from "./art/structure-art";
import { StudentArt } from "./art/student-art";
import { TeacherHomeArt } from "./art/teacher-home-art";
import { TeamArt } from "./art/team-art";
import { CoverArt } from "./cover-art";
import { FirstSteps } from "./first-steps";
import { ModuleMap } from "./module-map";
import type { Slide } from "./types";

/*
 * The staff tour: nineteen slides, ordered as a school year runs. Copy is Indonesian, sentence case, staff register
 * (.claude/standards/voice.md): teachers are "guru" or "Bu Guru", never "Ustadzah". No vendor names but DOKU,
 * matching the legal pages. Button and menu names are quoted exactly as the app shows them.
 *
 * Every claim below was checked against live code; the register of claim → file is in
 * docs/cycles/2026-10-31-panduan-refresh.md. Change a claim, update the register.
 */
export const SLIDES: Slide[] = [
  {
    id: "sampul",
    nav: "Sampul",
    kicker: "Panduan Talib",
    title: "Cara Talib bekerja, dari pendaftaran sampai rapor",
    lead: "Panduan untuk admin dan guru: apa yang dikerjakan di Talib, siapa yang mengerjakannya, dan bagaimana satu bagian bersambung ke bagian lain.",
    who: ["admin", "guru"],
    variant: "cover",
    art: <CoverArt />,
  },
  {
    id: "gambaran",
    nav: "Gambaran umum",
    kicker: "Gambaran umum",
    title: "Satu data, tiga portal",
    lead: "Admin, guru, dan orang tua masing-masing punya portal sendiri, tetapi data yang dibaca sama. Absensi yang dicatat guru pagi ini langsung terlihat oleh admin dan orang tua.",
    who: ["admin", "guru"],
    art: <ModuleMap />,
  },
  {
    id: "dasbor",
    nav: "Dasbor",
    kicker: "Dasbor",
    title: "Pagi hari dimulai dari Perlu ditangani",
    lead: "Dasbor admin menaruh pekerjaan yang menunggu keputusan di bagian paling atas. Di bawahnya, Analitik menunjukkan tren kehadiran, kelengkapan Buku Penghubung, dan penagihan.",
    steps: [
      {
        title: "Antrean pekerjaan",
        text: "Formulir pendaftaran, pertanyaan baru, link pembayaran yang gagal, pengajuan cuti, dan draf penggajian. Daftar lengkapnya ada di Antrean pekerjaan, dari tautan Lihat semua.",
      },
      { title: "Tagihan dan piutang", text: "Tagihan lewat tempo dan piutang yang belum dibayar, langsung di dasbor." },
      { title: "Analitik", text: "Kehadiran 30 hari, kelas yang perlu perhatian, Buku Penghubung yang tertinggal, tagihan vs terkumpul." },
    ],
    who: ["admin"],
    art: <DashboardArt />,
  },
  {
    id: "pendaftaran",
    nav: "Pendaftaran",
    kicker: "Kesiswaan",
    title: "Pendaftaran: isi formulir, bayar, jadi siswa",
    lead: "Orang tua mengisi datanya lewat tautan, atau diisi bersama di meja admin saat datang langsung, lalu membayar biaya pendaftaran setelah formulir dikirim. Satu ketukan mengubah pendaftar menjadi data siswa dan wali.",
    steps: [
      { title: "Catat Pertanyaan", text: "Admin mencatat nama orang tua dan satu kontak, atau orang tua mengisi form singkat di halaman pendaftaran." },
      {
        title: "Kirim Formulir",
        text: "Satu ketukan, tanpa memilih program atau biaya. Tautan dikirim lewat WhatsApp, email, atau diisi bersama di meja admin.",
      },
      {
        title: "Formulir masuk",
        text: "Tujuh langkah, dari data anak sampai persetujuan. Ketik kode pos, alamat terisi. Biaya dibayar setelah formulir dikirim; admin bisa Tandai sudah bayar.",
      },
      { title: "Terima & Jadikan Siswa", text: "Admin memeriksa berkas, lalu satu ketukan membuat data siswa dan wali." },
    ],
    who: ["admin"],
    art: <JourneyArt />,
  },
  {
    id: "siswa",
    nav: "Siswa dan wali",
    kicker: "Kesiswaan",
    title: "Halaman siswa menjawab dulu, baru bertindak",
    lead: "Tunggakan, kehadiran bulan ini, dan rapor terlihat di bagian atas. Data dikelompokkan menjadi lima bagian, dan halaman wali murid menunjukkan apa yang perlu ditindaklanjuti untuk keluarga itu.",
    steps: [
      { title: "Lima bagian", text: "Profil, Keluarga & Berkas, Kelas & Akademik, Keuangan, Pendaftaran & Catatan." },
      { title: "Cuti siswa", text: "Catat cuti per bulan dari bagian Keuangan. Bulan cuti tidak ditagih." },
      { title: "Wali murid", text: "Anak terdaftar, tagihan keluarga, dan Ingatkan via WhatsApp dari satu halaman." },
    ],
    who: ["admin"],
    art: <StudentArt />,
  },
  {
    id: "akademik",
    nav: "Akademik",
    kicker: "Akademik",
    title: "Struktur sekolah: tahun ajaran, program, kelas, guru",
    lead: "Tahun ajaran baru dimulai dari salinan kelas tahun lalu. Setiap kelas terhubung ke satu program, dan program itulah yang menentukan tarif SPP siswanya.",
    steps: [
      { title: "Salin Kelas", text: "Kelas aktif tahun lalu disalin ke tahun ajaran baru." },
      { title: "Program kelas", text: "Program bisa diubah, dengan pratinjau SPP lama dan baru, selama siswanya belum punya tagihan." },
      { title: "Guru dan pengganti", text: "Wali kelas dan pendamping per kelas; Ubah Guru Sesi bila guru berhalangan." },
      { title: "Naik Kelas Massal", text: "Pindahkan banyak siswa sekaligus; yang tidak dicentang tinggal kelas." },
    ],
    who: ["admin"],
    art: <StructureArt />,
  },
  {
    id: "absensi",
    nav: "Absensi",
    kicker: "Kehadiran",
    title: "Absensi kelas: tandai yang tidak hadir, sisanya satu ketukan",
    lead: "Guru menandai siswa yang sakit, izin, atau alpa, lalu satu tombol menandai siswa lainnya Hadir. Orang tua melihatnya di portal, admin melihat rekapnya.",
    steps: [
      { title: "Di kelas", text: "H, S, I, A per siswa dari ponsel. Tombol Tandai siswa lainnya Hadir hanya mengisi yang belum ditandai." },
      { title: "Di kantor", text: "Kehadiran Siswa: harian dan rekap bulanan, Timpa Kehadiran bila perlu koreksi, Ekspor CSV." },
    ],
    who: ["admin", "guru"],
    art: <DayArt />,
  },
  {
    id: "buku-penghubung",
    nav: "Buku Penghubung",
    kicker: "Buku Penghubung",
    title: "Buku Penghubung: satu centang sudah cukup",
    lead: "Guru mencentang indikator harian tiap anak. Satu indikator sudah membuat anak itu lengkap, dan hari tanpa kegiatan bisa ditandai sehingga tidak dihitung tertinggal.",
    steps: [
      { title: "Isi cepat satu kelas", text: "Tandai satu indikator untuk semua anak sekaligus; anak yang tidak hadir tidak ikut." },
      { title: "Hari tanpa buku penghubung", text: "Misalnya hari renang. Alasannya tampil untuk orang tua, dan hari itu dihitung selesai." },
      { title: "Catatan", text: "Guru dan orang tua saling menulis catatan; balasan baru muncul di Beranda guru." },
    ],
    who: ["admin", "guru"],
    art: <JournalArt />,
  },
  {
    id: "kurikulum",
    nav: "Kurikulum",
    kicker: "Kurikulum",
    title: "Kurikulum disusun berjenjang, dari semester sampai pekan",
    lead: "Admin menyusun semester, tema, subtema, pekan, dan tujuan pembelajaran, atau mengimpor PROMES dari file xlsx. Guru membacanya dan menilai pada jenjang itu.",
    badge: "Tahap peralihan 2026",
    steps: [
      { title: "Susun", text: "Semester, Tema, Subtema, Pekan, Tujuan Pembelajaran, dari menu Pengaturan." },
      { title: "Impor PROMES", text: "Unggah xlsx, periksa pratinjaunya, lalu simpan." },
    ],
    who: ["admin", "guru"],
    art: <SpineArt />,
  },
  {
    id: "penilaian",
    nav: "Penilaian",
    kicker: "Penilaian",
    title: "Penilaian: pekanan oleh wali kelas, harian di sentra",
    lead: "Guru menilai dari ponsel dengan tiga tingkat: Mampu dan Konsisten, Mampu Belum Konsisten, Perlu Penguatan. Ini tahapan perkembangan, bukan nilai angka.",
    badge: "Tahap peralihan 2026",
    steps: [
      { title: "Penilaian pekanan", text: "Wali kelas menilai tujuan pembelajaran pekan itu." },
      { title: "Sentra harian", text: "Guru sentra menilai di sentranya, misalnya Sentra Ibadah atau Sentra Seni." },
      { title: "Pemantauan", text: "Admin melihat kelengkapan per kelas, dan bisa menimpa penilaian yang keliru." },
    ],
    who: ["admin", "guru"],
    art: <AssessArt />,
  },
  {
    id: "rapor",
    nav: "Rapor",
    kicker: "Rapor",
    title: "Rapor triwulan disusun dari penilaian",
    lead: "Talib menyarankan tingkat tiap bagian rapor dari penilaian yang sudah masuk. Admin memilih narasi dari Bank Narasi, menyunting, lalu menerbitkan; orang tua membacanya di portal.",
    badge: "Tahap peralihan 2026",
    steps: [
      { title: "Saran tingkat", text: "Dihitung dari penilaian triwulan itu, per bagian narasi." },
      { title: "Pakai narasi", text: "Kalimat siap pakai dari Bank Narasi, lalu disunting seperlunya." },
      { title: "Simpan & Terbitkan", text: "Orang tua membaca di portal dan bisa Unduh PDF. Penerbitan bisa ditarik." },
    ],
    who: ["admin"],
    art: <ReportArt />,
  },
  {
    id: "biaya",
    nav: "Biaya",
    kicker: "Keuangan",
    title: "Biaya diatur sekali, dipakai setiap bulan",
    lead: "Komponen biaya dan tarif per program menjadi dasar setiap tagihan. Anak yang ikut sekolah dan daycare cukup dikenai satu harga paket.",
    steps: [
      { title: "Komponen dan tarif", text: "Komponen Biaya, lalu Tarif per Program untuk tiap tahun ajaran." },
      { title: "Harga paket sekolah + daycare", text: "Satu harga untuk anak yang ikut keduanya." },
      { title: "Keringanan Siswa", text: "Diskon atau tambahan per siswa." },
    ],
    who: ["admin"],
    art: <FeesArt />,
  },
  {
    id: "tagihan",
    nav: "Tagihan",
    kicker: "Keuangan",
    title: "Tagihan massal dalam tiga langkah",
    lead: "Buat Tagihan menyusun tagihan untuk banyak siswa sekaligus: pilih cakupan, tinjau, lalu komit. Siswa yang sedang cuti dilewati, dan draf yang belum selesai tetap tersimpan.",
    steps: [
      { title: "Cakupan, Tinjau, Komit", text: "Satu wizard untuk semua kelas, dengan harga per siswa sesuai programnya." },
      { title: "Tagihan Manual", text: "Untuk satu tagihan di luar siklus bulanan." },
      { title: "Catat pembayaran di muka", text: "SPP beberapa bulan atau biaya lain yang sudah diterima. Hasilnya tagihan Lunas, tanpa link." },
    ],
    who: ["admin"],
    art: <BillingArt />,
  },
  {
    id: "pembayaran",
    nav: "Pembayaran",
    kicker: "Keuangan",
    title: "Pembayaran lewat DOKU, tercatat sendiri",
    lead: "Orang tua membayar dari portal; Talib memeriksa status begitu mereka kembali. Link yang kedaluwarsa tidak menghapus tagihan, dan link baru bisa dibuat kapan saja.",
    steps: [
      { title: "Link pembayaran", text: "Kolom Link berlaku menunjukkan masa aktifnya. Buat link baru per tagihan, atau sekaligus untuk yang perlu." },
      { title: "Pengingat WhatsApp", text: "Satu ketukan per keluarga, dari templat yang bisa diubah di Pengaturan." },
      { title: "Perlu dicek", text: "Uang yang masuk ke tagihan yang sudah lunas atau dibatalkan ditandai untuk diperiksa." },
      { title: "Kuitansi dan koreksi", text: "Unduh kuitansi setelah lunas; pembayaran bisa dibatalkan dengan alasan, tercatat di jejak audit." },
    ],
    who: ["admin"],
    art: <PaymentArt />,
  },
  {
    id: "portal-guru",
    nav: "Portal guru",
    kicker: "Portal guru",
    title: "Hari guru di ponsel, dari Catat masuk sampai jurnal",
    lead: "Beranda guru menunjukkan kelas hari ini dan apa yang belum selesai. Lima tab di bawah layar: Beranda, Absensi, Jurnal, Penilaian, Lainnya.",
    steps: [
      { title: "Catat masuk", text: "Kehadiran guru dicatat dari Beranda; terlambat ditandai otomatis." },
      { title: "Yang perlu diselesaikan", text: "Absensi, jurnal, dan penilaian yang belum terisi hari ini, plus balasan dari wali." },
      { title: "Lainnya", text: "Kehadiran saya, Ajukan cuti, Slip gaji, Profil saya, dan panduan ini." },
    ],
    who: ["guru"],
    art: <TeacherHomeArt />,
  },
  {
    id: "tim",
    nav: "Tim dan gaji",
    kicker: "SDM",
    title: "Kehadiran, cuti, dan slip gaji",
    lead: "Guru dan karyawan mencatat kehadiran dan mengajukan cuti dari ponsel. Penggajian dijalankan pemilik; guru hanya melihat slipnya sendiri.",
    steps: [
      { title: "Kehadiran", text: "Catat masuk dan pulang harian, direkap per bulan." },
      { title: "Pengajuan Cuti", text: "Diajukan guru, disetujui pemilik atau peran dengan akses SDM." },
      { title: "Penggajian", text: "Komponen gaji per karyawan, proses bulanan, persetujuan, lalu slip muncul untuk guru." },
    ],
    who: ["admin", "guru"],
    art: <TeamArt />,
  },
  {
    id: "portal-ortu",
    nav: "Portal orang tua",
    kicker: "Portal orang tua",
    title: "Yang dilihat orang tua di ponselnya",
    lead: "Orang tua masuk dengan akun Google yang emailnya terdaftar di sekolah. Mereka melihat kabar anak dari data yang Anda isi, jadi yang dicatat di kelas langsung sampai ke rumah.",
    steps: [
      { title: "Beranda dan Kehadiran", text: "Kabar keluarga hari ini, semua anak dalam satu akun." },
      { title: "Jurnal", text: "Buku Penghubung dari sekolah, kebiasaan di rumah, dan catatan untuk Bu Guru." },
      { title: "Perkembangan dan Rapor", text: "Tahapan belajar anak, dan rapor yang sudah terbit." },
      { title: "Tagihan", text: "Bayar sekarang lewat DOKU, minta link baru, unduh kuitansi." },
    ],
    who: ["admin", "guru"],
    art: <ParentHomeArt />,
  },
  {
    id: "akses",
    nav: "Akses",
    kicker: "Akses",
    title: "Akses per peran",
    lead: "Masuk hanya dengan akun Google yang sudah diundang. Peran menentukan halaman yang terbuka, dan perubahan penting tercatat di jejak audit.",
    who: ["admin", "guru"],
    art: <AccessMatrix />,
  },
  {
    id: "mulai",
    nav: "Langkah pertama",
    kicker: "Langkah pertama",
    title: "Minggu pertama memakai Talib",
    lead: "Empat kebiasaan untuk tiap peran. Bila ada yang tidak sesuai, hubungi admin sekolah; panduan ini bisa dibuka lagi dari menu Panduan Talib.",
    who: ["admin", "guru"],
    art: <FirstSteps />,
  },
];
