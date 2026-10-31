import { EnrollFormMock } from "./mock/enroll-form-mock";
import { GrowthMock } from "./mock/growth-mock";
import { ParentAttendanceMock } from "./mock/parent-attendance-mock";
import { ParentHomeMock } from "./mock/parent-home-mock";
import { ParentInvoiceMock } from "./mock/parent-invoice-mock";
import { ParentJournalMock } from "./mock/parent-journal-mock";
import { ParentReportMock } from "./mock/parent-report-mock";
import { PayResultMock } from "./mock/pay-result-mock";
import { ProfileMock } from "./mock/profile-mock";
import { SignInMock } from "./mock/sign-in-mock";
import { ParentCoverArt } from "./parent-cover-art";
import { ParentMap } from "./parent-map";
import type { Slide } from "./types";

/*
 * The parent tour, presented by the school at parent meetings and reopened by a parent from Profil. Parent register
 * (.claude/standards/voice.md): the warmest of the three, "Bapak/Ibu", child-framed, gentle about money, the
 * courtesy layer where it lands rather than sprinkled. Teachers are "Bu Guru", never "Ustadzah". DOKU is the one
 * named payment party. Labels are quoted as the parent portal shows them.
 *
 * Claims register: docs/cycles/2026-10-31-panduan-refresh.md. Change a claim, update the register.
 */
export const PARENT_SLIDES: Slide[] = [
  {
    id: "sampul",
    nav: "Sampul",
    kicker: "Panduan orang tua",
    title: "Kabar sekolah ananda, dalam genggaman Bapak dan Ibu",
    lead: "Assalamu'alaikum, Bapak dan Ibu. Talib adalah portal sekolah untuk orang tua: kehadiran, Buku Penghubung, perkembangan, rapor, dan tagihan, semuanya dari ponsel.",
    variant: "cover",
    art: <ParentCoverArt />,
  },
  {
    id: "isi",
    nav: "Isi portal",
    kicker: "Isi portal",
    title: "Enam hal yang bisa dilihat di Talib",
    lead: "Yang dicatat Bu Guru di kelas hari ini, itulah yang Bapak dan Ibu lihat di rumah. Tidak perlu menunggu kertas dibawa pulang.",
    art: <ParentMap />,
  },
  {
    id: "masuk",
    nav: "Masuk",
    kicker: "Masuk",
    title: "Masuk dengan akun Google, tanpa kata sandi baru",
    lead: "Buka Talib di ponsel, ketuk Masuk dengan Google, lalu pilih akun Google yang emailnya sama dengan email yang didaftarkan ke sekolah.",
    steps: [
      { title: "Pakai email yang terdaftar", text: "Email yang Bapak dan Ibu tulis di formulir pendaftaran." },
      { title: "Belum bisa masuk?", text: "Hubungi tata usaha untuk memeriksa atau mengganti email yang terdaftar." },
      { title: "Simpan di layar utama", text: "Tambahkan Talib ke layar utama ponsel supaya terbuka seperti aplikasi." },
    ],
    art: <SignInMock />,
  },
  {
    id: "beranda",
    nav: "Beranda",
    kicker: "Beranda",
    title: "Kabar keluarga hari ini, di satu layar",
    lead: "Beranda merangkum hari ini: kehadiran ananda, catatan baru dari Bu Guru, dan tagihan keluarga. Kakak dan adik dalam satu akun; ketuk nama anak untuk berpindah.",
    steps: [
      { title: "Lima tab di bawah layar", text: "Beranda, Tagihan, Kehadiran, Jurnal, dan Lainnya untuk Perkembangan, Rapor, dan Profil." },
      { title: "Tagihan keluarga", text: "Total tagihan semua anak. Bila semuanya sudah dibayar, tertulis Lunas semua." },
    ],
    art: <ParentHomeMock />,
  },
  {
    id: "kehadiran",
    nav: "Kehadiran",
    kicker: "Kehadiran",
    title: "Kehadiran ananda, dicatat Bu Guru setiap pagi",
    lead: "Hadir, sakit, izin, atau alpa terlihat per hari, pekan demi pekan, tak lama setelah Bu Guru mengisi absensi kelas.",
    steps: [
      { title: "Pekan demi pekan", text: "Hari ini ditandai; ketuk panah untuk melihat pekan sebelumnya." },
      { title: "Ananda berhalangan?", text: "Kabari Bu Guru lewat catatan di Jurnal atau lewat tata usaha, supaya dicatat sakit atau izin." },
    ],
    art: <ParentAttendanceMock />,
  },
  {
    id: "jurnal",
    nav: "Jurnal",
    kicker: "Buku Penghubung",
    title: "Buku Penghubung: sekolah dan rumah saling mengabari",
    lead: "Bu Guru mencatat kegiatan ananda di sekolah. Bapak dan Ibu mencentang kebiasaan di rumah dan bisa menulis catatan untuk Bu Guru.",
    steps: [
      { title: "Di sekolah", text: "Indikator harian dari Bu Guru. Hari tanpa buku penghubung, misalnya hari renang, diberi keterangan." },
      { title: "Di rumah", text: "Centang kebiasaan ananda di rumah." },
      { title: "Catatan", text: "Tulis catatan untuk Bu Guru; catatan sendiri bisa diubah atau dihapus." },
    ],
    art: <ParentJournalMock />,
  },
  {
    id: "perkembangan",
    nav: "Perkembangan",
    kicker: "Perkembangan",
    title: "Perkembangan: tahapan belajar, bukan angka",
    lead: "Bu Guru menilai capaian ananda setiap pekan dan di sentra. Hasilnya tampil dalam tiga tahap, tanpa nilai angka dan tanpa peringkat.",
    steps: [
      { title: "Mampu dan Konsisten", text: "Ananda sudah bisa dan melakukannya dengan ajeg." },
      { title: "Mampu Belum Konsisten", text: "Sudah bisa, masih perlu diulang." },
      { title: "Perlu Penguatan", text: "Bagian yang bisa didampingi bersama di rumah, bukan tanda bahaya." },
    ],
    art: <GrowthMock />,
  },
  {
    id: "rapor",
    nav: "Rapor",
    kicker: "Rapor",
    title: "Rapor setiap triwulan, bisa dibaca dan diunduh",
    lead: "Begitu sekolah menerbitkan rapor, Bapak dan Ibu bisa membacanya di Talib: narasi perkembangan, kehadiran, dan saran kegiatan di rumah.",
    steps: [
      { title: "Baca di ponsel", text: "Lainnya, lalu Rapor. Rapor yang belum terbit tertulis Rapor belum terbit." },
      { title: "Unduh PDF", text: "Untuk dicetak atau disimpan." },
    ],
    art: <ParentReportMock />,
  },
  {
    id: "tagihan",
    nav: "Tagihan",
    kicker: "Tagihan",
    title: "Tagihan: lihat rinciannya, bayar dari ponsel",
    lead: "Setiap tagihan menunjukkan total, yang sudah dibayar, dan sisanya. Ketuk Bayar sekarang untuk membayar lewat DOKU dengan transfer bank (virtual account).",
    steps: [
      { title: "Cari dengan mudah", text: "Saring Belum dibayar, Lewat tempo, atau Lunas, atau cari periode dan nomor tagihan." },
      { title: "Bayar sekarang", text: "Halaman pembayaran DOKU terbuka di tab baru." },
    ],
    art: <ParentInvoiceMock />,
  },
  {
    id: "setelah-bayar",
    nav: "Setelah membayar",
    kicker: "Tagihan",
    title: "Setelah membayar, status diperbarui sendiri",
    lead: "Kembali ke Talib setelah membayar, dan status tagihan diperiksa saat itu juga. Kuitansi tersedia begitu pembayaran diterima. Alhamdulillah, tidak perlu mengirim bukti transfer.",
    steps: [
      { title: "Pembayaran sedang diperiksa", text: "Bila belum langsung lunas, Talib memeriksanya lagi; ketuk Muat ulang status bila perlu." },
      { title: "Link tidak bisa dibuka?", text: "Ketuk Minta link baru. Tagihan tetap ada, tidak hilang." },
      { title: "Kuitansi", text: "Unduh kuitansi PDF dari Bukti pembayaran." },
    ],
    art: <PayResultMock />,
  },
  {
    id: "bantuan",
    nav: "Bantuan",
    kicker: "Bantuan",
    title: "Ada pertanyaan? Sekolah satu ketukan saja",
    lead: "Di Profil ada tombol Chat WhatsApp dan Telepon sekolah ke tata usaha. Data keluarga yang perlu diubah, sampaikan ke sekolah agar dicatat.",
    steps: [
      { title: "Hubungi sekolah", text: "Chat WhatsApp atau Telepon sekolah, dari Lainnya lalu Profil." },
      { title: "Panduan Talib", text: "Panduan ini bisa dibuka lagi dari Profil kapan saja." },
    ],
    art: <ProfileMock />,
  },
  {
    id: "daftar",
    nav: "Mendaftarkan adik",
    kicker: "Pendaftaran",
    title: "Mendaftarkan adik? Formulirnya juga di ponsel",
    lead: "Isi pertanyaan di halaman pendaftaran, lalu sekolah mengirim tautan formulir. Formulir tujuh langkah bisa diisi bertahap, dan biaya pendaftaran dibayar setelah formulir dikirim.",
    steps: [
      { title: "Ketik kode pos", text: "Alamat terisi sendiri. Tidak tahu kode posnya? Ada pencariannya." },
      { title: "Tanda tangan dari ponsel", text: "Ayah dan ibu masing-masing menandatangani, bisa lewat tautan yang dibagikan." },
      { title: "Bayar setelah dikirim", text: "Biaya pendaftaran dibayar lewat DOKU setelah Kirim Formulir." },
    ],
    art: <EnrollFormMock />,
  },
];
