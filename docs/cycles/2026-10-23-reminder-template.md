# Editable WhatsApp reminder template

## Context
Admins chase unpaid invoices with the "Chat WhatsApp" button on the invoice page and the "Pengingat WhatsApp" queue. The message those buttons prefill is fixed in code, so a school that wants its own wording (a different greeting, a bank-transfer line, a signature) has to ask a developer. The wording should be the school's to change.

Three places build this one message today: the invoice detail page, the reminder queue, and the "record this reminder" action. All three must use the school's wording or the admin sees one text in the preview and sends another.

## Decisions
1. **One template per school, edited on a small settings page** under Pengaturan, next to the other finance/pendaftaran settings. Plain text box, placeholders in curly braces, a live preview, and "Kembalikan ke bawaan".
2. **Placeholders (fixed list):** `{wali}` (Bapak/Ibu + name), `{siswa}`, `{periode}`, `{nomor}`, `{sisa}` (amount left, formatted Rupiah), `{tautan}` (payment link, or the parent portal when there is none). Shown as tap-to-insert chips so nobody has to remember them.
3. **Empty or never edited = today's wording**, so nothing changes for a school that does nothing, and the default stays in one place.
4. **Unknown or misspelled placeholders are rejected on save** with the offending name, instead of reaching a parent as literal `{sisaa}`. `{tautan}` is required: a reminder with nowhere to pay is the one mistake worth blocking.
5. **Who can edit:** anyone who can send reminders today (`payments.record`), the people who own this wording day to day.
6. **Length cap 1000 characters** (WhatsApp links break on very long prefilled text).
7. **The Pengingat WhatsApp modal tells the admin the message is editable** (user request): a line under the title, "Isi pesan bisa disesuaikan…", with the link "Ubah templat pesan" to the editor. Shown in every state of the modal (loading, empty, list), so the admin always sees it.
8. **The editor has a real UI preview** (user request): a WhatsApp-style chat bubble beside the text box (below it on a phone), filled with sample data, with the payment link styled as a link. It updates as the admin types.
9. **Saving blank text, or the built-in text unchanged, stores nothing** (null), so a school that resets keeps following the default.

## Acceptance criteria
- [ ] The Pengingat WhatsApp modal says the message can be customised and links to the template page.
- [ ] An admin opens Pengaturan → Templat Pengingat WhatsApp, sees the current message (the default on first visit), edits it and saves.
- [ ] After saving, the invoice page button, the reminder queue rows and the "record reminder" action all open WhatsApp with the new wording, placeholders filled in for that invoice.
- [ ] The page shows a chat-bubble preview filled with sample data that updates as the admin types.
- [ ] Tapping a placeholder chip inserts it at the cursor.
- [ ] Saving with an unknown placeholder, without `{tautan}`, or over the length cap is refused with a clear message in Indonesian; nothing is stored.
- [ ] "Kembalikan ke bawaan" restores the original wording.
- [ ] A school that never edits sees exactly the current message.
- [ ] One school's template never appears in another's reminders; a user without `payments.record` cannot read or change it.

## Verify flows
0. Admin: Pengingat WhatsApp modal on the invoice list → read the line about editing → tap Ubah templat pesan → land on the template page.
1. Admin (school admin): Pengaturan → Templat Pengingat WhatsApp → change the greeting, add a line, save → open an unpaid invoice → Chat WhatsApp → the link's text carries the new wording and that invoice's name, amount and link.
2. Same admin: queue page → a row's WhatsApp link carries the same new wording.
3. Edge: remove `{tautan}` and save → refused, message names the missing placeholder; stored template unchanged.
4. Error: type `{sisaa}` → refused naming `{sisaa}`. Then "Kembalikan ke bawaan" → default text returns and the invoice button uses it.

## UX notes
Single card: textarea, placeholder chips above it, preview below, Simpan primary, Kembalikan ke bawaan secondary. Indonesian, per voice.md. Reached from the Pengaturan hub.

## Test seams
- Vitest, pure: template render + validate (placeholders, required `{tautan}`, cap, default parity with today's text).
- Vitest, API: GET/PUT route (permission, tenant isolation, validation, reset).
- Vitest, route: queue and record-reminder use the stored template.
- Page test: edit, insert chip, preview, save, reset.

## Non-goals
- The "all of a family's invoices" message on the wali page and the pendaftaran fee/invite messages keep their fixed wording this cycle (different shapes: a list of invoices, a different audience). Same mechanism can extend to them later.
- No sending from the app, no scheduling, no per-invoice or per-campus templates, no multiple templates, no rich formatting.

## Assumptions
1. "The WhatsApp reminder template" means the unpaid-invoice message (the one behind the Chat WhatsApp button and queue).
2. Stored as one nullable text column on the school record (null = default), added by an additive migration.
3. Curly-brace placeholders, Indonesian names, because admins write Indonesian and the chips remove the typing.

## Gate re-openers
Schema migration (one additive nullable column on `Tenant`, no backfill). No new dependency. No auth change beyond reusing `payments.record`. No production write beyond the migration deploying with the release.

## Tasks
- [x] T1 Template module: default text, `renderInvoiceReminder`, `validateTemplate`; `invoiceReminderText` uses it and keeps today's output byte-for-byte for the default — accept: unit tests incl. default parity (reuse: `lib/finance/invoice-reminder.ts`)
- [x] T2 Schema + migration: nullable `Tenant.invoiceReminderTemplate` — accept: migration applies on a clean DB (reuse: `20261017120000_add_invoice_reminders` as the migration pattern)
- [x] T3 `GET/PUT /api/config/invoice-reminder` with `payments.record`, rate limit, tenant from session, zod validation — accept: API tests (reuse: `app/api/config/enrollment/route.ts`) (deps: T1, T2)
- [x] T4 Queue and record-reminder routes load the school's template — accept: route tests (deps: T1, T2)
- [x] T5 Invoice detail page uses the school's template (served with the invoice) — accept: page test (deps: T1, T2)
- [x] T6 Settings page + hub entry + the edit link in the Pengingat modal — accept: page test; verify-local flows 1-4 (reuse: `app/admin/settings/pendaftaran/page.tsx`, `config/admin-nav.ts`) (deps: T3)
- [x] T7 README/runbook touch if the module list changes; counts block via `bash scripts/audit-docs.sh --write` — accept: audit passes

T4, T5 and T6 can run in parallel after T1-T3.

## Implementation
- Plan: driver=claude-sonnet-5-5 (no cheaper tier used). No fan-out: the slices are small and each builds on the last (module → column → API → routes → UI), so workers would have cost more context than they saved.
- T1-T7 landed as one `feat` commit instead of one per task: schema, API, routes and UI are one vertical slice with no user-visible state in between, and `commit-msg` wants README staged on every `feat` touching `app/`/`lib/`. The docs evidence follows in a second commit.
- Placeholders are single-pass (`{x}` inside a guardian's name is never expanded). The default template reproduces the old message byte for byte (pinned by a parity test).
- The settings page does its own light validation with the same `validateReminderTemplate` the server runs, so the admin sees the reason as they type; the API is still the authority (400 with the reason).
- Edit link permission: the page and API need `payments.record`, the same permission that opens the queue modal, so every admin who sees the link can use it.
- Edits are audited (`Tenant` / `update-reminder-template`, before and after) in the same transaction as the write.
- Sample period in the preview is "Oktober 2026", because real period labels carry no "SPP" prefix (found while walking: "SPP {periode}" read "SPP SPP Oktober 2026").

## Verification
- design-system: the new page uses existing tokens only (Card, Button, Textarea, `text-small`, `text-muted-foreground`, `bg-muted`, `bg-card`, `text-primary`); no new colour or arbitrary hex.

### Verified locally — 2026-10-23
- Gate: `npm run lint` exit 0; `npx tsc --noEmit` clean; RLS coverage 43/43, API auth coverage 217/217 (the new route is `payments.record`-gated); `DEMO_MODE=true` production build compiled and passed TypeScript. Migration SQL applied to a schema without the column adds `invoiceReminderTemplate text` (nullable). Full Vitest on the final tree → 693 suites passed / 2 skipped, 8,192 tests passed / 42 todo (320 s).
- App: production build on http://localhost:3000, demo auth (`u_super_admin`, `u_school_admin`), throwaway local Postgres 16 on port 54329 (both URLs explicitly local, `db push` on an empty DB), stopped and deleted afterwards.
- Walked (Chromium, 1280px and 390px): hub lists Templat Pengingat WhatsApp for both admin roles → modal shows "Isi pesan bisa disesuaikan…" and Ubah templat pesan, which opens the template page → default preview is the old message with sample data → chip inserts `{siswa}` → preview updates live → `{sisaa}` refused naming it, `{tautan}` missing refused, Simpan disabled → save → invoice detail Chat WhatsApp and the queue's Buka WhatsApp both carry the new wording with that invoice's name, period, Sisa and link → Kembalikan ke bawaan + Simpan → original message returns. No horizontal overflow at 390px. No page errors, no 5xx; only the existing Vercel insights script 404s.
- Playwright: full suite `npx playwright test` → 247 passed (6.0m), no failures, run with this machine's Chromium via an untracked config wrapper (installed revision differs from the one Playwright expects); wrapper deleted.
- Screenshots (seed data, fictional), inspected visually: `docs/cycles/screenshots/2026-10-23-reminder-template-modal.png` (the edit link in the modal), `docs/cycles/screenshots/2026-10-23-reminder-template-editor.png` (editor + chat preview); the 390px view was also checked.
- Rounds: 2 fixes found by the build and the walk (a test fixture type, the "SPP SPP" sample), plus the caption above the chips.

## Ship Notes
- Route: other code (not auth-impacting). The new `/api/config/invoice-reminder` route reuses the existing session + `hasPermission("payments.record")` guard exactly as the neighbouring routes do; no auth, session or guard code changed, so no `needs-staging-verify` label. Labels: `e2e` (touches a user flow) and the model label.
- Migration: one additive nullable column (`Tenant.invoiceReminderTemplate`), applied to staging by `prisma migrate deploy` in the Vercel staging build. No backfill; null means the built-in message, so existing schools see no change. Worth a glance at the staging deploy that it reaches READY.
- Compared `origin/staging` (0 commits behind) to the head: code under `app/`, `components/`, `config/`, `lib/`, `prisma/`; docs: README, `docs/uat/jobs/admin.md`, CLAUDE.md counts block, this record. Soft-skip delta vs staging: 0 (26 baseline, 26 current).
- Out of scope, noted for later: the wali page's "all invoices" message and the pendaftaran fee/invite messages still use fixed wording; the same mechanism can extend to them.
- PR screenshots are committed under `docs/cycles/screenshots/` (this session has no `gh`, which `scripts/pr-screenshots.sh` needs).
