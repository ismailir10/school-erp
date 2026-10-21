# Page Recipes

> Loaded on demand by `/build` when staged paths match `app/*/page.tsx`, `app/**/client.tsx`, or `components/{admin,teacher,parent,portal}/**`.

**Canonical reference:** `.claude/standards/design-system.html` — read the matching `§ Page Recipes` section (and the Portal Shell, Overlays, DataTable sections it cross-links) before inventing new layouts.

Six recipes cover every screen in the ERP today. Pick the narrowest match; do not invent a 7th without raising it in CLAUDE.md.

## Settings Hub

**When:** a new admin page is setup, not daily work — something configured once per term or year, or rarely (campuses, academic years, semesters, holidays, work hours, fee/salary component catalogs, narrative/journal templates, users, roles). Daily work is anything touched routinely — students, invoices, attendance, admissions, journal entries.

**Where it goes:** add it to `settingsHub` in `config/admin-nav.ts`, under the matching section (Sekolah / Akademik / Keuangan & Gaji / Akses / Pengembang) — never as a new sidebar group. The sidebar holds daily work only. `/admin/settings` renders the hub; `hasVisibleSettings()` hides the Pengaturan link entirely when a session's permissions leave the hub empty.

## Admin Dasbor

**The action region is one screen, always.** "Perlu ditangani" — `PageHeader` + queue count tiles + finance tiles + a top-4 urgent list + a one-line staff attendance strip, plus an activity rail shown at `xl` only — fits a single 1440×900 viewport with no scroll for the full-permission admin (e2e asserts the region's bottom edge, `data-testid="dashboard-action-region"`). Every Dasbor source query is bounded (`count` + `take: 5`, or an aggregate over a fixed window) — never an unbounded `findMany`.

**Counts link out; nothing launches from the Dasbor.** A count tile links to `/admin/work-queue?kind=<kind>` for the full list. The action region never hosts the full DataTable, a chart, or a QuickActions-style launcher grid — those belong on their own page (the staff attendance trend chart lives at the top of `/admin/employee-attendance`, fed by `GET /api/attendance/trend`).

**Analitik lives below the fold.** Trend charts belong only in the "Analitik" section under the action region (`lib/dashboard/analytics/`, `components/admin/dashboard/analytics/`): streamed behind a `Suspense` skeleton so the action region never waits on it, each source gated by the permission of the module it summarises (attendance and buku penghubung: any admin; keuangan: `invoices.view`), each card with its own empty and retry state. Every card states its window and links to its module. Motion is the React Bits layer only (`FadeContent` reveal, `CountUp`, `Spotlight`, `Aurora`), static under reduced motion.

## Recipe 1 — Admin List

**When:** any admin route rendering >10 rows of a single entity (students, employees, invoices, admissions, ...).

**Layout skeleton:**

```tsx
// Breadcrumb + sidebar chrome come from app/admin/layout.tsx (AppSidebar +
// AdminBreadcrumb) — a list page starts at PageHeader, no SiteHeader.
<>
  <PageHeader
    title="Siswa"
    subtitle="Kelola data siswa aktif dan riwayat"
    actions={<Button>Tambah Siswa</Button>}
  />
  <section className="mt-section">
    <DataTableToolbar
      searchPlaceholder="Cari nama / NIS..."
      value={search}
      onValueChange={setSearch}
      filters={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "ALL", label: "Semua Status" },
            { value: "ACTIVE", label: "Aktif" },
            { value: "INACTIVE", label: "Tidak Aktif" },
          ],
          value: status,
          onChange: setStatus,
        },
      ]}
    />
    <DataTable columns={columns} data={rows} pagination={pagination} />
  </section>
</>
```

**Required pieces:** breadcrumb comes free from `app/admin/layout.tsx`'s `AdminBreadcrumb` — a list page's own root starts at `PageHeader` · `PageHeader` with title + static subtitle + primary CTA in `actions` (unless the CTA is tab-scoped — then it goes in the toolbar's `actions`, see `ui.md` Primary-Action Placement) · `DataTableToolbar` with search + status `filters` entry (Aktif/Tidak Aktif at minimum) · `DataTable` with sort + pagination + a `DataTableLinkCell` identity column ("name is the link", see `ui.md`) + action column (`<DataTableRowActions>` — see `ui.md`) · Created At + Updated At columns `meta: { priority: "low" }` (hidden below `md`, see `ui.md` DataTable mobile contract) · EmptyState via `DataTable`'s empty slot.

**Forbidden:** hand-rolled `flex flex-col gap-2` row loops · custom modal buttons outside the `<Dialog>` / `<Sheet>` rule · hardcoded `p-6` page padding (use `p-page-x` / `py-page-y` from the spacing scale).

**One nav entry, one list.** Pendaftaran is a single list at `/admin/admissions` (the old `/admin/enrollments` list was folded into it and redirects there); a stage-driven entity shows a derived **Tahap** column and filter instead of a second tab. Use `AdminTabs` for panels within one page.

## Recipe 2 — Admin Detail

**When:** `/admin/<entity>/[id]` pages. Two variants — pick by trigger rule, do not default to either without checking:

**Trigger rule — use 2b (dossier) only when *both* hold:** (1) the page is a read/overview surface, not a stateful editor or workflow tool, and (2) the entity has 3+ independent concerns worth their own section (finance, academics, documents, ... — something an admin would search for by name). Otherwise use 2a. See `docs/cycles/2026-09-03-detail-page-pattern-decision.md` for the full reasoning. The retrofit backlog is closed as of the 2026-09-25 `admin-dmmt-overhaul` cycle — `students/[id]`, `guardians/[id]`, `classes/[id]`, and `(hr)/employees/[id]` are all on 2b now; a new candidate goes straight into this file when it qualifies.

### Recipe 2a — Simple Detail

**When:** single-concern entities (one invoice, one payroll run) or stateful editors/workflow tools (raport editor) — the common case for anything that isn't named in the 2b backlog.

**Layout skeleton:**

```tsx
<main className="flex flex-1 flex-col p-page-x py-page-y">
  <PageHeader
    title={`${student.name}`}
    subtitle={`${student.nis} · ${student.className}`}
    actions={<><Button variant="outline">Nonaktifkan</Button><Button>Edit</Button></>}
  />
  <div className="mt-section grid gap-section md:grid-cols-[1fr_280px]">
    <Tabs defaultValue="profil">
      <TabsList>...</TabsList>
      <TabsContent value="profil">...</TabsContent>
    </Tabs>
    <aside className="space-y-4">{/* metadata cards */}</aside>
  </div>
</main>
```

**Required pieces:** PageHeader with entity name + identifier subtitle + action cluster (destructive-left / edit-right) · Tabs for sub-sections (if >1) · right-rail aside for metadata (created_at, updated_at, audit log link) · StatusBadge on every state field.

### Recipe 2b — Dossier

**When:** multi-concern entity overviews. Adopted: `/admin/students/[id]`, `/admin/guardians/[id]`, `/admin/classes/[id]`, `app/admin/(hr)/employees/[id]`.

**Layout skeleton:**

```tsx
<main className="flex flex-1 flex-col p-page-x py-page-y">
  <DetailPageHeader title={entity.name} subtitle={...} actions={...} />
  <div className="mt-section grid gap-section lg:grid-cols-[1fr_280px]">
    <div>
      <DossierNav sections={sectionDefs} openMap={openMap} onNavigate={...} />
      <DossierSection id="keuangan" label="Keuangan" open={openMap.keuangan} onOpenChange={...}>
        ...
      </DossierSection>
      {/* more DossierSections, one per concern */}
    </div>
    <DetailRail>
      <RailStatTiles tiles={[...]} />
      <RailCard title="Kontak">...</RailCard>
    </DetailRail>
  </div>
</main>
```

**Required pieces:** `DetailPageHeader` + `DetailPageSkeleton` for loading (`components/admin/`) · sticky `DossierNav` that expands a collapsed section before scrolling to it · one `DossierSection` per concern, `id` = DOM anchor = nav target, `keepMounted` only for sections whose fetch is worth surviving a collapse · `DetailRail` (`RailStatTiles` / `RailCard` / `RailKV` / `RailChecklist`) — collapses into normal document flow below `lg` · hash-addressable sections (`#akademik` etc.) · aggregate numbers distinguish "not loaded" (`Memuat…`) from a real zero (never a bare `0` while a fetch is pending) · lazy sections fetch only on first open; above-the-fold rail data fetches eagerly.

**Split a big dossier page, don't let it grow into a monolith.** The route `page.tsx` stays a thin orchestrator — entity state, which sections are open, lazy-fetch latches, hash handling — and each section and its dialogs live in `components/admin/<entity>/detail/*`, one file per concern (`components/admin/classes/detail/{roster,teachers,sessions}-section.tsx` + its dialogs is the shipped example; `components/admin/students/detail/*` is the second).

Both variants share: StatusBadge on every state field, the Edit Toggle Pattern (`crud.md`) for inline section edits.

## Recipe 3 — Admin Form (Dialog or Sheet)

**When:** create or edit an entity from a list page. Never a separate route.

**Rule:** Use `ResponsiveFormDialog` for create/edit forms: it renders Dialog on desktop and Sheet on mobile, freezing that choice while open. Destructive confirmation remains `<AlertDialog>`. One overlay at a time — toasts excepted.

The wrapper owns the viewport-height limit, shadcn `ScrollArea` body, internal focus-ring padding, and docked header/footer. Put fields in `children` and action buttons in `footer`; do not add another scrolling wrapper or viewport-height constraint. Choose width through `size`.

**Layout skeleton:**

```tsx
const formId = useId();
const form = useZodForm(createStudentFormSchema, { defaultValues: EMPTY });

const onSubmit = form.handleSubmit(async (values) => {
  try {
    await sendJson("/api/students", { method: "POST", body: values }, "Gagal menyimpan");
    toast.success("Siswa ditambahkan");
    setOpen(false);
  } catch (err) {
    applyServerErrors(form, err, "Gagal menyimpan");
  }
});

<ResponsiveFormDialog
  open={open}
  onOpenChange={setOpen}
  title="Tambah Siswa"
  description="Isi data siswa baru."
  size="lg"
  footer={
    <FormDialogFooter
      formId={formId}
      pending={form.formState.isSubmitting}
      onCancel={() => setOpen(false)}
      submitLabel="Tambah Siswa"
    />
  }
>
  <form id={formId} className="space-y-field" onSubmit={onSubmit} noValidate>
    <FormRootError formState={form.formState} />
    <FormField
      control={form.control}
      name="name"
      label="Nama Lengkap"
      required
      description="Sesuai akta kelahiran."
      render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
    />
    {/* ...more fields */}
  </form>
</ResponsiveFormDialog>
```

The footer sits outside the form's DOM subtree; `FormDialogFooter`'s submit button carries the matching `form` attribute.

**Required pieces:** `useZodForm` with the route's schema (or one derived from it) · `FormField` for every control · `FormRootError` · `FormDialogFooter` (loading state, ghost-Cancel left, solid-Submit right) · `sendJson` + `applyServerErrors`. Full rules and the three pitfalls: `ui.md` → Forms.

## Recipe 4 — Portal Dashboard

**When:** `/teacher` or `/parent` home pages — mobile-first landing that makes today's next action obvious.

**Layout skeleton:**

```tsx
<main className="mx-auto max-w-md px-5 pb-20 pt-6">
  <PortalHeader {...} />
  <PageHeader title="Beranda" subtitle={greeting} />
  <section className="mt-section space-y-3">
    {/* Teacher: current class and the tasks still needing work.
        Parent: children and the information or action each needs. */}
    <TaskList><TaskRow ... /></TaskList>
  </section>
  <PortalBottomNav ... />
</main>
```

**Required pieces:** `PortalHeader` · `PortalBottomNav` · clear page heading · current context and a task-first next-action area · `max-w-md` · bottom padding to clear navigation · `safe-area-bottom` on bottom nav. Quick links are optional secondary navigation; do not reserve a fixed-height three-card grid above the work.

**Parent-specific:** show the household's children together with each child's actionable information (see `portal.md`). Do not turn absent attendance data into a claim that the child was absent, present, or late.

## Recipe 5 — Workflow Queue

**When:** approval list where the row action IS the domain work (LeaveRequest approve/reject, refund approval).

**Layout skeleton:** same as Admin List (Recipe 1) but with:
- `DataTableRowActions` using `extraActions` for "Setujui" / "Tolak" (see `ui.md` — domain-specific actions exception).
- Top toolbar shows count of pending items.
- Row colour hints ok (amber background for stale items >N days old).

**Required pieces:** pending-count toolbar chip · per-row approve/reject with AlertDialog confirm · audit-log link on each row · EmptyState shows the "nothing pending" copy, not the generic "no data yet".

## Recipe 6 — Daily Data Entry

**When:** single-purpose grids where the user types/taps the same field across many rows (class attendance, assessment score entry, home-note week grid).

**Rules:**
- **Make each state clear.** Existing cycle controls may keep their current behavior. New attendance entry may use explicit state choices when that makes the result easier to understand and verify.
- **Sticky first column** identifies the entity (student name / date / category). Sticky so it doesn't scroll off horizontally on mobile.
- **Summary trio above the grid** shows live totals (e.g. "Hadir 25 · Sakit 2 · Alpa 1").
- **Preserve the route's real save contract.** Show saving, saved, and error feedback beside the work. Do not claim success before persistence or replace a working submit flow merely to match a mockup.

**Layout skeleton:**

```tsx
<main className="flex flex-1 flex-col p-page-x py-page-y">
  <PageHeader title="Absensi Kelas" ... />
  <section className="mt-section flex items-center gap-3">
    <ClassPicker /> <DatePicker />
    <div className="ml-auto flex gap-4 text-small">
      <span className="text-status-present-text">Hadir {present}</span>
      <span className="text-status-absent-text">Alpa {absent}</span>
      <span className="text-status-leave-text">Sakit {sick}</span>
    </div>
  </section>
  <AttendanceGrid rows={roster} onCycle={cycleStatus} />
</main>
```

**Required pieces:** class + date picker row · live summary · clear per-student state · save feedback that matches the actual persistence flow · row-level skeleton on first load.

## Cross-recipe invariants

- **Page-wrapper standard.** Every admin page root is a fragment starting with `PageHeader`. Multiple body blocks go in a single `<div className="space-y-section">` wrapper below it — never raw `space-y-4` / `space-y-6` at the page root.
- **Never render nothing on empty.** Every conditional list MUST have an `<EmptyState>` branch (see `portal.md` — Empty State Contract).
- **Loading is always `<Skeleton>`.** No `animate-pulse` divs.
- **Every admin route has a route-level `loading.tsx`** (cycle `2026-09-27-admin-finish-standard` filled the gaps). List/table routes copy the shared list skeleton (stat-tile row + toolbar bar + one large card skeleton — see `app/admin/guardians/loading.tsx`); entity detail `[id]` routes (Recipe 2a and 2b alike) render `<DetailPageSkeleton />` (`components/admin/detail-page-skeleton.tsx` — see `app/admin/classes/[id]/loading.tsx`); everything else (settings hub, a wizard, a config/import page) renders the root skeleton shape (title + stat row + list rows — see `app/admin/settings/loading.tsx`).
- **Errors via `toast.error()`.** Never `alert()`, never silent catch.
- **Currency via `formatRupiah()`, dates via `formatDate()` / `formatDateShort()`.** Never inline `.toLocaleString()`.
- **Spacing from tokens.** `p-page-x`, `py-page-y`, `gap-section`, `p-card`, `space-y-field` — never ad-hoc `p-4` / `p-8` for page chrome.
- **Typography from tokens.** `text-h1`, `text-h2`, `text-body`, `text-small`, `text-caption` — never ad-hoc `text-lg` / `text-base` for page chrome.
