import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan",
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <>
      <h1>Syarat &amp; Ketentuan</h1>
      <p className="text-sm text-muted-foreground">
        Berlaku sejak: 2 Mei 2026
      </p>

      <h2>1. Tentang Layanan</h2>
      <p>
        Talib (&quot;Layanan&quot;) adalah platform manajemen sekolah yang
        dioperasikan oleh An Nisaa&apos; Sekolahku
        (&quot;Penyelenggara&quot;) untuk mendukung kegiatan belajar mengajar,
        administrasi keuangan, dan komunikasi antara sekolah, guru, dan orang
        tua peserta didik.
      </p>

      <h2>2. Penggunaan</h2>
      <p>
        Akses Layanan diberikan kepada staf, guru, dan orang tua peserta didik
        An Nisaa&apos; Sekolahku berdasarkan undangan. Pengguna bertanggung
        jawab atas kerahasiaan kredensial akun masing-masing.
      </p>

      <h2>3. Pembayaran</h2>
      <p>
        Pembayaran tagihan diproses melalui DOKU (PT Nusa Satu Inti Artha)
        sebagai mitra gerbang pembayaran. Penyelenggara tidak menyimpan data
        kartu atau rekening bank pengguna.
      </p>

      <h2>4. Pembatasan Tanggung Jawab</h2>
      <p>
        Layanan disediakan apa adanya. Penyelenggara tidak bertanggung jawab
        atas gangguan layanan yang disebabkan oleh pihak ketiga (penyedia
        hosting, gerbang pembayaran, atau jaringan internet pengguna).
      </p>

      <h2>5. Perubahan</h2>
      <p>
        Penyelenggara dapat memperbarui Syarat &amp; Ketentuan ini sewaktu-waktu.
        Perubahan akan diumumkan di halaman ini.
      </p>

      <h2>6. Kontak</h2>
      <p>
        Pertanyaan terkait Syarat &amp; Ketentuan dapat disampaikan melalui
        email <a href="mailto:admin@annisaasekolahku.com">admin@annisaasekolahku.com</a>.
      </p>
    </>
  );
}
