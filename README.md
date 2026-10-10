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
| UI | Shadcn Base UI + Tailwind + TanStack Table; admin forms on react-hook-form + zod (shared API schemas); shared task rows, context and save feedback; restrained React Bits-derived motion (`components/reactbits/`: count-up + spotlight on admin KPI tiles and stat cards, blur-in sign-in headline; step-enter, stagger and draw-check primitives for the public enrollment form; reduced-motion safe); Plus Jakarta Sans + JetBrains Mono |
| Payments | Pluggable `PaymentGateway` port ([`lib/payments/`](lib/payments/)) — DOKU Checkout or Xendit, selected by `PAYMENT_GATEWAY` |
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
| **academic** | School structure — academic years with one-click roll-forward, programs, classes, daily sessions with substitute swap, teaching assignments, bulk promotion |
| **students** | Student lifecycle — auth-proxied photo upload, guardians (one parent shared across siblings; Tambah Wali searches first, warns on duplicate name, phone, NIK or email; the active wali utama, set in one click, is billed), enrollments (one school plus one day-care placement per year; age bands advisory, audited override), admissions (`/daftar` inquiry → token → form → convert), CSV export. Detail is a single-scroll dossier — hash-addressable sections, NIK/KK masked, read-only Keuangan / Keringanan / Jurnal / Akademik / Pendaftaran, rail tiles from one aggregate route |
| **finance** | Fees and payments — invoice state machine, hosted checkout through the gateway port, webhook + manual reconciliation sharing one durable processor, three-step Billing Run wizard for bulk invoicing, per-student fee adjustments (*keringanan*), kuitansi PDF, payments-received ledger, manual payments with a review step and audited reversal |
| **learning** | Attendance, including the admin monthly recap and CSV export. The legacy BB/MB/BSH/BSB assessment stack was removed in 2026 and superseded by `curriculum` + `reportCard` |
| **student-journal** | *Buku Penghubung* — bi-directional school/home indicators with an audit trail, plus a week-independent note thread carrying unread markers per reader |
| **curriculum** *(cutover)* | PROMES spine — Semester → Theme → SubTheme → Week, Objective → Indicator. Admin CRUD, xlsx import, the teacher assessment write path (walas weekly + sentra daily), admin monitor, parent *perkembangan* rollup. Three-level skala |
| **reportCard** *(cutover)* | Triwulan report cards aggregated from penilaian — auto-drafted per student, admin override, publish, PDF, parent read. *Bank Narasi* narrative templates per term × age group |

---

## Portals

| Portal | Route | Role | Layout | Access |
|---|---|---|---|---|
| Public | `/daftar` | — | Mobile-first | Admission inquiry, three steps; school logo, hero photo, a three-photo strip (the school's own photos, chosen so no child's face is the subject, served from `public/school/`) and the legal footer |
| Public | `/pendaftaran/[token]` | — | Mobile-first | Full enrollment form via emailed token, slim school photo banner — seven steps incl. document upload (Berkas; optional unless the school marks some required under Pengaturan → Pengaturan Pendaftaran, which also sets the per-program fee), autosave + resume, animated progress bar, consent reveal and a draw-in success check (reduced-motion safe); each parent can sign from their own device on the same link; the signed Surat Persetujuan (v2) includes a photo/video clause for school documentation and social media, agreed by registering |
| Admin (owner) | `/admin` | `SUPER_ADMIN` | Desktop sidebar | Everything, including payroll and salary |
| Admin (staff) | `/admin` | `SCHOOL_ADMIN` | Desktop sidebar | Students, admissions (incl. Kelengkapan Berkas: view uploads, tick papers received; KK/KTP copied to the guardian on convert and shown on the student page), academics, attendance, invoices, employees |
| Teacher | `/teacher` | `TEACHER` | Mobile-first | Own attendance and leave; assigned classes only |
| Parent | `/parent` | `GUARDIAN` | Mobile-first | Own children only |
| Staff guide | `/panduan` | `SUPER_ADMIN`, `SCHOOL_ADMIN`, `TEACHER` | Mobile-first, scales to a projector | Ten-slide product tour in Indonesian (module map, admissions, classes, attendance, curriculum, rapor, finance, HR, access). Static copy and inline SVG under `components/deck/`, no data read; parents are redirected to `/parent`. Linked from the admin sidebar footer and the teacher *Lainnya* sheet |

All portals share the same chrome — An Nisaa' logo, "Talib" wordmark, "by An Nisaa' Sekolahku" sub-label — and the Indonesian voice defined in [`.claude/standards/voice.md`](.claude/standards/voice.md). Legal pages: `/legal/terms`, `/legal/privacy`.

Role homes apply "Don't Make Me Think": teachers see their class and unfinished work (class attendance is exception-first: pick S/I/A for the few, then one tap marks the rest Hadir), guardians see family actions for clearly identified children, and admins get a one-screen Dasbor (queue counts, top-5 urgent items, today's staff attendance) with the full queue at `/admin/work-queue`. The sidebar holds daily work only; setup lives in the `/admin/settings` hub. Shared shadcn components keep navigation, context, and save feedback consistent; the two mobile portals retain five navigation slots.

---

## Setup

Use Node.js 24 (≥ 22.12 works); CI and Vercel both run 24.

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

How this repo is worked — the `/spec` → `/build` → `/ship` loop, testing gates, branch protection, standards — is documented in [CLAUDE.md](./CLAUDE.md). Operational procedure lives in [`docs/runbooks/`](docs/runbooks/).
