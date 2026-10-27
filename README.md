# Talib — by An Nisaa' Sekolahku

School management platform for **An Nisaa' Sekolahku**, an Islamic PAUD/TKIT in Bekasi, Indonesia — two campuses, 40+ teachers, 500+ students. *Talib* (طالب) means "seeker of knowledge".

**Production:** [talib.annisaasekolahku.com](https://talib.annisaasekolahku.com)

> Engineering identifier: `school-erp` (npm package + repo name). Product name: Talib. Same codebase.

Source is public; school data and secrets are not. Deployed single-tenant — a second tenant needs tenant-from-host resolution in `lib/auth.ts`, currently keyed on email and guarded by `assertSingleTenant()`.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), TypeScript strict |
| Database | Supabase Postgres (Singapore `ap-southeast-1`); Prisma datasource is Postgres-only, so local dev points at a Postgres too |
| ORM | Prisma 7 |
| Auth | Supabase Auth — Google OAuth only, invitation-only. `/auth/callback` gates on an ACTIVE `User`/`Employee`/`Parent` row |
| UI | Shadcn Base UI + Tailwind + TanStack Table + Recharts (shadcn `chart`); admin forms on react-hook-form + zod (shared API schemas); shared task rows, context and save feedback; restrained React Bits-derived motion (`components/reactbits/`: count-up + spotlight on admin KPI tiles and stat cards, a fade-content scroll reveal that replays them on the Dasbor Analitik, blur-in sign-in headline; step-enter, stagger and draw-check primitives for the public enrollment form; reduced-motion safe); Plus Jakarta Sans + JetBrains Mono |
| Payments | Pluggable `PaymentGateway` port ([`lib/payments/`](lib/payments/)) — DOKU Checkout or Xendit, selected by `PAYMENT_GATEWAY`; the same webhook processor and daily sweep also credit the pendaftaran fee (own `EnrollmentFee` row, paid by the parent with no login, right after the form is submitted) |
| Email | Resend |
| PDF | `@react-pdf/renderer` |
| Hosting | Vercel (`sin1`) |
| CI | GitHub Actions — docs sync, lint + typecheck + unit, build, Playwright |

---

## Modules

Nine domain modules. Seven are stable; `curriculum` and `reportCard` are mid-cutover for the 2026 PROMES/Penilaian/Raport switch. The Parent portal is a view *across* students, finance and learning rather than its own module.

| Module | Domain |
|--------|--------|
| **core** | Auth, tenant, multi-campus config, holiday calendar, email log |
| **hr** | Staff lifecycle — employees, attendance, leave, payroll, salary components; gated by `hr.*` permissions |
| **academic** | School structure — academic years with one-click roll-forward, programs, classes (an admin can move a class to another program until its students are invoiced, with a fee-change preview), daily sessions with substitute swap, teaching assignments, bulk promotion |
| **students** | Student lifecycle: photo, guardians (one parent shared across siblings; Tambah Wali searches first, warns on duplicates; wali utama is billed), enrollments (one school + one day-care placement a year; audited age override), admissions (inquiry → formulir → pay after submit → convert, one list by Tahap), CSV export. Detail: single-scroll dossier, five groups, hash-addressable sections, NIK/KK masked, read-only Keuangan/Keringanan/Jurnal/Akademik/Pendaftaran, rail tiles from one route. Both open with Perlu perhatian + family WhatsApp; wali: Tautkan anak, reminder |
| **finance** | Fees and payments — invoice state machine, gateway-port checkout, webhook + manual reconciliation on one processor (daily sweep, on-demand), links that heal and show their expiry (replaced by parent, admin or nightly job), gateway money on a paid or voided invoice flagged *Perlu dicek*, never credited, Belum lunas / Perlu link / Perlu dicek filters, WhatsApp reminder queue, log, editable message, Billing Run wizard, *keringanan*, kuitansi PDF, payments ledger, manual payments with review, audited reversal, invoices created already paid (*Sudah dibayar*, no link or email) |
| **learning** | Attendance, including the admin monthly recap and CSV export. The legacy BB/MB/BSH/BSB assessment stack was removed in 2026 and superseded by `curriculum` + `reportCard` |
| **student-journal** | *Buku Penghubung* — bi-directional school/home indicators with an audit trail, a week-independent note thread carrying unread markers per reader, and a per-class-day *hari tanpa buku penghubung* mark (set by the guru on the entry page, or by an admin on the class week page) whose keterangan the wali sees in that day's column |
| **curriculum** *(cutover)* | PROMES spine — Semester → Theme → SubTheme → Week, Objective → Indicator. Admin CRUD, xlsx import, the teacher assessment write path (walas weekly + sentra daily), admin monitor, parent *perkembangan* rollup. Three-level skala |
| **reportCard** *(cutover)* | Triwulan report cards aggregated from penilaian — auto-drafted per student, admin override, publish, PDF, parent read. *Bank Narasi* narrative templates per term × age group |

---

## Portals

| Portal | Route | Role | Layout | Access |
|---|---|---|---|---|
| Public | `/pendaftaran/[token]/pembayaran` | — | Mobile-first | Pendaftaran fee payment after the form is submitted (the thank-you card's Bayar sekarang); DOKU returns here and the gateway is asked (throttled) before showing Lunas, Menunggu pembayaran or Belum selesai, so a missed notification never hides a payment; an open form with nothing to pay goes back to the form |
| Public | `/daftar` | — | Mobile-first | Admission inquiry, one short page (parent name plus one contact; child details optional); school logo, hero photo, a three-photo strip (the school's own photos, chosen so no child's face is the subject, served from `public/school/`) and the legal footer |
| Public | `/pendaftaran/[token]` | — | Mobile-first | Enrollment form via the sent link, filled first, paid after submit; a kode pos (or a name search) fills kelurahan, kecamatan, kota/kab and provinsi (`lib/wilayah/`, Kemendagri 2025); staff can fill or submit it with the parent — seven steps incl. document upload (Berkas; required ones and the fee set in Pengaturan Pendaftaran), autosave + resume, animated progress, consent reveal; each parent signs from their own device on the same link; the signed Surat Persetujuan (v2) includes a photo/video clause for school media |
| Admin (owner) | `/admin` | `SUPER_ADMIN` | Desktop sidebar | Everything, including payroll and salary |
| Admin (staff) | `/admin` | `SCHOOL_ADMIN` | Desktop sidebar | Students, admissions (one list, a Tahap per row; a lead is a parent plus one contact; Kirim Formulir is one tap, needs no email and creates no fee; staff can edit, submit or convert (Terima & Jadikan Siswa) a formulir; Kelengkapan Berkas; KK/KTP copied to the guardian; the fee is created at submit: Pembayaran column, Belum bayar filter, WhatsApp reminder, a Pembayaran card (discount, mark paid, waive, refresh) behind finance permissions), academics, attendance, invoices (Pengingat WhatsApp, Buat link baru), employees |
| Teacher | `/teacher` | `TEACHER` | Mobile-first | Own attendance and leave; assigned classes only |
| Parent | `/parent` | `GUARDIAN` | Mobile-first | Own children only; back from checkout, the gateway is asked about that invoice at once and again 15 s later (throttled), so a paid tagihan shows Lunas without waiting for the nightly sweep; an expired link is replaced on the same tagihan by the parent, one link at a time |
| Staff guide | `/panduan` | `SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER` | Mobile-first, scales to a projector | Ten-slide product tour in Indonesian (module map, admissions, classes, attendance, curriculum, rapor, finance, HR, access). Static copy and inline SVG under `components/deck/`, no data read; parents are redirected to `/parent`. Linked from the admin sidebar footer and the teacher *Lainnya* sheet |

All portals share the same chrome — An Nisaa' logo, "Talib" wordmark, "by An Nisaa' Sekolahku" sub-label — and the Indonesian voice defined in [`.claude/standards/voice.md`](.claude/standards/voice.md). Legal pages: `/legal/terms`, `/legal/privacy`.

Role homes apply "Don't Make Me Think": teachers see their class and unfinished work (class attendance is exception-first: pick S/I/A for the few, then one tap marks the rest Hadir), guardians see family actions for clearly identified children, and admins get a Dasbor whose first screen is the work (queue counts, top urgent items, today's staff attendance) with the full queue at `/admin/work-queue`.
Below it, Analitik charts student attendance, buku penghubung completion, billing vs collection and piutang aging. Billing follows each class's own program, so the Billing Run wizard (picker and review rows), Ubah Kelas and Tarif per Program name the program a class bills from and warn about a class that looks mislinked. The sidebar holds daily work only; setup lives in the `/admin/settings` hub. Shared shadcn components keep navigation, context, and save feedback consistent; the two mobile portals retain five navigation slots.

---

## Setup

Use Node.js 24 (24.15+; jsdom 30 also accepts 22.22.2+ on 22.x or 26+, not 23 or 25); CI and Vercel both run 24.

```bash
git clone https://github.com/ismailir10/annisaa-erp-v3.git
cd annisaa-erp-v3
npm install
./scripts/install-hooks.sh
npx prisma generate && npx prisma db push && npx prisma db seed
npm run dev     # http://localhost:3000 — DEMO_MODE bypasses Google auth; a DB is still required
```

Copy `.env.example` to `.env` first. Variable reference: [`docs/runbooks/environments.md`](docs/runbooks/environments.md).

| Task | Command |
|---|---|
| Gate before every commit | `npm run build && npx vitest run` |
| End-to-end | `npx playwright test` |
| Lint / types | `npm run lint` · `npm run typecheck` |
| Doc-staleness gate | `bash scripts/audit-docs.sh` |

---

## Architecture Decisions

Constraints from the last 60 days live in [`docs/adrs/active.md`](docs/adrs/active.md); everything older is in [`docs/adrs/archive.md`](docs/adrs/archive.md). Per-cycle engineering history is in [`docs/cycles/`](docs/cycles/), swept into [`docs/cycles/archive/`](docs/cycles/archive/) monthly.

## Contributing

How this repo is worked — the `spec` → `build` → `verify-local` → `ship` loop, testing gates, branch protection, standards — is documented in [CLAUDE.md](./CLAUDE.md). Operational procedure lives in [`docs/runbooks/`](docs/runbooks/).
