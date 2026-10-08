# UAT Report — enrollment-form (parent `/pendaftaran/[token]` + admin Kelengkapan Berkas) — 2026-10-06
> Persona(s): Pak Budi (parent, public token holder), Ibu Nur (admin, SUPER_ADMIN)
> Jobs run: 3  •  Blockers: 0  •  Majors: 1  •  Minors: 6 (current state after the re-test below; first run was Blockers: 2, Majors: 1, Minors: 6)
> Runtime: ~40m first run + ~15m re-test

## Summary
**Current state (after fixes, see "Re-test after fixes"):** no blockers remain. The oversize-file wait, the lost upload on early submit, the hidden handover note, the "Wajib" badges and the buried admin card are fixed. One major remains: a 5 MB phone photo now compresses to 294 KB but still takes 3.9 s to show as uploaded on the 750 kbps uplink, 1.3x over the 3 s budget and bound by uplink bandwidth.

**First run (before fixes):** local `DEMO_MODE` pre-merge run of a production build against a disposable Postgres (staging does not have this code yet), using the Node Playwright runner instead of Playwright MCP. Parent jobs ran on an emulated mid-range Android (390x844, DPR 3, touch) with CPU throttled 4x and a throttled 4G profile (150 ms latency, 1.6 Mbps down, 750 kbps up); the admin job ran on desktop 1366x768 unthrottled. The two-device signature handover works end to end and the admin card behaves correctly. The weak spot is the Berkas upload on a slow uplink: an oversize file takes ~55 s to be refused, a normal compressed phone photo takes 6 s to show as uploaded, and tapping Kirim Formulir while a file is still uploading silently drops that upload. Setup shortcuts: the first four wizard steps were pre-filled through the draft PATCH API, and in ENROL-02 the two signatures were posted through the API (the signature UI was exercised in ENROL-01). Files are stored on the demo disk backend, so server-side storage latency is not representative of Supabase.

## Findings

### JTBD-PARENT-ENROL-02 — Upload kelengkapan berkas and know what still has to be brought to school (oversize file)
- **Persona:** Pak Budi
- **Completed:** yes
- **Severity:** blocker (timing)
- **Observation:** I pick a 5 MB PDF for the KIA. The button says "Mengunggah…" and nothing else for 54.8 seconds, with no progress and no way to cancel. On the train I would assume it is stuck and leave. Then "Ukuran berkas terlalu besar (maks. 4 MB). Coba foto ulang atau kecilkan PDF." appears; the copy itself is clear and in Indonesian. The whole 5 MB body is pushed up the 750 kbps link before the 413 is shown, because the client never checks the size first.
- **Evidence:** measured 54 809 ms from file pick to error text; `assets/2026-10-06-enrollment-form/pdf-5mb-error-after-55s.png`. Code: `components/enrollment/documents-step.tsx` `upload()` (~L104-118) calls `prepareUpload` then `fetch` with no `picked.size > MAX_DOCUMENT_BYTES` guard for PDFs or images that cannot be shrunk; the server only rejects in `app/api/enrollments/token/[token]/documents/route.ts` (~L107-129).
- **Suggestion:** Reject files over `MAX_DOCUMENT_BYTES` in the browser before uploading and show the existing 413 copy immediately.
- **Status after re-test:** fixed. Error now shows in 76 ms with zero requests sent.

### JTBD-PARENT-ENROL-02 — Upload a normal phone photo (slow uplink)
- **Persona:** Pak Budi
- **Completed:** yes
- **Severity:** blocker (timing, per the strict table; the busy state is visible after 86 ms)
- **Observation:** A 4000x3000 JPEG (5.0 MB) is compressed in the browser to 491 KB, well under the 4 MB cap, and shows "kk-big.jpg (491 KB)" with Ganti / Hapus. But from picking the file to seeing that name takes 6.0 s on throttled 4G: the POST alone is 5.4 s, close to the physical floor for 491 KB at 750 kbps (~5.2 s). I do see "Mengunggah…" within 86 ms, so I do not think it is broken, but it is slow, and this is x9 documents.
- **Evidence:** `POST /documents?key=kk` 5405 ms; click-to-name 6016 ms; per-job budget was <3 s (2x over). The only lever is a smaller output: `lib/enrollment/compress-image.ts` uses `MAX_IMAGE_SIDE` 2000 and `JPEG_QUALITY` 0.85.
- **Suggestion:** Target a smaller compressed size for document photos (for example 1600 px / quality 0.7) so a typical photo uploads in about 3 s on this link.
- **Status after re-test:** improved, not closed. At 1600 px / quality 0.8 the file is 294 KB and pick-to-name is 3943 ms (POST 3290 ms), down from 6016 ms. Still over the 3 s budget, so it stays a finding, re-graded **major** (1.3x over the per-job budget; was blocker at 2x). The POST is within ~0.2 s of the physical floor (294 KB at 750 kbps is about 3.1 s), so only a smaller file (about 200 KB or less) would get under 3 s.

### JTBD-PARENT-ENROL-02 — Tap Kirim Formulir while a file is still uploading
- **Persona:** Pak Budi
- **Completed:** partial
- **Severity:** major
- **Observation:** I upload the KK, see "Mengunggah…", and because it is slow I tap Lanjut, Lanjut, Kirim Formulir. Nothing stops or warns me: Tinjau says "Berkas terunggah 0" and the Kirim button is enabled. The form is accepted, the success screen shows, and about 5 s later the upload is rejected with 409 (the token is closed after submit) with no visible message. The KK I waited for is gone; the success screen lists "Kartu Keluarga (KK)" under "Berkas yang perlu dibawa ke sekolah". Admin sees no documents. I would feel the app wasted my upload without telling me.
- **Evidence:** reproduced twice: `POST /submit` 201 (190 ms), then `POST /documents?key=kk` 409 (5436 ms); admin `documents` is `{}`; `assets/2026-10-06-enrollment-form/berkas-upload-lost-on-submit.png`. Code: `app/pendaftaran/[token]/client.tsx` `submit()` (~L341) and the Kirim button (~L491) do not check `docs.busy`; `ReviewStep` does not show in-flight rows.
- **Suggestion:** Disable Kirim Formulir (and say why) while any `docs.busy` entry is set, or at least warn before submitting.
- **Status after re-test:** fixed. See the re-test section.

**Performance — JTBD-PARENT-ENROL-02 (throttled)**
| Action | Metric | Measured | Threshold | Verdict |
|---|---|---|---|---|
| Pick large JPEG → "Mengunggah…" | click-to-visible | 86 ms | <800ms | fine |
| Pick large JPEG → file name shown | click-to-visible | 6016 ms | >3s | blocker |
| `POST /documents` (491 KB after compression) | API | 5405 ms | >2s | blocker |
| Pick 5 MB PDF → error text | click-to-visible | 54 809 ms | >3s | blocker |
| Pick .txt renamed .jpg → error text | click-to-visible | 253 ms (API 415, 187 ms) | <800ms | fine |
| Pick small PDF → file name | click-to-visible | 224 ms (API 171 ms) | <800ms | fine |
| Ganti with small JPEG → new name | click-to-visible | 334 ms (API 196 ms) | <800ms | fine |
| Hapus → "Belum diunggah" | click-to-visible | 310 ms (API 155 ms) | <800ms | fine |
| Lanjut → Tinjau | click-to-visible | 154 ms | <800ms | fine |
| Kirim Formulir → success | click-to-visible | 287 ms (API 164 ms) | <800ms | fine |
| Reload of the form link (warm cache) | page full load | 366 ms | <1.5s | fine |

Other observations for this job, all minor:
- **Minor — Wajib vs opsional.** The step intro says "Mengunggah berkas bersifat opsional", but 9 of 11 rows carry a "Wajib" badge. Lanjut is not blocked, so the badge reads as a contradiction. (Fixed in the re-test.)
- **Minor — Hapus has no confirmation or undo.** One tap removes the upload (it is easy to re-upload, so low risk).
- Works well: a renamed `.txt`/`.docx` gets "Format tidak didukung. Gunakan foto (JPG/PNG) atau PDF." in 253 ms; replace and remove work; the uploaded file persists after reload; Unggah/Ganti/Hapus buttons are all 44 px tall; no horizontal overflow (scrollWidth 390) on Berkas, Tinjau and the success screen; the missing-berkas list on Tinjau and the success screen is correct.

### JTBD-PARENT-ENROL-01 — Sign the enrollment form when Ayah and Ibu are in two different places
- **Persona:** Pak Budi
- **Completed:** yes
- **Severity:** minor
- **Observation:** Phone A signs Ayah and "Tersimpan" shows. A fresh phone B opens the same link, reaches Persetujuan, already sees Ayah as "Tersimpan" with "Tanda tangan sudah tersimpan. Gambar ulang jika ingin mengganti.", signs Ibu, and the handover note disappears. Back on A, "Periksa lagi" shows Ibu's signature in 328 ms and Lanjut, Kirim Formulir go through. Salin link copied the full URL, and "Periksa lagi" with nothing new says "Belum ada tanda tangan baru." The note's wording ("Jika Ibu berada di tempat lain, bagikan link formulir ini… tanda tangan Ayah tidak akan hilang") is clear.
- **Evidence:** `job1.json`; API `POST /signature` 419 ms, `GET /signature` 156-166 ms.
- Minor frictions:
  1. After saving Ayah's signature, the handover note is not on screen: it sits below Ibu's empty pad, 91 px below the fold (note top 935 px vs 844 px viewport). Pak Budi only learns the link can be shared if he scrolls past Ibu's pad. (Fixed in the re-test: the note is now above the pads and on screen; it causes a 196 px layout shift of the pad just saved.)
  2. If he taps Lanjut with one signature, he gets only "Tanda tangan ibu wajib disimpan." at the top of the page (the page scrolls up); the error does not mention sharing the link.
  3. The second parent must tap Lanjut 5 times (about 2.9 s throttled) through steps she has no reason to read before reaching the pads; the link has no jump to Persetujuan.
  4. Timing minors (throttled): cold page full load 2302 ms (A) and 2277 ms (B), about 2.4 s to the first heading; Simpan tanda tangan to "Tersimpan" 901 ms; the Lanjut taps into Data Ibu and Pilihan Program took 992 and 999 ms (CPU-throttled render).
  5. During the first immediate measurement Lanjut/Kirim read 32 px high, but a settled re-probe showed 44 px on every step and on Tinjau, so this was treated as a transition artifact, not a finding.
- Works well: names prefilled on both phones, agreement checkbox state shared, no horizontal overflow on any step at 390 px, signature buttons 44 px, drawing with real touch events works.

**Performance — JTBD-PARENT-ENROL-01 (throttled)**
| Action | Metric | Measured | Threshold | Verdict |
|---|---|---|---|---|
| Open link, phone A (cold) | page full load | 2302 ms | 1.5–2.5s | minor |
| Open link, phone B (cold) | page full load | 2277 ms | 1.5–2.5s | minor |
| Simpan tanda tangan → "Tersimpan" (A, Ayah) | click-to-visible | 901 ms | 800ms–1.5s | minor |
| Simpan tanda tangan → "Tersimpan" (B, Ibu) | click-to-visible | 902 ms | 800ms–1.5s | minor |
| `POST /signature` | API | 419 ms / 420 ms | <500ms | fine |
| Lanjut → Data Ibu / Pilihan Program | click-to-visible | 992 / 999 ms | 800ms–1.5s | minor |
| Periksa lagi, no change → message | click-to-visible | 289 ms | <800ms | fine |
| Periksa lagi → Ibu "Tersimpan" | click-to-visible | 328 ms | <800ms | fine |
| `GET /signature` | API | 156 / 166 ms | <500ms | fine |
| Lanjut → Tinjau | click-to-visible | 105 ms | <800ms | fine |
| Kirim Formulir → success | click-to-visible | 627 ms (API 167 ms) | <800ms | fine |

### JTBD-ADMIN-ADM-02 — Check Kelengkapan Berkas and tick papers received on paper
- **Persona:** Ibu Nur
- **Completed:** yes
- **Severity:** minor
- **Observation:** From the list I click the child, and the card is the last section of the detail page. It reads "1 / 9 berkas lengkap" with one row each in Diunggah / Belum. Lihat opens the uploaded KK in a new tab (200, `image/jpeg`, `private, no-store`, inline). Ticking Akta "Diterima fisik" turns the count to "2 / 9" in 68 ms (PATCH 17 ms) with no reload; Space on a focused KIA checkbox gave "3 / 9" in 16 ms; the ticks survived a reload; unticking returned to "1 / 9". Minor: the card starts at y=1432 of a 2114 px page, so on 1366x768 I scroll about two screens to find it (fixed in the re-test: the card now starts at y=279), and the list shows no per-application berkas count.
- **Evidence:** `job3.json`; `/tmp/pgtalib/uat/ref/4-admin-kelengkapan-card.png` (reference only).

**Performance — JTBD-ADMIN-ADM-02 (desktop, unthrottled)**
| Action | Metric | Measured | Threshold | Verdict |
|---|---|---|---|---|
| Open application detail (3 loads) | page full load | 194 / 102 / 82 ms | <1.5s | fine |
| Click child in list → card visible | click-to-visible | 924 ms | 800ms–1.5s | minor |
| Lihat → file tab loaded | click-to-visible | 88 ms | <800ms | fine |
| Tick Diterima fisik → count updated | click-to-visible | 68 ms (PATCH 17 ms) | <800ms | fine |
| Keyboard Space tick → count updated | click-to-visible | 16 ms | <800ms | fine |

## Heuristic disclaimer
This is synthetic UAT. An LLM persona cannot replicate thumb reach, sunlight
glare, emotional distrust, or network conditions on a 4-year-old phone in
Bekasi traffic. Treat findings as a cheap first pass, not a substitute for
putting the app in front of a real teacher or parent.

## Re-test after fixes (2026-10-06)
Same local production build (fresh), same emulation (mid-range Android, CPU 4x, 150 ms / 1.6 Mbps / 750 kbps), same scripts. Only the checks below were re-run; everything else from the first run is unchanged and was not re-measured.

| Check | Before | After | Verdict |
|---|---|---|---|
| (a) 5 MB PDF, pick to error text | 54 809 ms | 76 ms, 0 document requests sent | fixed (fine) |
| (b) 5.0 MB 4000x3000 JPEG, compressed size | 491 KB | 294 KB (1600 px, q 0.8) | fine, under 4 MB |
| (b) same, `POST /documents` | 5405 ms | 3290 ms | major (>2s API tier, 1.65x over the 2 s per-job budget); bound by uplink |
| (b) same, pick to file name shown | 6016 ms | 3943 ms | major (1.3x over the 3 s budget); bound by uplink. "Mengunggah…" at 86 ms as before |
| (c) Kirim while upload runs | submitted; upload dropped with silent 409; admin `documents` `{}` | Kirim reads "Menunggu unggahan selesai…" (`aria-disabled`); a click sends 0 submit requests; Tinjau shows "Sedang diunggah 3" and "Masih ada berkas yang sedang diunggah. Mohon tunggu sebentar." | fixed |
| (c) after uploads finish | n/a | Kirim returns to "Kirim Formulir", success in 277 ms; admin GET shows `hasFile: true` for kk, ktp_ayah, ktp_ibu; success list names only the 6 missing items | fixed |
| (d) handover note after Ayah saves | top 935 px, outside the 844 px viewport, below Ibu's pad | top 236 px, bottom 416 px, fully inside the viewport, above both pads; Salin link / Periksa lagi 44 px tall | fixed |
| (d) side effect | n/a | the note is inserted above the pad being saved, so the Simpan button moved from y=510 to y=706 (196 px) right after the tap | minor (layout shift) |
| (e) required-item badges | "Wajib" on 9 items | no badge on required items; "Jika ada" on the 2 optional items | fixed |
| (e) admin card position | top at y=1432 of 2114 | top at y=279 (right under the header); 8 of 11 rows inside 1366x768 | fixed |

Notes on the re-test:
- The first attempt at (c) clicked Kirim after the 294 KB upload had already finished, so it proved nothing; it was redone with a synchronous in-page read-and-click while three photos were uploading (each took 8.9–9.2 s because they share the 750 kbps uplink), and Kirim stayed inert throughout.
- Unchanged and not re-tested: the Lanjut-with-one-signature error still reads only "Tanda tangan ibu wajib disimpan." (no mention of sharing the link), the second parent still needs 5 Lanjut taps, Hapus has no confirmation, and the Simpan to "Tersimpan" time (909 ms) is still in the minor tier. The admin card still labels optional rows "Opsional" while the parent form now says "Jika ada" (minor wording mismatch).
- No blocker remains, so no `/spec` follow-up is suggested.
