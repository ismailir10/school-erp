# School admin can author the curriculum (Tema, Subtema, Pekan, Tujuan)

## Context

A school admin at An Nisaa' Sekolahku (WhatsApp, 2026-10-27) opened Pengaturan → Semester → Detail → Tema for 2026/2027 Semester 1. The page said "Belum ada tema" and showed no Tambah button on Tema, Subtema or Pekan, so she could not set up the curriculum that sentra and walas penilaian run on. Without an active Pekan, teachers cannot record sentra entries at all.

Investigation (code read, 2026-10-27): the Kurikulum write permission is held by the owner (Super Admin) only. The school admin role can read the curriculum but not write it, the four Semester pages decide the button from the role name rather than from the permission, and every curriculum write route also demands the permission. The earlier design called authoring Super Admin-only; the school now wants its admins to run it.

Audit of the school admin role against everything the admin portal offers: the only things it cannot do are (a) the whole SDM group (employees, staff attendance, leave, payroll, salary components), which is intended; (b) Kurikulum writing, which is this cycle; (c) recording penilaian entries, which is the teacher's job and attributed to the teacher's employee record; (d) two owner-only developer tools (demo seed, UAT prep) and creating Super Admin users.

## Decisions

- **D1. The school admin gets Kurikulum writing** (semesters, themes, subthemes, weeks, tujuan, indikator, theme links, Promes import). Reason: the user wants admins to have everything except HR, and curriculum is the school's own content.
- **D2. The button follows the permission, not the role name.** The four Semester pages show write controls when the user holds the Kurikulum write permission. Reason: the API already checks the permission, so a custom role granted it now works end to end, and the UI can no longer disagree with the API.
- **D3. SDM stays closed to the school admin.** Nothing in the HR group changes. A test pins it so a future permission cannot leak in.
- **D4. Penilaian recording stays teacher-only.** Admin keeps view and void. An entry is attributed to an employee record and the admin screens have no entry form; opening it would only create unattributed rows.
- **D5. Owner-only stays owner-only:** demo seed, UAT prep and creating or editing Super Admin users. They are developer and escalation tools, not school operations.
- **D6. No data migration.** A user's permissions come from code for roles without a custom role, so the change applies to every school admin on deploy. Users on a custom role are unchanged until the role is edited.

## Acceptance criteria

- [ ] A school admin sees Tambah on Tema, Subtema and Pekan, and on the Semester list, and can create each.
- [ ] A school admin sees the write controls on Tujuan Pembelajaran and can open the Promes import page.
- [ ] A school admin still cannot open Karyawan, Kehadiran (staff), Pengajuan Cuti, Penggajian or Komponen Gaji, in the sidebar or by URL.
- [ ] A user with a custom role holding the Kurikulum write permission sees the controls; one holding only read does not.
- [ ] A teacher still gets read-only curriculum.

## Verify flows

- Admin (school admin demo user), Pengaturan → Semester → open the active semester → Tema: no Tema yet. Tambah a Tema, then a Subtema under it, then a Pekan. Each appears in its list.
- Edge: admin opens `/admin/employees` and `/admin/payroll` by URL. Both bounce to `/admin`; the sidebar has no SDM group.
- Error: admin saves a Pekan whose dates overlap another active Pekan. The existing overlap error shows; nothing is saved.

## UX notes

No new screens or copy. The existing Tambah buttons and dialogs appear for one more role.

## Test seams

- Unit: permission table (`getSystemRolePermissions`): school admin has the Kurikulum write permission and still no HR code; owner has all.
- API integration: a school admin session can POST a theme; a read-only session gets 403 (existing route tests, extended).
- Page: the three Semester pages pass `canWrite` from the permission (server-component tests).
- E2E: existing `curriculum-admin` spec re-run as the school admin demo user for the create path.

## Non-goals

- Admin recording penilaian entries.
- Any change to SDM, payroll, or custom-role editing.
- A new "Super Admin only" curriculum toggle.

## Assumptions

1. "Admin" means the School Admin role. Super Admin already has everything.
2. "All access except HR" does not include the owner-only developer tools (D5) or recording penilaian as a teacher (D4).
3. The school wants admins to also edit Tujuan and Indikator and run the Promes import, not only Tema, Subtema and Pekan.

## Gate re-openers

Auth/permission behavior change: stated by the user ("make sure admin has all access except HR") and in D1 to D6. Not a schema change, no new dependency, no production write. Label `needs-staging-verify` applies.

## Tasks

- [x] T1 Grant the Kurikulum write permission to the school admin role, update the permission tests and the stale comments — accept: `permissions.test.ts` green, no HR code on the role (reuse: `lib/permissions.ts`)
- [x] T2 Semester pages decide `canWrite` from the permission (list, themes, objectives; import already does) — accept: page tests show a school admin and a custom role with the permission get `canWrite`, read-only does not (reuse: `hasPermission`)
- [x] T3 Route test: school admin session can write curriculum; docs and UAT jobs note — accept: `curriculum-routes` green; README/runbook text no longer says owner-only

## Implementation

- Plan: driver=claude-sonnet-5-5, workers=none. T1-T3 inline: the whole change is one permission line, three one-line page edits and tests, a worker would need the full plan as context. Sequential.
- T1: `lib/permissions.ts` (SCHOOL_ADMIN gets `curriculum.write`), `lib/__tests__/permissions.test.ts` (old "write denied" case flipped; new case pins school admin = every non-HR code except teacher-only `assessments.write`, so a future permission cannot leak in or be forgotten).
- T2: `app/admin/semesters/page.tsx`, `[id]/themes/page.tsx`, `[id]/objectives/page.tsx` use `hasPermission(session, "curriculum.write")`; `[id]/import/page.tsx` comment only. New `app/admin/semesters/__tests__/page-can-write.test.ts` (5 sessions x 3 pages).
- T3: `app/api/__tests__/curriculum-routes.test.ts` (school admin defaults pass the write gate), JTBD "Last audited" note, module guide line. README unchanged: no module, route or entity changed. design-system: no UI change, the existing Tambah buttons and dialogs now render for one more role.

## Verification

- Gate: `npx tsc --noEmit` clean; `npm run lint` clean (`--max-warnings=0`); `npx vitest run` 694 files passed / 2 skipped, 8210 tests passed, 42 todo; `verify-rls-coverage` 43/43, `verify-api-auth` 217/217; `DEMO_MODE=true` build ok.
- The new tests discriminate: with `lib/permissions.ts` reverted to HEAD, 5 fail (the non-HR parity case, the flipped curriculum case, and the school-admin case on all three Semester pages); restored, all pass.
- Playwright (local, production build, disposable local Postgres 16 started from the container's cluster because Docker is not available, dropped afterwards; container Chromium via `executablePath` in a scratch config outside the repo): `admin-school-admin` + `curriculum-admin`, 15 passed. The new case "SCHOOL_ADMIN creates a Tema, Subtema and Pekan" passes; the existing HR bounce cases (payroll page and API, employees list, employee detail, salary API, no SDM group, no Penggajian link) still pass.
- Walk as `u_school_admin` (desktop 1280x800): themes page shows Tambah on Tema, edit pencils and Impor PROMES (Program Semester); the Semester list shows one Tambah; `/admin/semesters/<id>/import` opens (no redirect); `/admin/payroll` redirects to `/admin`; the sidebar has no SDM group. Page load 0.5 to 0.8 s. Console errors: only `/_vercel/insights` and `/_vercel/speed-insights` script 404s, which exist only on Vercel (same on every page, not from this diff). design-system: no UI change, existing controls render for one more role.
- Not covered: the custom-role-with-`curriculum.write` case in a browser (covered by the page test); a signed-in check on staging (pending, see Ship Notes). `prisma db push --force-reset` is blocked for AI sessions, so a plain `db push` on the brand-new empty database was used instead.

## Ship Notes

Branch `claude/fervent-cray-jj1c2f` (assigned for this session, not `feat/*`). **Auth-impacting** (a role gains a permission): label `needs-staging-verify` until the staging check below passes. No migration, no env var, no seed change; applies to every School Admin on deploy because their permissions come from code. Users on a custom role are unchanged.

Staging check after merge (signed in as a real school admin, not a demo cookie): open Pengaturan → Semester → the 2026/2027 Semester 1 → Tema; Tambah is visible and a Tema can be created (delete or deactivate it afterwards); `/admin/employees` and `/admin/payroll` still bounce to `/admin`.

Rollback: revert the commit; no data is touched by the permission itself (themes the admin created stay and can be deactivated by the owner).

Out of scope, noted: admins still cannot record penilaian (teacher-only, D4); owner-only seed and UAT-prep tools unchanged (D5).
