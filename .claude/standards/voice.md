# Voice & Tone

> Loaded on demand by `/build` when staged paths match `app/**/*.tsx`, `components/**/*.tsx`, `lib/email/**`, `lib/**/messages.ts`, or any file whose diff introduces user-facing copy (toasts, labels, descriptions, empty-state text, email subjects, SMS strings).

**Canonical reference:** `.claude/standards/design-system.html` §18 — persona cards, Islamic courtesy layer, copy-rule tables. This file is the text-only condensation.

## The three audiences

Every piece of user-facing copy lives in one of three portals. Voice shifts with audience — the same action ("Save") reads differently to an ops admin versus a parent.

### Admin — Pak Budi (staff-speak)

**Persona:** desktop, 22 admin routes, comfortable with bulk actions, CSV exports, status taxonomies.

**Voice:** neutral, efficient, technical vocabulary OK. Imperative verbs. Short labels. No pleasantries.

| Do | Don't |
|---|---|
| "Tambah Siswa" | "Yuk tambahkan siswa baru" |
| "Ekspor CSV" | "Unduh file spreadsheet" |
| "Status: DRAFT" | "Statusnya masih draft loh" |
| "Nonaktifkan" | "Matikan akun" |
| Error: "Gagal menyimpan. Periksa kolom yang ditandai." | "Aduh ada masalah nih" |

### Teacher — Bu Guru Sari (collegial, warm-professional)

**Persona:** mobile PWA, arm's-length use during class, respectful honorifics (*Bu Guru / Pak Guru*), action-forward copy.

**Voice:** collegial, uses honorifics, action-oriented imperative, Islamic school context acknowledged but not over-performed.

| Do | Don't |
|---|---|
| "Selamat pagi, Bu Guru Sari" | "Hai Sari" |
| "Ketuk untuk mulai absensi" | "Klik tombol di bawah ini untuk memulai" |
| "Clock-in berhasil · MASUK 07:12" | "Anda telah berhasil melakukan clock-in pada pukul 07:12" |
| "Hadir 25 · Alpa 1 · Sakit 2" | "Status kehadiran hari ini menunjukkan..." |
| "Simpan catatan" | "Submit entry" |

### Parent — Ibu Nur (warmest, most personal)

**Persona:** mobile PWA, occasional check-ins, emotionally invested in the child, intermittent 4G.

**Voice:** warmest of the three. Greets with *Assalamu'alaikum*. Addresses as *Bu/Pak + first name*. Child-framed ("Aisyah hari ini..." not "Your child today..."). Gentle on unpaid invoices, generous on child achievements.

| Do | Don't |
|---|---|
| "Assalamu'alaikum, Ibu Nur" | "Hi there!" |
| "Aisyah hadir di sekolah hari ini" | "Student ID 2024-087 recorded as present" |
| "Tagihan SPP April belum dibayar · jatuh tempo 28 April" | "UNPAID INVOICE — DUE IMMEDIATELY" |
| "Rapor Tengah Semester Aisyah sudah terbit" | "New report card available for download" |
| Error: "Koneksi terputus. Coba lagi sebentar ya." | "Network error 503" |

## Islamic courtesy layer

The school is Islamic PAUD/TKIT. Arabic greetings and honorifics are first-class but **not decorative**.

**Use:**
- *Assalamu'alaikum* — parent greeting on home landing, parent email subject lines, home-note opening.
- *Bu Guru / Pak Guru* — addressing and referring to teachers (header greeting, notification copy, parent→teacher messages). This school does not use *Ustadz/Ustadzah*; never write it in new copy.
- *InsyaAllah* — schedule-dependent promises ("InsyaAllah rapor terbit 30 April").
- *Barakallah* — celebration copy (birthday, achievement, graduation).

**Avoid:**
- Arabic greetings in admin UI (Pak Budi doesn't need *Assalamu'alaikum* on every admin page — it's ops context, not pastoral).
- Honorifics stacked on error toasts ("Bu Guru Sari, maaf sekali, terjadi kesalahan..."). Errors are errors — keep them terse.
- Performative religiosity — don't sprinkle Arabic across every label. Use it where it lands culturally (greetings, gratitude, schedule promises), not as decoration.

**Capitalization — sentence case everywhere.** Buttons, tabs, filter options, select options, status chips, section labels, menu items: capitalise the first word and proper nouns only. "Atur ulang", not "Atur Ulang". "Belum dibayar", not "Belum Dibayar". "Di rumah", not "Di Rumah".

Two carve-outs, and only two:
- **Proper nouns** — Bu Guru / Pak Guru, Rapor as a product surface name, campus and class names, a person's name.
- **Data echoed from the database** — `Invoice.line.labelSnapshot` ("SPP Bulanan"), class names, template titles. Those are values, not UI copy; do not rewrite them on render.

**The rule is portal-agnostic.** It was written during the parent-portal pass and then read as a parent-portal rule — the teacher portal shipped roughly forty Title Case strings on the strength of "staff surfaces are different". They are not. A teacher reads the same Indonesian as a parent. `Buku Penghubung` and `Rapor` stay capitalised because they are product surface names (the first carve-out), not because staff copy gets a looser rule.

The glossary below fixes **which word** to use, not how to capitalise it. A row reading "Lewat Tempo" means *use the phrase "lewat tempo" rather than "menunggak"* — it does not license Title Case at the call site. The `SECTION LABEL` style (uppercase, letter-spaced) is a typographic treatment applied by `components/portal/section-label.tsx`, not capitalisation authored into the string.

**Cross-portal glossary** — the canonical term wins over the English/transliterated alternative:

| Canonical | Avoid |
|---|---|
| Pekan (a school week — "pekan ini", "Senin pekan lalu", week navigator labels) | Minggu (ambiguous: *Minggu* is also Sunday, so "Minggu lalu" reads as "last Sunday" to half the audience. Keep **Minggu** only where it genuinely names the weekday, e.g. a date formatter's day names.) |
| Hadir (attendance present) | Present, Attended |
| Alpa (attendance absent) | Absent, Tidak Hadir |
| Sakit | Sick, Ill |
| Izin | Permission, Excused |
| Tagihan | Invoice, Bill (use Tagihan for parent; Invoice ok in admin) |
| Kehadiran (the attendance *record* — history, recap, a parent's view) | Attendance |
| Absensi (the *act* of taking roll — a teacher's task surface) | — (this is a real distinction, not drift: "Absensi Kelas" is the screen where a teacher marks; "Kehadiran" is what the marking produced. Do not collapse them into one word.) |
| Rapor | Raport, Report card (Raport is a Dutch-derived misspelling; KBBI and this glossary both say Rapor. This rule governs UI strings only — routes, API paths, params, and other code identifiers are English (`report-cards`, not `raport`/`rapor`); see CLAUDE.md's English-identifiers rule. Existing internal module names such as `lib/raport/*` are legacy and stay until touched) |
| Bank Narasi (the reusable raport narrative library) | Kisi-kisi (means an *exam blueprint* in Indonesian school practice — an actively misleading name for a sentence library), Templat Narasi |
| Lewat Tempo (invoice status: past its due date) | Jatuh Tempo, Terlambat, Menunggak ("Jatuh tempo" is the due *date* itself — reusing it as a status makes the badge and the date caption on the same row indistinguishable) |
| Link Dibuat (invoice status: a payment link exists) | Terkirim (nothing is sent — DOKU dispatches no notification and the admin shares the link manually; "Terkirim" overclaims delivery) |
| Perkembangan (parent-facing developmental progress) | Capaian (keep Capaian only for the per-element achievement level inside the page, never as the nav or page label) |
| Wali | Guardian, Parent (Wali = registered guardian; Parent = audience) |
| Kelas | Class, Classroom |
| Ketuk (tap an on-screen control) | Tap ("Tap Masuk" shipped on the session roster for a year — the rest of the app has always said Ketuk) |
| Bu Guru / Pak Guru | Ustadz / Ustadzah (not used at this school, even though it is an Islamic school; the teachers are *Bu Guru*, and *Pak Guru* is the male form should one join) |
| Catatan (data row, log entry, journal note) | Record |
| Pertanyaan (admission lifecycle: first contact; the thing staff *catat* — button "Catat Pertanyaan", dashboard tile "Pertanyaan pendaftaran baru") | Inquiry (the lead's stage chip itself reads **Baru**, see the Tahap rows below) |
| Tahap (the derived stage column and filter on the Pendaftaran list) | Status, Stage (the lead only stores Baru / Batal; Tahap is read from the lead, its formulir and the student link, never clicked) |
| Baru (Tahap: a lead with no formulir sent yet) | Pertanyaan as a stage chip, Inquiry, Kunjungan dijadwalkan, Sudah berkunjung (the visit steps are retired) |
| Formulir dikirim (Tahap: the link is out, the parent has not submitted) | Undangan terkirim, Invited |
| Formulir masuk (Tahap: the parent, or staff on their behalf, submitted the formulir) | Sedang ditinjau, Dalam tinjauan, Under review (there is no review step to click) |
| Diterima (Tahap: accepted, student not created yet — normally brief, convert accepts and creates in one step) | Admitted, Disetujui |
| Siswa (Tahap: converted, the student exists; row action "Lihat siswa") | Terdaftar, Registered, Enrolled |
| Belum bayar (the Pendaftaran Pembayaran filter and count: a formulir fee that exists and is not settled) | Tertunda, Pending, Unpaid |
| Menunggu pembayaran (parent payment page only: back from DOKU, payment not confirmed yet; the Pendaftaran list has no such card) | Tertunda, Pending |
| Tandai lunas (staff settle the formulir fee in cash or transfer, from the fee card after the parent submitted; asks once more because it cannot be undone) | Bayar manual, Mark paid |
| Bebaskan biaya (staff waive the formulir fee from the fee card after the parent submitted; the parent's link then shows no payment due) | Gratiskan, Hapus biaya |
| Kode pos (address box: 5 digits, typing it fills Kelurahan / Desa, Kecamatan, Kota / Kabupaten and Provinsi; the helper link reads "Tidak tahu kode pos?") | Zip code, Postal code, Kodepos |
| Kelurahan / Desa (address box; a dropdown when a kode pos covers several) | Kelurahan, Desa as two separate boxes, Village, Sub-district |
| Ubah data (staff edit any field of a formulir before the student exists) | Edit formulir, Koreksi (Edit stays the generic word for ordinary forms) |
| Tandai formulir masuk (staff submit on the parent's behalf; consent is noted as "disetujui langsung di sekolah", never a drawn signature) | Submit atas nama, Paksa kirim |
| Terima & Jadikan Siswa (the one convert action: accept the formulir and create the student and wali links, one confirm) | Konversi ke Siswa, Mulai Tinjau + Terima + Konversi (the three old clicks) |
| Perencanaan (academic-year status pre-launch) | Planning |
| Templat (assessment / journal template) | Template (the `t` at the end softens Indonesian — both are acceptable but Templat is the canonical loanword form) |
| Timpa (override an attendance / data entry) | Override, Timpa (Override) (the bilingual gloss is redundant once Timpa is established) |

### Assessment skala (3-level)

The early-childhood assessment scale is **CONSISTENT / EMERGING / NEEDS_REINFORCEMENT**. Single source: `lib/curriculum/level-presentation.ts`. Labels + tone:

| Level | Short (tap-button) | Long (raport, PDF, parent) | Tone |
|---|---|---|---|
| CONSISTENT | Mampu | Mampu dan Konsisten | present (green) |
| EMERGING | Belum | Mampu Belum Konsisten | late (amber) |
| NEEDS_REINFORCEMENT | Perlu | Perlu Penguatan | **leave (info-blue) — NOT red, NOT teal** |

**Voice call:** NEEDS_REINFORCEMENT renders info-blue everywhere. "Perlu Penguatan" is an honest developmental note to a parent (Ibu Nur reads it on the raport), not an alarm — red is reserved for attendance *Alpa* and destructive actions. Never recolor it absent-red or praise-teal on any surface (screen or PDF).

## Cross-cutting copy rules

### Acronyms

Expand on **first use per surface**, then abbreviate freely. `IKTP` reads as noise to a classroom teacher who is not a curriculum specialist; `Indikator Ketercapaian (IKTP)` costs three words once and is then free for the rest of the page. Same rule for any payroll or curriculum shorthand (`DC`, `TP`, `PROMES`). An acronym that cannot be expanded in a label needs a tooltip.

### Nav label ↔ page title

**The word on the tab is the word on the page.** A user who taps "Kelas" and lands on "Absensi Kelas" has to re-derive where they are; one who taps "Capaian" and lands on "Perkembangan" cannot build a map of the product at all. When a nav slot is too narrow for the full title, shorten the *title* too, or use the short form in both places — never let them diverge.

### Never render a caught error

Raw `err.message`, vendor payloads (Xendit, DOKU), Prisma model names, HTTP status text, and Zod defaults are **log-only**. Every user-visible error is written by us, in Indonesian, and names a next action. Route caught errors through a translate-or-generic-fallback helper — the `userMessage()` pattern in `lib/api/client-errors.ts` is the model. A clean Indonesian prefix with a raw English message spliced onto the end is still a leak.

### Shared-component defaults

A default string in `components/ui/**` ships to every caller that omits the prop. Defaults must satisfy these rules on their own — `emptyTitle = "Tidak ada data"` violates the Empty State Contract for every list that trusts it. Enum→label maps must cover **every** value the enum can hold, not only the ones with a current UI consumer; a missing entry renders the raw code.

### Errors

- **Always actionable.** Tell the user what to do next, or tell them it's safe to retry.
- **Tone scales with audience.** Admin gets terse; parent gets gentle.
- **Never expose status codes.** `Network error 503` is not a user message.

| Audience | Good | Bad |
|---|---|---|
| Admin | "Gagal menyimpan. Periksa kolom yang ditandai." | "Validation error: name is required" |
| Teacher | "Absensi tidak tersimpan. Coba ketuk ulang ya." | "PATCH /api/attendance failed" |
| Parent | "Koneksi terputus. Coba lagi sebentar ya." | "Network error 503" |

### Empty states

- **Never "No data."** Always say WHY it's empty and WHAT happens when data arrives.
- **Action CTA when the user can fix it.** "Tambah Siswa Pertama" beats "Belum ada siswa".

| Audience | Good | Bad |
|---|---|---|
| Admin | "Belum ada siswa terdaftar. Klik Tambah Siswa untuk mulai." | "No data" |
| Teacher | "Belum ada kelas terjadwal hari ini." | "Empty schedule" |
| Parent | "Belum ada tagihan bulan ini. Alhamdulillah, semua lunas." | "No invoices found" |

### Success toasts

- **Past-tense state, not imperative.** "Tersimpan" beats "Save successful".
- **Short. One line.** Details belong in the entity, not the toast.

| Audience | Good | Bad |
|---|---|---|
| Admin | "Siswa ditambahkan." | "Successfully created new student record" |
| Teacher | "Absensi tersimpan · 25 siswa" | "Attendance submission complete" |
| Parent | "Pembayaran diterima · Alhamdulillah" | "Transaction processed" |

### Destructive confirmations

- **Always `<AlertDialog>`.** Never `<Dialog>`, never `window.confirm()`.
- **State the consequence explicitly.** "Data tidak bisa dikembalikan" when irreversible; "Bisa diaktifkan kembali" when soft-delete.
- **Cancel-left, destructive-right.** Destructive button uses red (`variant="destructive"`).

| Scenario | AlertDialog copy |
|---|---|
| Hard delete (rare) | Title: "Hapus permanen?" · Body: "Aksi ini tidak bisa dibatalkan. Data akan hilang selamanya." |
| Soft delete / deactivate | Title: "Nonaktifkan siswa?" · Body: "Siswa tidak akan muncul di daftar aktif. Bisa diaktifkan kembali kapan saja." |
| Void invoice | Title: "Batalkan tagihan?" · Body: "Tagihan tidak bisa dibayar lagi. Riwayat tetap tersimpan." |

### Notification / Email / SMS channel voice

Channel constraints shape voice. Same event, three different strings:

| Channel | Rapor published event |
|---|---|
| In-app toast (parent) | "Rapor Aisyah sudah terbit · Lihat" |
| Email subject | "Rapor Tengah Semester — Aisyah Nuraini" |
| Email body opener | "Assalamu'alaikum Ibu Nur, rapor tengah semester Aisyah sudah terbit. InsyaAllah bisa diunduh dari aplikasi." |
| SMS | "Rapor Aisyah terbit. Cek apps.annisaa.sch.id" |

**SMS rules:** ≤160 chars · no Arabic greetings (transliteration often renders poorly on old handsets) · always include the short URL.

## Review gate

On every PR that touches user-facing copy (toasts, labels, descriptions, empty-state text, email subjects, SMS strings), the author confirms in the cycle doc Verification section:

- [ ] Audience identified (admin / teacher / parent) and voice matches the table above.
- [ ] Glossary terms canonical (Hadir not Present, Tagihan not Invoice for parent, etc.).
- [ ] Islamic courtesy layer applied where it lands (parent greetings, email openers, celebration events) — not sprinkled as decoration.
- [ ] Error/empty/success/destructive copy follows the cross-cutting tables above.
