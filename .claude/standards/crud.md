# CRUD Standard (Inspired by ERPNext)

> Loaded on demand by `/build` when staged paths match `app/admin/**` **and** the file contains `<Dialog` / `FormField` / `<Field` / a create-or-edit form pattern.

> Every entity in the system MUST support full CRUD. No create-only or read-only entities.

Entities fall into **three categories**. Pick the right one before you build — forcing the wrong pattern makes the UI lie.

## Category A — Binary soft-delete entities (default)

**Who:** User, Campus, OrgConfig, Employee, Student, Guardian (StudentGuardian), StudentEnrollment, TeachingAssignment, Program, ClassSection, FeeComponentDef, ProgramFeeStructure, AcademicYear, AssessmentTemplate, AssessmentCategory, AssessmentIndicator, SalaryComponentDef, LeaveRequest.

| Operation | UI Pattern | API Pattern |
|-----------|-----------|-------------|
| **Create** | Dialog form or `/new` page | `POST /api/{entity}` with Zod validation |
| **Read** | DataTable (list) + Detail page/Sheet | `GET /api/{entity}` paginated, `GET /api/{entity}/[id]` |
| **Update** | Edit dialog (same form as create, pre-filled) | `PUT /api/{entity}/[id]` with Zod validation |
| **Deactivate** | ConfirmDialog via dropdown action | `PUT /api/{entity}/[id]` with `{ status: "INACTIVE" }` |

- **NEVER hard delete records.** Use `status` field with `ACTIVE` / `INACTIVE`.
- All list queries default to `WHERE status IN ('ACTIVE')` unless filter says otherwise.
- DataTable status filter always includes "Semua Status", "Aktif", "Tidak Aktif".
- DataTable action column: `<DataTableRowActions>` with identity-cell link (see `ui.md` "Name is the link") + `onEdit` + `onDeactivate`.

**Documented exception — Holiday.** Holiday has no `status` field and is intentionally hard-deleted (`app/api/config/holidays/[id]/route.ts` — `DELETE` calls `prisma.holiday.delete`, not a status update): it's a config entity naming a single calendar day, not a record with a lifecycle worth preserving, and deleting one must free that day back to a normal working day. Its list/dialog otherwise follows Category A (DataTable, `ResponsiveFormDialog` create/edit) — only the terminal action differs: `<ConfirmDialog destructive>` calling `DELETE`, not deactivate.

## Category B — State-machine entities (workflow)

**Who:** Admission, Invoice, PayrollRun.

Status is a state machine, not a binary flag — `Deactivate` doesn't apply. The terminal action is named for the domain:

| Entity | States | Terminal action | UI label | API |
|--------|--------|-----------------|----------|-----|
| Admission (lead) | `INQUIRY` (shown **Baru**) · `CANCELLED` (**Batal**); everything after is derived, see below | Cancel | "Batalkan" | `PUT /api/admissions/[id]` with `{ status: "CANCELLED" }` |
| Invoice | `DRAFT → SENT → PARTIALLY_PAID → PAID` · `OVERDUE` · `CANCELLED` | Void | "Batalkan" | `POST /api/invoices/[id]/void` |
| PayrollRun | `DRAFT → APPROVED → SLIPS_SENT` | (none — workflow-only) | — | `POST /api/payroll/[id]/{approve,send-slips,export/bsi}` |

- **Admission Tahap is derived, never clicked.** The lead stores only Baru / Batal; the list shows a **Tahap** from the lead, its formulir (`EnrollmentApplication`) and the student link: *Baru* → *Formulir dikirim* → *Formulir masuk* → *Diterima* → *Siswa*, plus *Ditolak* and *Batal* (`lib/admission/stage.ts`, one map for the row chip and the filter). Legacy `VISIT_SCHEDULED` / `VISITED` read as *Baru* and `UNDER_REVIEW` as *Formulir masuk*; no screen offers them. The primary row action follows the Tahap (Kirim Formulir → Salin/Kirim ulang tautan → Terima & Jadikan Siswa → Lihat siswa); *Terima & Jadikan Siswa* is the formulir detail's primary action (one route, `POST /api/enrollments/[id]/convert`, two-way confirms for a possible duplicate student or wali), not an `extraActions` entry.
- Row identity cell links to the detail page (`DataTableLinkCell` — see `ui.md` "Name is the link"); action column: `<DataTableRowActions>` with `onEdit` + `onCancel` **or** `onVoid` (domain-appropriate). Terminal action is **hidden or disabled** when the row is already in a terminal state (`CANCELLED` / `PAID` / `VOIDED`).
- PayrollRun has no terminal "cancel" — its actions are workflow transitions handled on the detail page, not the list. Its list row is link-cell-only (no `⋯` menu at all — no `onEdit`, no terminal action); this is a **documented exception**.
- All mutation endpoints still require Zod validation and `canViewSalary(session.role)` where relevant.

## Category C — Event-log entities (no CRUD, event + void)

**Who:** AttendanceRecord (employee check-in/out), StudentAttendance (daily marking).

Immutable events appended by the system; correction via override/void, not edit.

| Operation | UI Pattern | API Pattern |
|-----------|-----------|-------------|
| Create | Auto (check-in/out) or bulk-mark dialog | `POST /api/attendance/check-in`, `POST /api/student-attendance/mark` |
| Read | Daily/monthly grid (not a DataTable of events) | `GET /api/attendance?date=...` |
| Correct | Override modal on the event row | `POST /api/attendance/[id]/override`, `PUT /api/student-attendance/[id]` |
| Void | Dropdown action — clears the event | `isVoided = true` (boolean flag, not `status`) |

- These entities intentionally use `isVoided: Boolean` instead of `status: String` because voiding is reversible audit, not a lifecycle state.
- Daily-view pages (AttendanceRecord) do **not** use the standard list layout — they render a per-day grid or today-only view. Documented exception.
- **Correction semantics:** AttendanceRecord and StudentAttendance are event logs. Corrections are made via **override** (creates a new canonical event) or **void** (flips `isVoided`). There is NO row-level Edit action on these entities — exposing one (even as a relabeled dropdown item) would contradict the event-log contract. When rendering row actions on an AttendanceRecord list, use `extraActions` with an explicit `"Timpa"` label, **not** `onEdit`. (The bilingual `"Timpa (Override)"` gloss is retired — see `voice.md`'s glossary, which owns terminology.)

## Which category fits a new entity?

- Does the entity have a single "trash it" meaning? → **Category A**.
- Does it have multiple states with different terminal outcomes (cancel vs complete vs void)? → **Category B**.
- Is it an immutable event the system generates? → **Category C**.

## List Page Layout Standard

Every **operational** admin list page (day-to-day volume: students, invoices, admissions, leave requests, ...) follows this structure:
```
PageHeader (static purpose line + "Tambah" button — no live count in the description)
├── StatsCardsRow (operational lists only — cols 2-6, see ui.md)
├── DataTableToolbar (search + status filter + any domain filters)
└── DataTable (sortable columns + standard action column)
```

**Config lists get no `StatsCardsRow`.** Settings-hub entities (campuses, academic years, holidays, salary components, users, roles, templates) go straight from `PageHeader` to `DataTableToolbar` — a metric row over a list that changes a few times a year is noise, not signal.

**`PageHeader` description is a static purpose line, never a live count.** "Kelola data siswa aktif dan riwayat", not "142 siswa aktif terdaftar". Counts live in `StatsCardsRow` or the toolbar, where they're styled as data rather than prose.

## Detail Page Layout Standard

Two layouts — pick by `patterns.md` Recipe 2's trigger rule (read-overview + 3-or-more independent concerns → 2b; otherwise 2a). See `docs/cycles/2026-09-03-detail-page-pattern-decision.md` for the reasoning and the retrofit backlog.

**Recipe 2a — Simple Detail** (single-concern entities, editors, workflow tools):

```
Back link ("← Kembali ke Daftar {Entity}")
PageHeader (title + description + StatusBadge + action buttons)
├── Summary Card (read-only info grid, 2-col)
└── Tabs (if entity has 2 concerns — 3+, move to Recipe 2b)
    ├── Tab 1: Primary related data
    └── Tab 2: Secondary data
```

**Recipe 2b — Dossier** (multi-concern overviews, e.g. `students/[id]`):

```
DetailPageHeader (title + description + StatusBadge + action buttons)
├── DossierNav (sticky, anchors to each section below)
├── DossierSection × N (one per concern — finance, academics, documents, ...)
└── DetailRail (desktop aside, collapses to inline flow below lg)
    ├── RailStatTiles (glanceable KPIs — "not loaded" ≠ real zero)
    ├── RailCard × N (contact, checklist, ...)
    └── quick-contact actions
```

`DetailPageHeader`'s action buttons follow `ui.md`'s Detail Header Actions rule (≤2 visible `primaryActions`, everything else + every destructive action in `menuActions`) — see that file for the prop shape; not restated here.

## Edit Toggle Pattern (Detail Pages)

- **View mode** (default): fields displayed as read-only text (label + value pairs)
- Click **"Edit"** button in PageHeader → switches to **Edit mode**
- Edit mode: same layout positions, values become `<Field>` + `<FieldLabel>` + `<Input>`
- **Save** + **Cancel** (X) buttons appear in the card header
- Cancel reverts to view mode (resets form state)
- Nested entities (guardians, payments) still use **Dialog** for add/edit

```tsx
// Edit toggle pattern:
const [isEditing, setIsEditing] = useState(false);
const [editForm, setEditForm] = useState({ ... });

// View mode: read-only text
<div><p className="text-[10px] text-muted-foreground">Label</p><p className="text-sm font-medium">{value}</p></div>

// Edit mode: Field + Input
<Field><FieldLabel>Label</FieldLabel><Input value={editForm.field} onChange={...} /></Field>
```

## Form Field Standard

Use Shadcn `Field` component (`components/ui/field.tsx`) — **never** raw `Label` + `Input` or custom `FormField`.

```tsx
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field"

<Field>
  <FieldLabel>Nama Lengkap</FieldLabel>
  <Input value={...} onChange={...} />
  <FieldDescription>Optional help text</FieldDescription>
  <FieldError>{error}</FieldError>
</Field>
```

## Dialog Standard

Every create, edit, and action dialog — including nested-entity dialogs and one-off action dialogs (approve, void, override, record payment, ...) — uses `<ResponsiveFormDialog>` (`components/ui/responsive-form-dialog.tsx`). Never hand-roll a `useIsMobile` + `Dialog`/`Sheet` branch. Confirms (destructive or not) are the one exception: they use `<ConfirmDialog>` — never a raw `<AlertDialog>` import (see `ui.md` Overlays Rule).

## Edit Dialog Standard (for nested entities)

- Same form fields as create dialog, pre-filled with current values via `form.reset(values)` — built per `ui.md` → Forms (react-hook-form + the route's zod schema); if edit shows fewer fields than create, validate with an edit-derived schema
- A cleared optional field is sent as an explicit `null`, never omitted (`ui.md` → Forms rule 2); server-side rejection maps onto the field via `applyServerErrors`, never a bare toast.
- Title: "Edit {EntityName}" (e.g., "Edit Wali")
- Save button: "Simpan Perubahan" with loading state (`FormDialogFooter`)
- Cancel button: "Batal"
- On success: `toast.success()` + close dialog + refetch data
