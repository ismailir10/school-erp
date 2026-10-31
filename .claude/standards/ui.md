# UI Standards

> Loaded on demand by `/build` when staged paths match `components/**`, `app/*/page.tsx`, or `lib/format.ts`.

## Canonical Reference

**Cross-check every frontend change against `.claude/standards/design-system.html`** (brand, tokens, type, components, states, overlays, portal shells, voice). Scan the sections relevant to the change before editing; the cycle doc Verification must cite `design-system` (frontend gate, pre-commit Rule 4). Where tokens, recipes or copy disagree, `app/globals.css` wins for values and this file wins for usage. `/admin/design-system` serves a byte-identical copy at `public/admin/design-system-reference.html`: edit the canonical file, then `cp` it over (the guard test fails on drift).

## Design tokens

Values live in `app/globals.css` (`:root` for values, `@theme inline` for utilities). Use the utility; never hand-write `p-4`, `text-lg`, `shadow-[…]`, `z-[…]`, a cubic-bezier, or a hex for page chrome. `text-sm` / `text-xs` stay fine for dense UI (tables, chips); new page chrome uses the semantic scale. `lib/__tests__/design-token-guard.test.ts` fails on raw palette colours, arbitrary hex/rgb, `hsl(var(--…))`, `Loader2`/`animate-spin` outside `Spinner`, `bg-<semantic>/10` tints outside `components/ui`, and `toLocaleString` outside `lib/format.ts` (rule G: use `formatNumber` / `formatRupiah`). A new size, shadow or z-index token also goes in `extendTailwindMerge` in `lib/utils.ts`, or `cn()` mis-merges it (it read `text-caption` as a colour and dropped `text-muted-foreground`).

| Family | Utilities | Notes |
|---|---|---|
| Spacing | `px-page-x` 1.5rem, `py-page-y` 2rem, `gap-section` 2rem, `p-card` 1.5rem, `gap-field` / `space-y-field` 1rem | Page padding, section gap, card padding, form row gap |
| Type | `text-display` 2rem/1.15 bold, `text-h1` 1.5rem/1.25 semibold, `text-h2` 1.125rem/1.35 semibold, `text-body` 0.875rem/1.5, `text-small` 0.75rem/1.4, `text-caption` 0.6875rem/1.35 | Display, h1 and h2 carry their own line-height **and weight**: never add `font-semibold` / `leading-*` to them |
| Radius | `rounded-sm` … `rounded-4xl`, all derived from `--radius` (0.625rem) | `rounded-lg` = `--radius`; cards `rounded-xl` |
| Elevation | `shadow-resting` (also `shadow-card-resting`), `shadow-raised`, `shadow-overlay`, `shadow-sticky-edge`, `shadow-card-elevated` | Resting card, hover-lifted card or sticky bar, popover/menu/dialog, sticky trailing column edge |
| Motion | `ease-standard`, `ease-emphasized`, `duration-fast` 120ms, `duration-base` 200ms, `duration-slow` 320ms | framer-motion: `EASE_STANDARD`, `EASE_EMPHASIZED`, `DURATION` (seconds) from `lib/motion.ts`. Wrap decorative motion in `motion-safe:` |
| Z-index | `z-base` 0, `z-sticky` 10, `z-header` 20, `z-nav` 30, `z-dropdown` 40, `z-overlay` 50, `z-toast` 60 | Shadcn primitives keep `z-50`, which equals `z-overlay`; don't rewrite them |
| Colour | see [colors.md](./colors.md) | Light-only; semantic triads `success` / `warning` / `info` / `destructive` |

## Reach for

| Need | Use | Not |
|---|---|---|
| Status from a domain enum | `<StatusBadge>` (`components/ui/status-badge.tsx`; owns every status tone as a named key, incl. class health `Sehat` / `Perhatian` / `Kritis` / `Libur`) | A page-local tone map |
| Count or state pill | `<Badge variant="success\|warning\|info\|danger\|neutral">` | `<Badge className="bg-status-…">`, hand-rolled `<span rounded-full …>` |
| Bordered section block (detail pages, portal sections) | `<SectionCard title description? action? footer? className contentClassName>` (`components/ui/section-card.tsx`) | `rounded-xl border bg-card p-4` divs. Plain `Card` only for custom structure |
| Loading | `<Spinner>` (`components/ui/spinner.tsx`; `aria-hidden` beside visible text) for actions, `<Skeleton>` for layout | `Loader2` / `animate-spin` / `animate-pulse` divs |
| Route or fetch error | `<ErrorState title onRetry>` (`components/ui/error-state.tsx`) | A hand-written error block per `error.tsx` |
| Person | `<UserAvatar>` (`components/ui/user-avatar.tsx`) | A hand-rolled initials circle |
| Back navigation | `<BackLink>` (`components/portal/back-link.tsx`) | A hand-rolled `ArrowLeft` link |
| Confirm, destructive or not | `<ConfirmDialog>` (`destructive` for delete/void/cancel) | Raw `<AlertDialog>`, `window.confirm()` |
| Page title | `PageHeader` (`components/admin/page-header.tsx`, `components/portal/page-header.tsx`) | A hand-rolled `<h1>` |
| Money | `formatRupiah()` + `font-currency` (admin, mono) or `font-amount` (parent, sans) | Inline formatting |
| Plain number | `formatNumber()` (`lib/format.ts`) | `.toLocaleString()` (guard rule G) |
| Field validation error | shadcn `<FieldError>` under the field | A toast as the only signal |
| Failed save of a record being entered | `toastError(msg, { retry, id })` (`lib/feedback.ts`) | Bare `toast.error`, `{ duration: Infinity }` by hand |

## Rule: Shadcn FIRST. Never build custom when Shadcn has it.

Use the installed Shadcn component; do not build custom. (Talib primitives are in "Reach for" above.)

| Need | Use | NEVER |
|------|-----|-------|
| Sidebar / Nav | `<Sidebar>` + all sub-components | Custom `<aside>` with hardcoded styles |
| Collapsible section | `<Collapsible>` | Custom toggle with useState |
| Page location | `<Breadcrumb>` | Custom breadcrumb divs |
| Sidebar trigger | `<SidebarTrigger>` | Custom hamburger button |
| Sidebar layout | `<SidebarProvider>` + `<SidebarInset>` | Manual `lg:pl-60` offsets |
| Data list | `<DataTable>` | Custom card loops |
| Wide matrix / grid (not a sortable/paginated entity list) | ui/table primitives (`<Table>`, `<TableHeader>`, `<TableBody>`, ...) | raw `<table>` |
| Admin tabs (panels within one page) | `<AdminTabs>` | raw `<Tabs>` import in `app/admin/**` |
| Operational-list metrics | `<StatsCardsRow cols={2..6}>` | hand-rolled stat grid divs, or any StatsCardsRow on a config list |
| Small "label above a number" tile (dashboard, detail rail, trend strip) | `<StatTile>` (`components/ui/stat-tile.tsx`; `StatCard` stays the icon + count-up KPI card on list pages) | Hand-rolled `rounded-lg border` tile with `text-[10px]` |
| Previous / label / next stepper for a month or week | `<PeriodStepper>` (`components/ui/period-stepper.tsx`; URL-driven week navigation with a "today" shortcut is the portal `WeekNavigator`) | `<button className="p-2">` with a chevron |
| Icon-only button | `<Button size="icon">` / `"icon-sm"` | `size="sm" className="h-8 w-8 p-0 …"` |
| Form field | `<FormField>` (`components/ui/form.tsx`, binds react-hook-form onto `Field` / `FieldLabel` / `FieldDescription` / `FieldError`) | Raw `<Label>` + `<Input>`, hand-wired `htmlFor`/`aria-invalid`, a `useState` form object |
| Progress | `<Progress>` | Custom progress bars |
| Accordion | `<Accordion>` | Custom expand/collapse |
| Scroll area | `<ScrollArea>` | Custom overflow divs |
| Date | `formatDate()` / `formatDateShort()` | Inline `.toLocaleDateString()` |
| Desktop form / create-edit | `<ResponsiveFormDialog>` (Dialog) | Route-level form pages |
| Mobile form / create-edit | `<ResponsiveFormDialog>` (Sheet) | Dialog stuffed into narrow viewport |
| Action dialog (approve, void, override, record payment, ...) | `<ResponsiveFormDialog>` | hand-rolled `useIsMobile` + `<Dialog>`/`<Sheet>` |
| Transient feedback | `toast.*()` (sonner) | `alert()`, inline banner for success |

## Touch targets (phones)

Every control is at least **44px** tall on a touch device (`(pointer: coarse)`), and looks exactly as before on a mouse. The floor lives in the primitives, not in pages: `Button`, `Input`, `NativeSelect`, `InputGroup`, `SelectTrigger`, `AsyncCombobox`, `Toggle`, `AccordionTrigger`, `TabsTrigger` carry `[@media(pointer:coarse)]:min-h-11`, and `BreadcrumbLink` / `Checkbox` / `Switch` grow their hit area with an `::after`. A control built on these needs nothing extra; **never** pass a page-level `h-9`/`p-1` that works against them, and don't hand-roll a `<button>` or `<input>` (use `Button size="icon"`, `PeriodStepper`, `Input`). Text fields are 16px below `md` (`text-base md:text-sm`) or iOS zooms the page on focus; a caller that passes `text-sm`/`text-xs` to an input must write `text-base md:text-sm`. `.tap-target` (`app/globals.css`) is the always-on version for portal controls that are not one of the primitives above.

`e2e/mobile-layout.spec.ts` walks the admin, teacher and parent routes at 390px and fails on sideways page scroll, a control under 44px, a data table that needs a sideways scroll (only the month × employee matrix is exempt), and a text field under 16px. Add a new route to its list when you add a screen.

**Filters on a phone.** `DataTableToolbar` lays out as a two-column grid below `sm`: search spans both, dropdowns pair up (an odd last one spans both), reset and actions get their own row. Don't wrap its filters in a custom stack.

**Month calendars on a phone.** A 7-column grid leaves ~44px per cell at 390px, too small to tap a session in; below `md` render the same data as a day-by-day list (`ClassSessionsCalendar` is the reference).

## Overlays Rule

**One overlay at a time — toasts excepted.** Never stack Dialog over Dialog, Sheet over Sheet, or Dialog over Sheet. Close the current overlay before opening another.

- **Dialog on desktop, Sheet on mobile.** Use `ResponsiveFormDialog` for create/edit forms; it owns the breakpoint switch and preserves the active form while open.
- **Confirms go through `<ConfirmDialog>`, always** (delete, void, cancel, deactivate, restore, approve; `destructive` for the irreversible ones). Never import `<AlertDialog>` outside `confirm-dialog.tsx`. A two-answer question is still a two-way `<ConfirmDialog>` (confirm or Batal, focus on Batal). Cancel-left (ghost), destructive-right (`variant="destructive"`).
- **Discarding a dirty form is asked inside that form, not over it.** A "Buang perubahan?" guard on an open Dialog/Sheet swaps the form's footer for an inline confirm row (`role="alert"`, focus on the safe choice, Escape = keep editing) instead of mounting a `<ConfirmDialog>` on top. Reference: `components/student-journal/note-compose-dialog.tsx`.
- **Toasts stack, overlays don't.** Sonner's default 3–5s suits success; a failed save persists with a retry via `toastError` (see Feedback below).
- **Body copy states the consequence** ("Data akan hilang selamanya" for hard delete, "Bisa diaktifkan kembali kapan saja" for soft delete); see `voice.md`.

**Named exceptions** (raw overlay outside `confirm-dialog.tsx` / `ResponsiveFormDialog`, deliberately not "fixed"):
- **Payroll payslip Sheet** — read-only detail view, not a form.
- **Billing-run wizard shell** — multi-step; a follow-up to migrate onto the shared primitives.

**Note:** Shadcn `base-nova` style uses `render` prop (not `asChild`) for composition:
```tsx
// Correct (base-nova):
<SidebarMenuButton render={<Link href="/admin" />}>
<BreadcrumbLink render={<Link href="/admin" />}>

// Wrong (old style):
<SidebarMenuButton asChild><Link href="/admin">
```

## Feedback

- **Validation shows at the field.** Shadcn `FieldError` + `aria-invalid` + `aria-describedby`; focus the first invalid field on submit; clear the error as soon as the value is fixed. A toast is never the only signal. Never disable a submit button without saying why: leave it enabled and let the tap explain. Reference: `app/teacher/student-journal/page.tsx`.
- **Failed save of a record the user is entering** → `toastError(msg, { retry, id })`: it persists with a "Coba lagi" action, and `id` stops repeats stacking. Loads and minor actions keep the short default toast. No `retry` when retrying can't help (401/403). Reference: `app/teacher/class-attendance/page.tsx`.
- **Generic copy comes from `MESSAGES`** in `lib/feedback.ts`; caught errors go through `toastCaughtError` / `userMessage`, never raw `err.message`. Wording rules: `voice.md` § Errors.
- **Bulk destructive one-taps confirm** through `<ConfirmDialog>` (reference: `components/student-journal/class-day-grid.tsx`).
- **Small visual controls get an invisible ≥44px hit area**: `relative after:absolute after:-inset-N` (reference: `components/portal/week-grid.tsx`).

## Dialog & Sheet button labels (canonical)

Every admin form Dialog / Sheet uses these button strings (linked from `crud.md` Edit Dialog Standard); `voice.md` still governs body copy.

| Action type | Submit label | Loading | Cancel | Cancel variant |
|---|---|---|---|---|
| Create | `Tambah <Entity>` (e.g. `Tambah Siswa`) — match the trigger button | `Menyimpan...` | `Batal` | `ghost` |
| Bulk create | `Buat <Plural>` (e.g. `Buat Tagihan Bulanan`) | `Memproses...` | `Batal` | `ghost` |
| Edit | `Simpan Perubahan` | `Menyimpan...` | `Batal` | `ghost` |
| Domain mutation (approve, send, void, override, record payment) | Verb-only (`Setujui`, `Kirim`, `Catat Pembayaran`, `Simpan Override`, `Simpan & Hitung Ulang`) | `Memproses...` | `Batal` | `ghost` |
| Destructive confirm (`<ConfirmDialog destructive>`) | `Ya, <Verb>` (`Ya, Hapus`, `Ya, Batalkan`, `Ya, Nonaktifkan`) | `Memproses...` | `Batal` | (`AlertDialogCancel` — no `variant=` prop) |
| Reversible confirm (Restore / Activate) | `<Verb>` (`Aktifkan`, `Pulihkan`) | `Memproses...` | `Batal` | (`AlertDialogCancel`) |

For toggled create/edit dialogs, the submit slot uses a ternary: `editingX ? "Simpan Perubahan" : "Tambah <Entity>"`. Same shape on the dialog title.

`<ResponsiveFormDialog>` (`components/ui/responsive-form-dialog.tsx`) is the default for create/edit forms. It owns the bounded `ScrollArea`, viewport-height limit, focus-ring padding and docked header/footer in both modes. Supply fields as children, actions through `footer`, width through `size`; do not recreate Dialog/Sheet branches, nest another overflow wrapper, or add caller-owned viewport heights. See `patterns.md` Recipe 3 for a form whose external footer submit button uses the matching `form` attribute. Pass `footer={null}` (not omitted) for a multi-step wizard that owns its own per-step buttons — the shell then renders no docked footer bar instead of an empty one.

## Forms — react-hook-form + zod

Every admin create/edit form is built the same way (cycle `2026-09-27-admin-forms-rhf`; worked example `app/admin/settings/holidays/page.tsx`):

- `const form = useZodForm(schema, { defaultValues })` (`lib/forms/use-zod-form.ts`) — validates `onTouched`, focuses the first invalid field on submit.
- `schema` is the API route's own schema from `lib/validations/**`, or a form schema **derived** from it in the same file (`.extend` / `.pick` / `.omit` / `.superRefine`). Never a divergent copy. Messages are Indonesian; a required string fails with "… wajib diisi" before any format rule.
- Each control is a `<FormField control name label required render={({ field, controlProps }) => …} />`. Spread `field` + `controlProps` on `Input`/`Textarea`; map `value`/`onChange` for `Select`, `Checkbox`, `DatePicker`, `RupiahInput`, pickers. Never pass a `ref` — `FormField` registers its own focus target.
- Submit: `form.handleSubmit(async (values) => { try { await sendJson(url, { method, body }, fallback); … } catch (err) { applyServerErrors(form, err, fallback) } })` — `sendJson` (`lib/api/send-json.ts`); `applyServerErrors` (`lib/forms/server-errors.ts`) maps a `validateBody` 400 onto fields, anything else to `<FormRootError>` + toast.
- Dialog: `<form id={formId} onSubmit={…} noValidate>` with `<FormRootError formState={form.formState} />` first, and `footer={<FormDialogFooter formId pending={form.formState.isSubmitting} onCancel submitLabel />}`. Page-level forms add `useUnsavedChangesGuard(form.formState.isDirty)` and `form.reset(saved)` after saving.

**Four rules learned the hard way:**
1. **Every issue the schema can raise must land on a rendered field.** A refine at an object path, an array path (`lines`), or on a field hidden in the current mode blocks submit with nothing on screen. Point `superRefine` issues at a visible field, render array-level errors with `<FieldError>`, and give edit dialogs a schema that only validates what they show. This includes a hidden value carried purely for comparison (e.g. `swapClassSessionTeacherFormSchema`'s `defaultTeacherId`, never itself rendered) — its `superRefine` issue still targets the visible field (`substituteReason`), not the hidden one.
2. **Edit bodies must still carry cleared fields, as an explicit `null`.** `optionalTrimmed` turns `""` into `undefined`, which `JSON.stringify` drops; a PUT route reads an omitted key as "keep", so a form schema that wants to clear a field must emit `null` for it, not drop it (see `studentFormSchema`, `guardianUpdateFormSchema`'s `childOrder`).
3. **Blank numbers are not zero.** `z.coerce.number()` turns `""` into `0`. Preprocess `""` → `undefined`/`null` and give a required number its own "wajib diisi" message, unless the old behaviour genuinely defaulted to 0.
4. **String→value preprocessing lives only in the form-derived schema, never the wire schema it's derived from.** Blank-to-null, the `childOrder` null-vs-keep split, and similar coercions belong in the same `lib/validations/*` file's form schema; `lib/validations/__tests__/form-api-roundtrip.test.ts` is the one place that pins both ends of the round trip.

**Named exceptions** (grid/wizard editors, not field forms — stay hand-rolled): billing-run wizard *steps* (the shell is `ResponsiveFormDialog`), raport editor, report-card narrative templates, assessments score grid, Tarif per Program table, themes/subtema/pekan hierarchy, bulk-promote mapping, filter bars.

## Required-field indicator

`<FieldLabel required>Nama</FieldLabel>` renders an `aria-hidden` red asterisk and sets `aria-required` on the underlying label. Callers MUST also pass `required` (or `aria-required`) to the form control itself so screen readers announce required state. Inline `Nama *` strings are deprecated.

## Primary-Action Placement

One rule, no detached button rows:

- **Page-level primary action** (e.g. "Tambah Siswa" on a list) → `PageHeader`'s `actions`.
- **Tab- or section-scoped primary action** (e.g. "Tambah Komponen" on one tab of a tabbed page) → that section's `DataTableToolbar` `actions` slot, same row as search/filters.
- Never a bare `<Button>` row floating above or beside the toolbar.

## Detail Header Actions

`DetailPageHeader` (`components/admin/detail-page-header.tsx`) takes structured `primaryActions` / `menuActions` instead of a free-form `actions` node:

- **At most two visible actions** (`primaryActions`, `variant: "outline"` by default) — a third is silently dropped, so don't pass a third.
- At most **one** `primaryActions` entry may be `variant: "default"` (filled) — it reads as *the* primary action.
- Everything else, and **every destructive action**, goes in `menuActions` (rendered in the `⋯` `DropdownMenu`). Destructive entries always render last, after a separator from the non-destructive ones.
- The legacy `actions` prop (an arbitrary `ReactNode`) still works for callers not yet migrated, but new detail pages use `primaryActions`/`menuActions`.

## AdminTabs Layout

`AdminTabsList` (`components/admin/admin-tabs.tsx`) owns tab-strip layout: a single row that scrolls horizontally on narrow screens instead of wrapping. Pages must not pass a `className` that overrides this (`flex-wrap`, `w-full`, etc.) — a wrapped strip drops a tab onto its own centred row where it reads as a heading, not a tab.

## Toolbar Reset

`DataTableToolbar`'s "Atur Ulang" button only renders while a search, `filters` entry, or `hasExternalFilter` is active — never as a permanently-visible disabled control. It's a ghost button with a leading `X` icon.

## Structured Inputs

Never a raw `<input type="date">` or a hand-parsed `<input type="number">` for money in `app/admin/**` — use the shared primitive:

| Need | Use |
|---|---|
| Date | `<DatePicker>` (`components/ui/date-picker.tsx`) — same `value`/`onChange` shape as the native input (`YYYY-MM-DD` string); renders the native input on `pointer: coarse` (touch already has a good platform picker) and a shadcn `Calendar` + `Popover` on a fine pointer. |
| Money | `<RupiahInput>` (`components/ui/rupiah-input.tsx`) — "Rp" prefix, id-ID thousands separators while typing, emits an integer or `null`, right-aligned `tabular-nums`. |
| Async typeahead (search-as-you-type over a fetcher) | `<AsyncCombobox>` (`components/ui/async-combobox.tsx`) — debounced, abortable, idle/loading/error/empty states, optional grouping. `parent-picker` / `student-picker` / `class-section-picker` are built on it; `ClassSectionMultiPicker` stays hand-rolled (multi-select doesn't fit a single-value primitive). |

## DataTable Standard

Any list >10 items: use `<DataTable>` with server-side pagination, column sorting, search, status filter.

**Every DataTable MUST have:**
1. Sortable column headers (`DataTableColumnHeader`)
2. Skeleton loading state (Shadcn `Skeleton`)
3. Status filter (Aktif/Tidak Aktif at minimum)
4. Action column with: **⋮ dropdown** (Edit, Deactivate) — identity is the link, see below

`<DataTable>` takes an `emptyAction?: { label; onClick?; href? }` prop, passed through to `EmptyState`'s own action, for the empty-state primary CTA (e.g. campuses passes `{ label: "Tambah Kampus", onClick: openNew }`, and hides it — `undefined` — while a filter such as Nonaktif is active, since "add" doesn't belong on a filtered empty result).

### Mobile contract (`<md`)

`components/ui/data-table.tsx` renders every list identically below `md` — no per-page opt-in beyond column `meta`:

- Mark secondary columns (created/updated-at, ids, anything not needed to identify or act on the row) `meta: { priority: "low" }` — hidden below `md`, back on `md+`.
- The action column (`id: "actions"`, from `DataTableRowActions`) is automatically sticky-right below `md` with a left shadow and opaque background; a column can opt in explicitly with `meta: { sticky: "right" }` if a page names its actions column differently.
- Repeat the few facts a phone user needs (class, status, date) under the name with `<DataTableMobileMeta>` (`components/ui/data-table-mobile-meta.tsx`, `md:hidden`, wraps) — pass it as `description` of the identity `DataTableLinkCell`. Every `whitespace-nowrap` cell adds to the table's minimum width, so a wide identity cell has to be wrappable (`whitespace-normal`) or the table overflows and the amount/status columns end up under the sticky actions column.
- Pass `isFiltered` to `<DataTable>` while a search or filter is active: an empty result then reads "Tidak ada hasil yang cocok" instead of the first-run copy and CTA.
- Aim for **≤3 visible data columns + actions at 390px** — everything else is `priority: "low"`.
- **Define `columns` so cell identity is stable** — module-level, or `useMemo` with a tight dependency array, and declared above any early-return (a page that returns a loading skeleton before its own `columns` definition rebuilds it on every render once past that guard). Row-action handlers passed into `columns` go through `useCallback`. TanStack `flexRender` mounts each `cell` function as its own component; a `columns` array rebuilt on every render remounts every cell, which loses focus in an inline input and closes an open row-actions menu. For an inline-edit cell (e.g. a per-row `RupiahInput`), pass the live value/setter through React context or table `meta` instead of closing over page state in the column definition — see `app/admin/fees/page.tsx`'s `STRUCTURE_COLUMNS` + `TarifContext` for the pattern.

### Name is the link

The row's identity cell (name, title, code) is a `DataTableLinkCell` (`href` for a detail route, `onClick` for an overlay view), not plain text. There is no separate "Lihat" action; the `⋯` menu keeps Edit and the terminal action. Pass `onView` only for a row with no link target of its own, never alongside a link cell that opens the same view.

### Column header casing — title case

All admin-table column headers are **title case**, never ALL CAPS or lowercase. Pass the literal display string (`"Status Akun"`); `DataTable` applies no CSS `uppercase`.

Rules:
- One word → initial capital: `Kampus`, `Status`, `Peran`, `Kelas`, `Rekening`, `Pulang`.
- Multi-word → each significant word capitalized: `Login Terakhir`, `Status Akun`, `No. Rekening`, `Total Hadir`.
- Established Indonesian abbreviations stay all-caps in their natural form: `NIK`, `NIP`, `NPSN`, `BPJS`, `DPLK`.
- Brand/loanwords keep their canonical casing: `Xendit`, `PDF`, `BCA`.
- Cell content uses the same convention via a `formatXxx()` helper (`formatRupiah`, `getRoleLabel`, `formatDate`, etc.) — never render raw database enums directly.

An emphasised heading inside a card (not a table column) uses `SectionHeading`, which keeps `uppercase` on purpose.

## DataTable Action Column Standard

Use `<DataTableRowActions>` component (`components/ui/data-table-row-actions.tsx`). The prop you pass for the terminal action depends on the entity's CRUD category (see `.claude/standards/crud.md`):

| Category | Terminal prop | Menu label |
|---|---|---|
| A — Binary soft-delete | `onDeactivate` / `onActivate` + `isActive` | Nonaktifkan / Aktifkan |
| B — State-machine (Admission) | `onCancel` | Batalkan |
| B — State-machine (Invoice) | `onVoid` | Batalkan |
| C — Event-log (StudentAttendance) | `onVoid` | Batalkan |

- **Dropdown (⋮):** `onEdit` + one terminal prop (`onDeactivate` | `onCancel` | `onVoid`).
- Never hard delete. Never use `extraActions` for "Batalkan" / "Nonaktifkan" — use the dedicated prop so menu labels and icons stay consistent.
- `extraActions` is reserved for **domain-specific** actions (e.g. "Setujui" / "Tolak" on the LeaveRequest approval queue; "Terima & Jadikan Siswa" is the formulir detail's primary action, not an `extraActions` entry).

```tsx
// identity cell (Category A — binary):
cell: ({ row }) => (
  <DataTableLinkCell href={`/admin/students/${row.original.id}`}>
    {row.original.name}
  </DataTableLinkCell>
),

// action column, same row:
<DataTableRowActions
  onEdit={() => setEditTarget(row.original)}
  onDeactivate={() => setDeactivateTarget(row.original)}
  isActive={row.original.status === "ACTIVE"}
/>

// Category B — state-machine (Invoice):
<DataTableRowActions
  onEdit={() => setEditTarget(inv)}
  onVoid={canVoid ? () => setVoidTarget(inv) : undefined}
/>
```

**Workflow-queue exceptions** (documented — do NOT "fix"):
- **PayrollRun list** (`/admin/payroll`): identity cell links to the run detail page; no `⋯` menu at all. All state transitions (approve, export, send-slips) happen on the detail page. The list is a directory, not an editor.
- **LeaveRequest approval queue** (`/admin/leave-requests`): identity cell links to detail + `extraActions` ("Setujui" / "Tolak"). Approvals ARE the domain action — there is no generic edit or deactivate.
- **Daily attendance views** (`/admin/attendance`, `/admin/assessments/*` score entry): single-purpose cell editors, no terminal state. Override-only is correct.
