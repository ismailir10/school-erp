import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <>
      <h1>Kebijakan Privasi</h1>
      <p className="text-sm text-muted-foreground">
        Berlaku sejak: 8 Oktober 2026 · Tunduk pada UU No. 27 Tahun 2022 tentang
        Pelindungan Data Pribadi.
      </p>

      <h2>1. Pengendali Data</h2>
      <p>
        An Nisaa&apos; Sekolahku adalah pengendali data pribadi yang dikumpulkan
        melalui Layanan Talib.
      </p>

      <h2>2. Data yang Dikumpulkan</h2>
      <ul>
        <li>Identitas: nama, email, nomor telepon, NIS / NIP</li>
        <li>Akademik: kelas, kehadiran, jurnal, nilai (sebatas yang relevan)</li>
        <li>Keuangan: tagihan, status pembayaran, riwayat transaksi (TIDAK termasuk data kartu/rekening)</li>
      </ul>

      <h2>3. Tujuan Pemrosesan</h2>
      <p>
        Data digunakan untuk operasional sekolah: pencatatan kehadiran,
        pengelolaan tagihan, komunikasi orang tua, dan pelaporan internal.
      </p>

      <h2>4. Pihak Ketiga</h2>
      <p>
        Untuk menjalankan Layanan, kami menggunakan penyedia berikut. Setiap
        penyedia hanya menerima data minimum yang diperlukan untuk fungsinya:
      </p>
      <ul>
        <li><strong>Supabase</strong> — basis data &amp; autentikasi (host: Singapura)</li>
        <li><strong>Vercel</strong> — hosting aplikasi (host: Singapura)</li>
        <li><strong>DOKU (PT Nusa Satu Inti Artha)</strong> — pemrosesan pembayaran (host: Indonesia)</li>
        <li><strong>Resend</strong> — pengiriman email transaksional</li>
        <li><strong>Cloudflare R2</strong> — penyimpanan cadangan terenkripsi</li>
      </ul>

      <h2>5. Hak Pengguna (UU PDP)</h2>
      <p>
        Sesuai UU PDP, pengguna berhak: (a) mengakses data pribadi, (b)
        meminta perbaikan, (c) menarik persetujuan, (d) meminta penghapusan
        akun. Permintaan dapat diajukan melalui email{" "}
        <a href="mailto:admin@annisaasekolahku.com">admin@annisaasekolahku.com</a>.
      </p>

      <h2>6. Retensi</h2>
      <p>
        Data akademik disimpan selama peserta didik aktif di An Nisaa&apos;
        Sekolahku, ditambah 1 tahun untuk keperluan arsip. Data keuangan
        disimpan minimum 5 tahun sesuai ketentuan perpajakan. Cadangan
        terenkripsi disimpan 30 hari.
      </p>

      <h2>7. Keamanan</h2>
      <p>
        Data dienkripsi saat dikirim (TLS) dan saat disimpan (Supabase + R2).
        Akses internal dibatasi pada staf yang diberi wewenang.
      </p>

      <h2>8. Foto &amp; Video Kegiatan</h2>
      <p>
        Sekolah dapat mengambil foto dan video peserta didik saat kegiatan
        sekolah. Hasilnya digunakan untuk dokumentasi dan media sosial
        sekolah. Dasarnya adalah persetujuan orang tua/wali yang diberikan
        saat pendaftaran melalui Surat Persetujuan Orang Tua (butir 17).
      </p>
      <p>
        Orang tua/wali dapat meminta pembatasan penggunaan foto atau video
        ananda kapan saja dengan menyampaikannya kepada wali kelas. Permintaan
        juga dapat diajukan melalui kontak sekolah pada bagian 5.
      </p>

      <h2>9. Perubahan Kebijakan</h2>
      <p>
        Perubahan akan diumumkan di halaman ini dan, untuk perubahan material,
        dikomunikasikan melalui email.
      </p>
    </>
  );
}
