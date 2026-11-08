import type { Release } from "../schema";

const releases: Release[] = [
  {
    id: "2026-11-08",
    headline: "Gerbang, absensi staf, dan putaran sentra",
    items: [
      {
        kind: "baru",
        audience: "semua",
        text: "Buka Apa yang Baru untuk melihat pembaruan Talib yang sesuai dengan peran Anda.",
      },
      {
        kind: "baru",
        audience: "guru",
        text: "Bu Guru bisa membuka Gerbang dari Beranda untuk mencatat kedatangan dan kepulangan anak di kampusnya.",
      },
      {
        kind: "baru",
        audience: "guru",
        text: "Bu Guru yang absen masuk di luar area kampus bisa mengirim catatan untuk persetujuan admin.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mencatat kehadiran staf tanpa akun melalui Absensi Staf Harian.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mengatur putaran kelas dan guru sentra di tiap kampus.",
      },
      {
        kind: "baru",
        audience: "guru",
        text: "Guru sentra bisa mengisi Buku Penghubung untuk kelas yang mengikuti putaran di sentranya.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mengatur tema semester yang berbeda untuk TK A dan TK B atau memakai tema bersama.",
      },
    ],
  },
  {
    id: "2026-11-06",
    headline: "Panduan baru untuk orang tua",
    items: [
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Orang tua bisa membuka panduan singkat 12 slide yang menunjukkan cara memakai Talib, lengkap dengan contoh tampilan layar.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Panduan untuk staf kini 19 slide dan sudah memuat Dasbor, Analitik, cuti siswa, dan pembayaran di muka.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Di dialog Catat pembayaran di muka, tombol Tambah biaya yang nonaktif kini disertai penjelasan dan tautan ke halaman Biaya.",
      },
    ],
  },
  {
    id: "2026-10-31",
    headline: "Cuti siswa, harga paket, dan layar ponsel",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mencatat cuti siswa per bulan; Buat Tagihan tidak menagih siswa yang sedang cuti.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mengatur Harga paket sekolah + daycare di Tarif per Program, dan tagihan memakai harga itu untuk anak yang mengambil keduanya.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Catat pembayaran di muka kini juga bisa mencatat biaya sekali bayar, bukan hanya SPP.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Peringatan Perlu diperiksa pada SPP di muka kini menyebut tagihan yang dimaksud dan menautkannya.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Kolom yang salah diisi kini diberi pesan tepat di kolomnya, dan simpanan yang gagal tetap tersimpan dengan tombol Coba lagi.",
      },
      {
        kind: "lebih-baik",
        audience: "semua",
        text: "Tampilan di ponsel kecil lebih rapi: angka ringkasan muat di kartunya, nama siswa utuh, dan menu Lainnya di halaman Tagihan.",
      },
      {
        kind: "diperbaiki",
        audience: "guru",
        text: "Hapus semua kini meminta konfirmasi dulu, sehingga satu ketukan tidak lagi menghapus semuanya.",
      },
    ],
  },
  {
    id: "2026-10-28",
    headline: "Pembayaran SPP di muka",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa mencatat SPP yang dibayar di muka untuk beberapa bulan sekaligus, dengan pratinjau sebelum disimpan.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Admin bisa mengganti program sebuah kelas, dan Buat Tagihan menampilkan program serta tarif tiap kelas dengan peringatan jika salah tautan.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Pindah kelas dan pendaftaran yang berlangsung bersamaan kini tidak lagi saling bertabrakan.",
      },
    ],
  },
  {
    id: "2026-10-27",
    headline: "Hari tanpa buku penghubung",
    items: [
      {
        kind: "baru",
        audience: "guru",
        text: "Bu Guru bisa menandai hari tanpa buku penghubung beserta keterangannya, misalnya Renang atau Libur, dan hari itu dihitung selesai.",
      },
      {
        kind: "baru",
        audience: "orang-tua",
        text: "Orang tua melihat keterangan hari tanpa buku penghubung di kolom hari itu pada Jurnal, bagian Di sekolah.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Seorang siswa kini dihitung lengkap setelah satu indikator dicentang, jadi Perlu diselesaikan tidak menunggu semuanya terisi.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Admin sekolah kini bisa menambah dan mengubah Tema, Subtema, Pekan, dan Tujuan di Kurikulum.",
      },
    ],
  },
  {
    id: "2026-10-26",
    headline: "Kartu Dibayar Sebagian lebih akurat",
    items: [
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Kartu Dibayar Sebagian di halaman Tagihan kini ikut menghitung tagihan yang sudah dicicil, termasuk yang lewat tempo.",
      },
    ],
  },
  {
    id: "2026-10-24",
    headline: "Pesan pengingat WhatsApp sendiri",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa menulis sendiri pesan pengingat WhatsApp di Pengaturan, dengan pratinjau dan tombol kembali ke pesan bawaan.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Tombol pengingat di halaman Tagihan dan antrean Pengingat WhatsApp kini memakai pesan buatan sekolah itu.",
      },
    ],
  },
  {
    id: "2026-10-22",
    headline: "Dasbor Analitik dan halaman siswa baru",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Dasbor punya bagian Analitik: kehadiran siswa, kelengkapan buku penghubung, serta tagihan dan pembayaran per bulan.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Halaman siswa kini dibagi lima kelompok dengan daftar Perlu perhatian di atas, dan tombol WhatsApp atau telepon ke wali utama.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Halaman Tagihan menampilkan tanggal berlaku link pembayaran, kolom Link berlaku yang bisa diurutkan, dan filter Status yang lebih jelas.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Tagihan yang linknya kedaluwarsa sebelum jatuh tempo kini mendapat link baru, dan Buat link baru tetap bisa dipakai.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Pembayaran online yang masuk ke tagihan yang sudah Lunas atau Dibatalkan kini ditandai Perlu dicek, tidak lagi hilang tanpa jejak.",
      },
    ],
  },
  {
    id: "2026-10-19",
    headline: "Halaman wali yang lebih jelas",
    items: [
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Halaman wali menampilkan Perlu perhatian lebih dulu, serta tombol WhatsApp dan Telepon langsung di bagian atas.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa menautkan anak dari halaman wali dan mengirim pengingat WhatsApp untuk semua tagihan yang belum dibayar.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Daftar anak menampilkan kelas dan jumlah tunggakan masing-masing; pratinjau KTP dan KK hanya dibuka saat Lihat diketuk.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Total tunggakan wali kini menghitung semua tagihan, termasuk keluarga yang punya lebih dari 20 tagihan.",
      },
    ],
  },
];

export default releases;
