/**
 * "Surat Persetujuan Orang Tua" — the 17 consent clauses: the 16 from the An
 * Nisaa' paper admission form, transcribed verbatim, plus the photo/video
 * clause added in v2. Rendered on the consent step of
 * the public form; the parent must explicitly agree and sign (both Ayah + Ibu, or the one
 * parent / wali filling alone — see `onlyParent` in submit-validation.ts).
 *
 * CONSENT_VERSION is stored on each application's consentData so a future
 * wording change is auditable — an application records which clause set the
 * parent actually agreed to. Bump the version (do NOT mutate clauses in place)
 * when the school revises the letter. (R2-P-15 fixed typos in clauses 4, 5, 7 and
 * 12 without changing their meaning, so the version was deliberately kept.)
 *
 * v2 added clause 17 (photos and videos of the child from school activities,
 * for documentation and the school's social media). That changes what the
 * parent agrees to, so the version was bumped and a draft saved under v1 comes
 * back with the agreement box unticked (see `initConsent` in the form).
 */

export const CONSENT_VERSION = "annisaa-2026-v2";

export const CONSENT_INTRO =
  "Bismillahirrahmanirrahim. Bersama ini kami menyetujui sebagaimana yang tercantum di bawah ini:";

export const CONSENT_CLOSING =
  "Kami sudah membaca dan memahami dengan baik isi Surat Persetujuan ini.";

export const CONSENT_CLAUSES: readonly string[] = [
  "Berkomunikasi dan dapat bekerja sama dengan baik & santun dengan guru.",
  "Aktif mengisi Buku Penghubung.",
  "Mendampingi anak di rumah dalam mengulang kegiatan sebagaimana yang ada di Buku Penghubung.",
  "Menghadiri dan berpartisipasi aktif dalam setiap kegiatan sekolah, termasuk pertemuan Parenting; jika berhalangan, mohon memberi informasi ketidakhadiran kepada Wali Kelas.",
  "Meluangkan waktu saat guru melakukan Home Visit (diterima oleh ayah atau ibu). Melakukan Home Visit adalah tanggung jawab guru sebagai bagian dari pengenalan lingkungan keluarga dan rumah; selain itu, Home Visit adalah hak orang tua.",
  "Memenuhi undangan sekolah jika ada hal yang diperlukan.",
  "Mengambil Buku Laporan Perkembangan Anak sendiri (tidak diwakilkan), sesuai dengan jadwal.",
  "Memberi penguatan kepada anak tentang akhlakul karimah: bertaqwa & bersyukur sebagai hamba ciptaan Allah, sopan & santun kepada orang tua & guru, sayang kepada sesama, jujur, mandiri, percaya diri dan lain-lain.",
  "Membayar uang sekolah tepat waktu, sebagai bagian dari ikhtiar untuk kelancaran proses pendidikan anak dan agar ilmu yang diterima menjadi ilmu yang bermanfaat.",
  "Uang yang sudah dibayarkan ke sekolah, jika mengundurkan diri, mengikuti ketentuan yang ada.",
  "Mengikhlaskan kepada sekolah snack yang tidak dimakan anak karena tidak mau / tidak suka atau karena tidak masuk ke sekolah. Snack akan ditawarkan terlebih dahulu kepada anak-anak; kalau masih berlebih akan menjadi milik sekolah.",
  "Pembayaran snack yang flat setiap bulannya didasarkan pada perhitungan rata-rata hari sekolah dalam 1 bulan selama 1 tahun. Lebih dan kurangnya perhitungan pembayaran flat akan saling dimaafkan / diikhlaskan antara sekolah dan wali murid.",
  "Setiap kejadian yang terjadi di sekolah yang menyangkut anak akan diselesaikan secara musyawarah di sekolah dengan difasilitasi sekolah.",
  "Menghormati dan bersikap santun kepada guru, sesama wali murid dan anak-anak.",
  "Mematuhi dan menaati peraturan sekolah.",
  "Menjaga nama baik sekolah di manapun berada.",
  "Dengan mendaftar, kami mengizinkan sekolah menggunakan foto dan video ananda dari kegiatan sekolah untuk dokumentasi dan media sosial sekolah. Jika ingin membatasi, kami dapat menyampaikannya kepada Wali Kelas kapan saja.",
] as const;

export const CONSENT_CLAUSE_COUNT = CONSENT_CLAUSES.length; // 17
