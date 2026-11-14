# UAT Report — Parent portal, local evidence — 2026-11-14

> Persona: Pak Budi, enacted using the synthetic Bu Siti household with three children.
> Jobs run: 6 grouped journeys. 1 blocker, 3 major findings, 1 visual hierarchy finding.
> Build: cached `origin/staging` at `a0afa580`, production-mode Next server and seeded disposable PostgreSQL.

## Summary

The parent portal preserved the selected child across Tagihan, Kehadiran, Jurnal, Rapor via Lainnya, browser Back, and reload. Child-specific payment return also selected the invoice owner when the incoming URL named a different sibling, and unlinked IDs opened no invoice. At 320, 390, and 1440 pixels, the 21 base route visits showed no page-level horizontal overflow. The mobile Rapor reader nevertheless clipped the start of the report and the close control. A simulated provider return also lost its safety message after reload and presented the pay button again, while a note written on a Saturday defaulted to the previous Monday and saved that date.

This run used Chromium with 320×720, 390×844 and 1440×900 CSS-pixel viewports. The review followed ordinary taps, checked touch geometry and selected child, and recorded real write/reload evidence against synthetic data. Provider return was simulated with an unchanged status response, with no gateway call or transfer. The public enrollment form requires a separate invitation fixture.

## Findings

### P-RAPOR-01 — Long reports open with the top and close control off screen

- **Job:** `JTBD-PARENT-REP-01` / indicator-reading follow-up. **Completed:** partial. **Severity:** blocker on mobile.
- **Observation:** As Pak Budi, I tap Buka rapor and land near the last sections of the document, at Rencana Tindak Lanjut, Kehadiran, and Unduh PDF. The title, child identity, beginning of the report and close icon are absent. I scroll up and the view stays in place. I can get the PDF, but I cannot read the full report or close the screen using the intended touch controls.
- **Geometry:** At 390×844, the bottom sheet measured 1,668 px high, `scrollTop=0` and `scrollHeight=clientHeight`. Title was at y=−800 and close at y=−812. At 320×720, height was 1,829 px, title y=−1085 and close y=−1097. Attempting to scroll up left the title at the same coordinate. On desktop the sheet was viewport height, but initial focus on Unduh PDF scrolled it to y=474, hiding the top and close until a manual scroll back. The overlay title only contained the period at each width.
- **Evidence:** [390 px Rapor reader](assets/2026-11-14-parent-ux-local/report-reader-no-child.png), `report-detail.txt`, `parent-visual.log`, `parent-repro.log`. PDF action returned HTTP 200 `application/pdf`.
- **Suggestion:** Use a viewport-bounded reader with an initially visible, named child and period, a persistent close/back control, and an internally scrolling body that starts at the top.

### P-PAY-01 — Reload re-enables payment while confirmation is unresolved

- **Job:** `JTBD-PARENT-INV-00`. **Completed:** partial. **Severity:** major with potential duplicate-payment consequence.
- **Observation:** As Pak Budi, I return for the unchanged, fully unpaid Rp850.000 November invoice and see “Pembayaran sedang diperiksa … tidak perlu bayar lagi.” The app hides Bayar sekarang. After refreshing and reopening the same bill, I see Bayar sekarang with the same balance and no pending explanation. I have conflicting instructions about whether to pay a second time.
- **Reproduction:** Open a linked `SENT` invoice with `paymentStatus=paid`; browser intercepts the payment reconciliation endpoint with `NO_CHANGE`. Wait for the callback parameters to clear, hard reload, and reopen the same invoice. For comparison, the seeded `PAID` invoice correctly shows Lunas and a receipt. A foreign child and invoice return opens no dialog and displays a fallback notice.
- **Evidence:** [First return](assets/2026-11-14-parent-ux-local/payment-return-pending.png), [Same bill after reload](assets/2026-11-14-parent-ux-local/payment-return-refresh.png), `payment-flows.log`.
- **Suggestion:** Preserve a recent attempt’s pending state across reload/reopen and reconcile it before offering another payment action. Show one authoritative balance, the attempt status, and a status-check action in the same place.

### P-JOURNAL-01 — Note composer silently defaults to a stale date and hides recipient identity

- **Job:** `JTBD-PARENT-JOURNAL-03`. **Completed:** partial. **Severity:** major.
- **Observation:** As Pak Budi, I open Tulis catatan on Saturday 14 November to tell Ustadzah that Zafran was sick last night. The generic composer says the teacher will read it, with neither child name nor day-of-week. The date selector has already chosen 9 November, the Monday of the displayed week, and the save succeeds for that stale date.
- **Verified path:** Created and edited `UAT 14 Nov: Anak batuk semalam; sudah sarapan. Uji simpan.` for Ahmad Zafran Hidayat, TKIT A. API response date was `2026-11-09`; edit persisted on reload; cancelling Hapus preserved the note. A separate home-habit tap persisted across reload and was restored. Fixture left for teacher-side handoff verification.
- **Evidence:** [Composer default](assets/2026-11-14-parent-ux-local/note-date-default.png), `journal-note-composer.txt`, `targeted-flows.log`.
- **Suggestion:** Name the child and teacher audience in the composer and require a deliberate date choice whenever today is outside the displayed school days. Show the effective date in the save confirmation.

### P-HOME-01 — Weekend attendance reads like a missing record and competes with overdue bills

- **Jobs:** `JTBD-PARENT-HOME-01` / `JTBD-PARENT-ATT-01`. **Completed:** yes with friction. **Severity:** major.
- **Observation:** On Saturday, the Hari ini section leads with a full-width warning-style attendance row for “Kehadiran Ahmad Zafran Hidayat belum dicatat.” The description repeats the child name and missing-today message. Tapping it shows four present days and one absence for a complete Monday–Friday week. Kehadiran offers “Kembali ke pekan ini” even on that current week and lets me advance to an empty future week. Jurnal disables its future arrow for the same period.
- **Evidence:** [320 px weekend home](assets/2026-11-14-parent-ux-local/home-weekend-320.png), `390-attendance.txt`, `attendance-future-week.txt`. The first child’s Baca catatan begins at y=835 while fixed navigation starts at y=655 at 320×720. At 390×844 the 44 px button begins at y=753 and fixed nav starts at y=779, leaving only its upper 26 px visible before scroll. The overdue bill remains visible as a separate row on both devices.
- **Suggestion:** Use the school calendar to distinguish non-school days from unrecorded attendance, surface genuine exceptions and overdue bills ahead of informational rows, and make date navigation consistent.

### P-PAY-02 — The next bill and paid history take more scanning than needed

- **Jobs:** `JTBD-PARENT-INV-01` / breakdown and paid-history follow-ups. **Completed:** partial within payment guard. **Severity:** visual hierarchy finding.
- **Observation:** The list shows a clear Rupiah balance and sorted due dates. I can find the oldest August bill from the top item and see Total Rp850.000, Sudah dibayar Rp400.000, Sisa Rp450.000. The history entry sits below all four outstanding rows and the fixed nav, at y=870 on 390×844. A paid invoice shows a dated cash entry and Kuitansi.pdf once opened. First choice on the invoice list is a period row; the payable action comes on the next screen, and the oldest partially paid bill’s action is Buat link pembayaran.
- **Evidence:** `invoice-oldest-sheet.txt`, `invoice-paid-sheet.txt`, `flows.log`. Current seed invoice had one line item, so multi-line wrapping was not part of this fixture. No payment-link generation or external link was executed.
- **Suggestion:** Highlight the next bill and use a plainly labeled paid-history entry near the unpaid summary, while preserving the detail’s amount, partial balance, and receipt.

## Timing and coverage

| Action | Measured | Threshold | Verdict |
|---|---:|---:|---|
| 21 base navigations, browser full load | 58–1608 ms | <1500 ms fine | One desktop Rapor load minor |
| 390 px invoices cold open, concurrent audit run | 2774 ms full load | <1500 ms per job | Major sample, repeat did not reproduce |
| 390 px invoices repeat full load | 268 / 478 ms | <1500 ms per job | Fine |
| Home bill → invoices, first run | 1595 ms | >1500 ms major | Major sample |
| Attendance → journal and Journal → Rapor from More, first run | 1562 / 1836 ms | >1500 ms major | Major samples |
| Switch sibling in Tagihan | 275 ms | <1000 ms per job | Fine |
| Invoice row → detail | 233–515 ms | <1500 ms per job | Fine |
| Pending return, browser navigation to visible notice | 289 / 1252 ms | <3000 ms per job | Fine |
| Journal home habit tap to changed cell | 124 ms | <800 ms per job | Fine, persisted after reload |
| Journal create/edit to visible note | 50 / 44 ms | <1000 ms per job | Fine, persisted after reload |
| Buka rapor → rendered sheet | 42–72 ms | <2000 ms per job | Fine timing; mobile geometry blocks reading |

The slower first-run clicks occurred while other browser audit activity was running, so these are local samples for follow-up and cannot establish staging latency. The 21 baseline visits cover home, invoices, attendance, journal, reports, perkembangan list and profile at each width. Another nine route visits covered perkembangan detail, `/guide/parents`, and `/changelog` at each width. All 10 route templates showed zero page-level horizontal overflow in the sampled states. On 390 px, 11 Next actions opened all 12 guide slides. Perkembangan detail for Aisyah led to her Tagihan through the bottom navigation at all three widths. The public `/pendaftaran/[token]` and signature/payment subroutes require an authorized invitation fixture.

Raw text and timing evidence: [local evidence](assets/2026-11-14-parent-ux-local/evidence.txt).

## Heuristic disclaimer

This is synthetic UAT. An LLM persona cannot replicate thumb reach, sunlight
glare, emotional distrust, or network conditions on a 4-year-old phone in
Bekasi traffic. Treat findings as a cheap first pass, not a substitute for
putting the app in front of a real teacher or parent.
