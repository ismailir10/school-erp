import type { Release } from "../schema";
import { MAINTENANCE_ITEM } from "../schema";

const releases: Release[] = [
  {
    id: "2026-10-18",
    headline: "Pengingat WhatsApp dan tautan bayar otomatis",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mengingatkan keluarga lewat WhatsApp dari daftar Tagihan, satu ketukan per keluarga, dan yang sudah diingatkan tercatat.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Tagihan belum lunas yang belum punya tautan pembayaran kini dibuatkan tautan baru otomatis setiap malam.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Tautan pembayaran untuk Tagihan yang sudah lewat jatuh tempo kini berlaku 7 hari, jadi ada waktu cukup untuk membayar.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Tagihan yang masih ada sisa setelah jatuh tempo kini berstatus Lewat Tempo, juga yang sudah dibayar sebagian.",
      },
    ],
  },
  {
    id: "2026-10-17",
    headline: "Tautan pembayaran kedaluwarsa dan tampilan ponsel",
    items: [
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Tagihan yang tautan bayarnya kedaluwarsa tetap dihitung belum lunas, dan menjadi Lewat Tempo bila sudah lewat jatuh tempo.",
      },
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Orang tua bisa membuat tautan pembayaran baru sendiri saat tautan lama tidak bisa dibuka atau belum ada.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa membuat tautan pembayaran untuk banyak Tagihan sekaligus dan memeriksa status pembayarannya dari daftar Tagihan.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Status pembayaran langsung diperiksa saat orang tua kembali dari halaman bayar, tanpa menunggu pengecekan malam hari.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Pengecekan pembayaran dan penandaan Tagihan Lewat Tempo setiap malam kini benar-benar berjalan.",
      },
      {
        kind: "lebih-baik",
        audience: "semua",
        text: "Tampilan di ponsel lebih konsisten: tombol mudah diketuk, tabel tidak terpotong, kartu ringkasan seragam.",
      },
    ],
  },
  {
    id: "2026-10-16",
    headline: "Pemeliharaan",
    items: [MAINTENANCE_ITEM],
  },
  {
    id: "2026-10-15",
    headline: "Pendaftaran lebih sederhana, bayar setelah formulir",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Catat Pertanyaan cukup dengan nama orang tua dan satu kontak, dan satu daftar menampilkan Tahap serta Pembayaran tiap calon siswa.",
      },
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Orang tua mengisi formulir lebih dulu, memilih Program dan Day Care di dalamnya, lalu membayar biaya pendaftaran setelah formulir dikirim.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Biaya pendaftaran diatur per program, bisa ditandai lunas atau dibebaskan, dan pengingatnya bisa dikirim lewat WhatsApp.",
      },
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Mengetik kode pos mengisi otomatis Kelurahan, Kecamatan, Kota atau Kabupaten, dan Provinsi pada formulir.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Panduan Talib: tur sepuluh slide yang bisa dibuka setelah masuk untuk mengenal alur kerja sekolah.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Halaman daftar dan formulir undangan menampilkan foto sekolah dan tampil lebih rapi di ponsel.",
      },
      {
        kind: "diperbaiki",
        audience: "semua",
        text: "Tanggal pada kuitansi, rapor, dan kehadiran bulan ini kini mengikuti hari WIB, tidak salah hari sebelum pukul 07.00.",
      },
    ],
  },
  {
    id: "2026-10-08",
    headline: "Formulir pendaftaran lengkap dan data lebih terjaga",
    items: [
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Orang tua bisa mengunggah kelengkapan berkas, dan tanda tangan Ayah dan Ibu bisa diisi bergantian lewat link yang dibagikan.",
      },
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Formulir pendaftaran punya pilihan hanya satu orang tua atau wali, dan surat persetujuan kini memuat izin foto dan video kegiatan.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Siswa yang sudah keluar atau lulus tidak bisa didaftarkan ke kelas, NIS ganda ditolak, dan kapasitas kelas serta tahun ajaran dijaga.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Catat Pembayaran punya Tanggal bayar, dan admin bisa mengunduh kuitansi PDF dari halaman Tagihan.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Isian Rupiah terbaca benar, baris Rp 0 tidak ditagih, hanya siswa aktif yang ditagih, dan tanggal admin mengikuti WIB.",
      },
      {
        kind: "diperbaiki",
        audience: "guru",
        text: "Absensi hanya menyimpan baris yang diubah dan memberi peringatan sebelum keluar bila ada yang belum disimpan.",
      },
      {
        kind: "diperbaiki",
        audience: "orang-tua",
        text: "Beranda menunjukkan berapa Tagihan yang lewat tempo, kuitansi memakai istilah Indonesia, dan kontak sekolah selalu tersedia.",
      },
    ],
  },
  {
    id: "2026-10-01",
    headline: "Daftar guru kelas dan animasi dasbor",
    items: [
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Admin sekolah kini melihat daftar guru saat menambah guru ke kelas, tidak lagi muncul Tidak ada guru tersedia.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Angka ringkasan di dasbor dan halaman admin berhitung naik dengan halus, dan kartunya menyala lembut saat disentuh kursor.",
      },
    ],
  },
  {
    id: "2026-09-30",
    headline: "Pembayaran lebih aman, jurnal kelas sekaligus",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa membatalkan pembayaran manual yang salah catat dengan alasan, dan pembayaran itu tampil dicoret di riwayat.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Catat Pembayaran punya langkah periksa ulang sebelum disimpan, dan daftar Tagihan menampilkan Piutang serta Diterima bulan ini.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Tagihan Lewat Tempo yang belum ada pembayarannya kini bisa dibatalkan langsung dari daftar atau halaman Tagihan.",
      },
      {
        kind: "baru",
        audience: "guru",
        text: "Bu Guru bisa menandai jurnal untuk satu kelas sekaligus dengan Batalkan, dan mengubah atau menghapus catatan miliknya.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Struktur gaji karyawan baru bisa diisi dari halaman karyawan, dan komponen gaji yang dikosongkan benar-benar terhapus.",
      },
      {
        kind: "diperbaiki",
        audience: "semua",
        text: "Jam tampil dalam WIB, total Tagihan Manual sesuai isian, dan hitungan Alpa serta karyawan kini tepat.",
      },
      {
        kind: "diperbaiki",
        audience: "semua",
        text: "Keluar dari akun benar-benar mengakhiri sesi, dan karyawan yang dinonaktifkan tidak bisa lagi masuk.",
      },
    ],
  },
];

export default releases;
