import type { Release } from "../schema";

const releases: Release[] = [
  {
    id: "2026-09-27",
    headline: "Absensi kelas satu ketuk dan formulir admin lebih jelas",
    items: [
      {
        kind: "baru",
        audience: "guru",
        text: "Bu Guru bisa menandai semua siswa yang belum dicatat Hadir sekali ketuk, lalu memilih H, S, I, atau A untuk yang berbeda.",
      },
      {
        kind: "diperbaiki",
        audience: "guru",
        text: "Absensi satu kelas penuh tidak lagi tertahan di tengah jalan karena terlalu banyak ketukan dalam semenit.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Formulir admin menandai kolom yang salah langsung di tempatnya, dengan pesan berbahasa Indonesia yang jelas.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Admin memilih tanggal lewat kalender dan mengisi nominal dengan pemisah ribuan, tanpa mengetik angka mentah.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Di ponsel, tombol aksi pada daftar admin langsung terlihat tanpa menggeser tabel, dan halaman Biaya lebih mudah dibaca.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Komponen gaji berupa persen dari gaji pokok kini ditolak dengan pesan jelas bila urutannya salah, bukan pesan umum.",
      },
    ],
  },
  {
    id: "2026-09-26",
    headline: "Tampilan baru yang langsung menunjukkan pekerjaan hari ini",
    items: [
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Beranda guru langsung menampilkan kelas hari ini beserta absensi dan Buku Penghubung yang belum selesai.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Beranda orang tua menampilkan kartu tiap anak dengan jalan pintas ke catatan, kehadiran, perkembangan, rapor, dan Tagihan.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Anak yang sedang dipilih tetap terlihat saat berpindah halaman, kembali, atau setelah selesai membayar.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Status pembayaran Tagihan hanya berubah setelah pembayaran benar-benar terkonfirmasi, tidak sekadar kembali dari halaman bayar.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Dasbor admin muat dalam satu layar: jumlah pekerjaan, lima hal paling mendesak, dan ringkasan kehadiran.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Menu admin lebih ringkas; pengaturan awal dikumpulkan di satu halaman Pengaturan, dan dua menu Pendaftaran digabung.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Formulir Tagihan manual yang panjang kini bisa digulir dan tombol Simpan tetap terjangkau di layar kecil.",
      },
    ],
  },
  {
    id: "2026-09-25",
    headline: "Wali utama dan Tagihan untuk siswa baru",
    items: [
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Wali pertama yang ditambahkan ke seorang siswa otomatis menjadi wali utama, penerima Tagihan.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Admin bisa menjadikan wali lain sebagai wali utama dengan satu ketukan lewat tombol Jadikan wali utama.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Wali yang dinonaktifkan tidak lagi dipakai sebagai kontak Tagihan dan pembayaran.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Admin bisa membuat Tagihan manual, misalnya biaya daftar, untuk siswa aktif yang belum punya kelas.",
      },
    ],
  },
  {
    id: "2026-09-09",
    headline: "Halaman siswa lengkap dan Buku Penghubung lebih hidup",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Halaman siswa kini satu catatan lengkap: data kesehatan, biodata wali, Tagihan, Keringanan, dan Buku Penghubung.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Halaman siswa menampilkan ringkasan Kehadiran dan Rapor, serta formulir pendaftaran asli milik anak itu.",
      },
      {
        kind: "baru",
        audience: "semua",
        text: "Catatan Buku Penghubung menjadi percakapan dengan riwayat lengkap dan penanda catatan yang belum dibaca.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Bu Guru langsung masuk ke kelas hari ini, bisa menandai satu siswa lengkap sekali ketuk, dan melihat jumlah siswa yang sudah lengkap.",
      },
      {
        kind: "lebih-baik",
        audience: "semua",
        text: "Setiap layar Buku Penghubung menyebut nama anak dan kelasnya, dan pekan yang dibuka bisa dikembalikan ke pekan ini.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Menonaktifkan atau mengaktifkan pengguna kini meminta konfirmasi dulu agar tidak terjadi salah ketuk.",
      },
    ],
  },
  {
    id: "2026-08-22",
    headline: "Wali, daycare, dan batas jatuh tempo pembayaran",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Saat menambah wali, admin bisa memilih orang tua yang sudah ada, sehingga satu keluarga tidak punya dua profil.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Dari halaman siswa, nama wali bisa dibuka langsung dan saudara kandung terlihat dalam satu baris.",
      },
      {
        kind: "lebih-baik",
        audience: "admin",
        text: "Batas usia program kini hanya peringatan, sehingga anak tetap bisa ditempatkan di kelas yang sesuai kemampuannya.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Seorang siswa bisa terdaftar di kelas sekolah dan daycare sekaligus.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Tombol di atas daftar siswa tidak lagi terpotong; tabel yang lebar kini digulir di dalam kotaknya sendiri.",
      },
      {
        kind: "diperbaiki",
        audience: "orang-tua",
        text: "Nomor Virtual Account kini berlaku sampai tanggal jatuh tempo Tagihan, bukan hanya 7 hari sejak dibuat.",
      },
    ],
  },
  {
    id: "2026-08-19",
    headline: "Portal guru lebih nyaman dipakai dengan satu tangan",
    items: [
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Tombol, isian, dan pilihan di portal guru lebih besar sehingga mudah diketuk saat berdiri di kelas.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Pilihan Mampu, Belum, dan Perlu kini lebih jelas terbaca, termasuk saat belum dipilih.",
      },
      {
        kind: "baru",
        audience: "guru",
        text: "Penilaian Pekanan punya navigasi pekan, sehingga Bu Guru bisa membuka pekan sebelumnya.",
      },
      {
        kind: "diperbaiki",
        audience: "guru",
        text: "Tampilan pekan per siswa tidak lagi selalu bertuliskan Minggu ini saat Bu Guru membuka pekan yang lebih lama.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Judul, tombol, dan keterangan kosong di portal guru diseragamkan, dengan istilah pekan untuk satu pekan sekolah.",
      },
    ],
  },
  {
    id: "2026-08-18",
    headline: "Keringanan, Tagihan massal tiga langkah, dan portal rapi",
    items: [
      {
        kind: "baru",
        audience: "admin",
        text: "Admin mencatat Keringanan per siswa untuk satu tahun ajaran, dan otomatis terpakai setiap Tagihan massal dibuat.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Buat Tagihan kini tiga langkah: pilih kelas atau siswa, tinjau, lalu buat; draf tetap ada walau halaman dimuat ulang.",
      },
      {
        kind: "baru",
        audience: "admin",
        text: "Sebelum dibuat, nominal tiap baris Tagihan bisa diubah, ditambah diskon atau biaya lain, dihitung ulang, atau draf dibuang.",
      },
      {
        kind: "diperbaiki",
        audience: "orang-tua",
        text: "Orang tua kini bisa mengisi bagian Di Rumah pada Buku Penghubung sejak pekan pertama, termasuk hari di pekan lalu.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Jumlah Tagihan tampil lebih tenang dan hanya berwarna merah bila benar-benar lewat tempo.",
      },
      {
        kind: "lebih-baik",
        audience: "orang-tua",
        text: "Tombol dan tulisan di portal orang tua lebih besar dan seragam, dengan istilah pekan untuk satu pekan sekolah.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Logo di menu samping admin terbaca jelas, dan Konversi ke Siswa hanya muncul untuk pendaftar yang sudah diterima.",
      },
    ],
  },
  {
    id: "2026-08-13",
    headline: "Masuk dengan Google dan istilah yang lebih konsisten",
    items: [
      {
        kind: "lebih-baik",
        audience: "semua",
        text: "Halaman masuk kini ringan dan hanya memakai akun Google; kolom email tautan masuk dihapus.",
      },
      {
        kind: "lebih-baik",
        audience: "guru",
        text: "Slip gaji tidak lagi dikirim lewat email; Bu Guru melihatnya di Slip Gaji begitu penggajian disetujui.",
      },
      {
        kind: "lebih-baik",
        audience: "semua",
        text: "Istilah diseragamkan: Rapor, Lewat Tempo, Link Dibuat, dan Bank Narasi untuk kumpulan kalimat narasi rapor.",
      },
      {
        kind: "diperbaiki",
        audience: "semua",
        text: "Pesan kesalahan kini berbahasa Indonesia dengan langkah berikutnya, tidak lagi menampilkan teks teknis.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Link pembayaran hanya dinyatakan berhasil dibuat dan disalin bila benar-benar ada.",
      },
      {
        kind: "diperbaiki",
        audience: "admin",
        text: "Editor rapor memberi peringatan sebelum keluar dengan perubahan belum disimpan, dan dialog penonaktifan memakai kata Nonaktifkan.",
      },
    ],
  },
];

export default releases;
