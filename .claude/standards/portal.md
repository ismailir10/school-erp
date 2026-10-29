# Portal Consistency Standard

> Loaded on demand by `/build` when staged paths match `app/teacher/**`, `app/parent/**`, `app/**/layout.tsx`, `components/{teacher,parent}/**`, or `lib/format.ts`.

> Admin, Teacher, and Parent portals MUST use the same Shadcn components and patterns.

**Canonical reference:** `.claude/standards/design-system.html` — §14 Portal Shell, §15 Student Journal, §16 Attendance Flows. Read the relevant section before touching portal code.

## All Portals Must Use:

| Need | Use | NEVER |
|------|-----|-------|
| Data display | `DataTable` (if >10 items) or Card list (if <10) | Custom divs with `.map()` |
| Status display | `StatusBadge` | Inline `Badge` with hardcoded colors |
| Empty state | `EmptyState` component | Plain `<p>` or `<div>` |
| Loading state | Shadcn `Skeleton` | `animate-pulse` divs |
| Currency | `formatRupiah()` from `@/lib/format` | Inline `.toLocaleString()` |
| Dates | `formatDate()` / `formatDateShort()` from `@/lib/format` | Inline `new Date().toLocaleDateString()` |
| Time | `formatTime()` from `@/lib/format` | Inline formatting |
| Colors | CSS variables (`text-primary`, `text-destructive`, etc.) | Hardcoded hex (`text-[#5DB4B8]`, `bg-[#00B37E]`) |
| Errors | `toast.error()` from sonner | `alert()` or `console.error()` only |
| Confirmations | `ConfirmDialog` | `window.confirm()` |
| Forms | `FormField` + Zod validation | Raw `Label` + `Input` |

## Portal Navigation Standard

**Teacher Portal** (mobile-first, max-w-md):
- Header: logo + school name + user name + logout button
- Bottom nav: exactly four direct destinations — **Beranda**, **Kelas**, **Jurnal**, **Penilaian** — plus a fifth **Lainnya** overflow trigger, with icons + labels + active indicator
- `Lainnya` opens the teacher overflow sheet (`components/teacher/more-sheet.tsx`) and owns **Kehadiran Saya**, **Slip Gaji**, and **Profil Saya**; new teacher account/secondary destinations go into `TEACHER_MORE_ITEMS`, never into the direct tab array
- Nested teacher routes must activate their owning direct destination or the `Lainnya` overflow state (for example, salary-slip detail → `Lainnya`); no nested route may leave the bottom navigation without an active owner
- Content: centered `max-w-md`

**Parent Portal** (mobile-first, max-w-md — MUST match teacher pattern):
- Header: logo + school name + user name + logout button (same as teacher)
- Bottom nav: 4 destination tabs (Beranda, Tagihan, Kehadiran, Jurnal) **+ a `Lainnya` overflow tab** — icons + labels + active indicator
- `Lainnya` opens a bottom sheet (`components/parent/more-sheet.tsx`) holding the weekly/semester/account surfaces: Capaian, Rapor, Profil
- New parent destinations go into `PARENT_MORE_ITEMS`, **never** into the tab array
- Content: centered `max-w-md` (NOT max-w-2xl — parents are mobile users)
- Logout: accessible from header (same pattern as teacher)

**Both portals MUST have:**
- At most five bottom-nav slots: four direct destinations plus an overflow trigger whenever more surfaces are needed
- Active state on current tab (teal underline + icon color)
- Logout button in header with `aria-label="Keluar"` for accessibility (`title` is optional)
- Framer Motion `layoutId` for smooth active indicator animation, guarded by `useReducedMotion()`
- Safe area padding for mobile (`safe-area-bottom` on bottom nav)
- A visible `focus-visible` ring on every tab (keyboard users get no usable default inside a fixed bar)
- Explicit, stable labels for every tab and overflow-sheet action; icon-only navigation is forbidden

### Bottom-nav width budget — hard limit, 5 slots

Each slot carries `px-1` (8 px), so the usable label width is `viewport / n − 8`:

| Slots | Slot @375 | Label budget @375 | Label budget @360 | Verdict |
|---|---|---|---|---|
| 4 | 93.8 px | 85.8 px | 82.0 px | roomy — fits `Penghubung` (73.5 px) |
| 5 | 75.0 px | 67.0 px | 64.0 px | **ceiling** — fits `Kehadiran` (57.8 px) at both widths |
| 6 | 62.5 px | 54.5 px | — | **broken** — last slot lands 27.4 px past a 375 px viewport and is absent entirely at 360 px |

Reference label widths at `text-xs font-medium`: `Kelas` 31, `Jurnal` ~40, `Lainnya` 43, `Tagihan` 44, `Beranda` 49, `Penilaian` 51, `Kehadiran` 58, `Penghubung` 73 (**does not fit a 5-slot bar at any supported width** — both portals use `Jurnal` for this surface).

Measured 2026-08-01 (cycle `parent-nav-mobile-proposal`) after the parent bar had drifted to 6 tabs. Two rules follow:

1. **Never exceed 5 slots.** Beyond 4 destinations, the 5th slot is an overflow trigger.
2. **Slots must use `flex-1 basis-0`, not bare `flex-1`.** With `flex-basis: auto` each slot is sized by its own label, so the row's width is the sum of the labels and it can overflow its container. `basis-0` forces identical `container / n` slots, which caps the row and keeps tap targets uniform.

## Empty State Contract

**Every conditional list render MUST have an explicit else branch that renders visible content.** Rendering nothing in the empty case is a Playwright test failure waiting to happen — every E2E test asserts visible text on the page.

```tsx
// CORRECT — always render something
{items.length > 0 ? (
  <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
) : (
  <EmptyState title="Belum ada data" description="Data akan muncul setelah ditambahkan" />
)}

// WRONG — renders literally nothing when empty (test will fail)
{items.length > 0 && (
  <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
)}
```

**Rule:** If a page or component conditionally renders a list based on fetched data, it MUST render an `<EmptyState>` or at minimum visible text in the empty branch. This applies to all portals (admin, teacher, parent) and all page types (list pages, detail pages, dashboard cards).

## Portal Text-Size Scale

Target device for parent + teacher portals: mid-range Android at 375 px viewport, arm's-length reading, sometimes 4G and sunlight.

**Minimum text size: `text-xs` (12 px).** The following classes are BANNED in `app/parent/**`, `app/teacher/**`, `components/parent/**`, `components/teacher/**`, `components/portal/**`:

- `text-[10px]`
- `text-[11px]`

Use the standard Tailwind scale only. When 12 px still feels too dense, loosen the surrounding layout (padding, line-height, grid columns) rather than shrinking text.

Rationale: screenshots + audits surfaced that labels at 10 px were consistently missed by the target persona (Pak Budi, PAUD/TKIT parent) and failed WCAG AA contrast-size combinations on muted-foreground. Codified 2026-04-21 in cycle `parent-ux-cycle-1`. Teacher portal text-size sweep completed 2026-04-22 in cycle `parent-portal-polish-cycle-2`; both parent and teacher portals are now clean against the banned-size grep.

Grep gate (should return zero):
```bash
grep -rn 'text-\[10px\]\|text-\[11px\]' app/parent app/teacher components/parent components/teacher components/portal
```

## PortalTabs Primitive

Shared horizontal-scroll tab bar for parent + teacher portals. Located at `components/portal/portal-tabs.tsx`.

**Use it whenever** you render >2 horizontal options that may overflow the 375 px viewport (child selector, filter tabs, segmented status filters, etc.). Replaces hand-rolled `flex gap-2 overflow-x-auto` patterns.

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `items` | `{ id, label, secondary?, count? }[]` | `secondary` renders as muted `text-xs`; `count` renders as a badge pill |
| `activeId` | `string` | Controlled — consumer owns state |
| `onSelect` | `(id: string) => void` | Fires on click AND on keyboard nav |
| `variant` | `'pills' \| 'underline'` | Default `pills` |
| `ariaLabel` | `string?` | Applied to the `role="tablist"` container |

**Behaviour:**
- Horizontal scroll with edge-fade mask so truncated content hints at more.
- Active tab auto-scrolls into view (`scrollIntoView({ block: 'nearest', inline: 'center' })`).
- Keyboard: ArrowLeft / ArrowRight wrap-around, Home / End jump to ends.
- Roving tabindex, `role="tablist"` / `role="tab"` / `aria-selected` per WAI-ARIA.
- No internal `activeId` state — fully controlled.

**Example:**

```tsx
<PortalTabs
  items={[
    { id: "all", label: "Semua", count: 5 },
    { id: "unpaid", label: "Belum Bayar", count: 2 },
    { id: "partial", label: "Dibayar Sebagian", count: 1 },
  ]}
  activeId={value}
  onSelect={setValue}
  variant="pills"
  ariaLabel="Filter tagihan"
/>
```

**Consumer migration status (as of 2026-04-21):**
- Parent: `child-selector-tabs`, `invoice-filter`, `student-journal` child pills → migrated in cycle `parent-ux-cycle-1`.
- Teacher: pending (cycle 2).

## Component Reusability Layers

Three distinct layers — pick the narrowest that fits. If a pattern lands in two portals, migrate to `components/portal/**` within the same cycle. **The 2nd instance is the extraction trigger.**

| Layer | Location | Owns | Consumers |
|---|---|---|---|
| Primitive (cross-portal) | `components/portal/**` | Stateless/low-state UI shared by ≥2 portals | Parent + teacher + admin when applicable |
| Portal composition | `components/{parent,teacher,admin}/**` | Portal-flavoured wiring around primitives (data fetch, link targets, copy) | That portal only |
| Page-local | Next to the page (`app/.../route-specific.tsx`) | One-off markup with no reuse potential | That page only |

## PortalHeader Primitive

Shared sticky top-of-page header for parent + teacher portals. Located at `components/portal/portal-header.tsx`.

**Use it** as the top-level `<header>` inside every portal layout. Logo + brand on the left, avatar + first name + logout on the right. Sticky, `h-14`, `max-w-md mx-auto`, `px-5`.

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `userName` | `string` | Full name; first word becomes the visible label |
| `userSubtitle?` | `string` | Optional second line (role, class); hidden on narrow widths |
| `avatarUrl?` | `string` | Optional avatar image URL; falls back to initials |
| `avatarFallback` | `string` | 1–2 char fallback when `avatarUrl` absent. Required |
| `profileHref?` | `string` | When set, avatar + name become a link to this path |
| `onLogout` | `() => void \| Promise<void>` | Required. Trailing icon button fires this |
| `brandLabel?` | `string` | Defaults to `"An Nisaa'"` |

**Example:**

```tsx
<PortalHeader
  userName={session.user.name}
  userSubtitle="Guru Kelas TKA"
  avatarFallback={initials(session.user.name)}
  profileHref="/teacher/profile"
  onLogout={logoutAction}
/>
```

## PortalBottomNav Primitive

Shared fixed bottom navigation bar for parent + teacher portals. Located at `components/portal/portal-bottom-nav.tsx`. 4–5 tabs with icons + labels + animated active indicator. See the width budget above — 5 is a hard ceiling, not a style preference.

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `items` | `PortalBottomNavItem[]` | Union of link and action items, max 5 |
| `layoutId?` | `string` | Framer Motion layoutId for the active pill; default `"portal-bottom-nav-active"` |
| `ariaLabel` | `string` | Applied to the `<nav>` element |

**Item variants:**

| Variant | Shape | Renders as |
|---|---|---|
| link (default) | `{ kind?: "link", label, href, icon, matcher? }` | `<Link>` with `aria-current="page"` when active. `matcher` lets a tab own multiple routes |
| action | `{ kind: "action", label, icon, onSelect, expanded?, active? }` | `<button aria-haspopup="dialog" aria-expanded>` — for an overflow sheet. Not a destination, so it must not carry `aria-current` |

Canonical consumers: `components/parent/bottom-nav.tsx` and `components/teacher/bottom-nav.tsx`.

**Example:**

```tsx
<PortalBottomNav
  ariaLabel="Navigasi utama"
  items={[
    { label: "Beranda", href: "/parent", icon: Home },
    { label: "Tagihan", href: "/parent/invoices", icon: CreditCard },
    { label: "Kehadiran", href: "/parent/attendance", icon: CalendarDays },
    { label: "Rapor", href: "/parent/reports", icon: GraduationCap },
  ]}
/>
```

## PageHeader Primitive

Shared in-content page header for portal routes (title + optional subtitle + optional actions slot). Located at `components/portal/page-header.tsx`.

**Use it** as the first child of every portal page. Semantic `<header>` with `<h1>`. Do NOT hand-roll `h1` + `p` headers in new pages.

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `title` | `string` | Plain string — no icons. If you need adornment, wrap the primitive |
| `subtitle?` | `string` | Renders below the h1 as muted text |
| `actions?` | `ReactNode` | Right-aligned slot for filters, CTAs; hidden on narrow widths via shrink-0 |
| `className?` | `string` | Merged into the outer `<header>` |

**Spacing contract:**
- Block margin: `mb-6`
- Title: `text-2xl font-semibold tracking-tight text-foreground`
- Subtitle: `text-sm text-muted-foreground mt-1`

**Example:**

```tsx
<PageHeader
  title="Tagihan Saya"
  subtitle="Kelola pembayaran bulanan anak Anda"
  actions={<Button size="sm">Unduh</Button>}
/>
```

## Spacing Scale

Canonical spacing for parent + teacher portals. Pull from this table before inventing new values.

| Surface | Mobile | Desktop |
|---|---|---|
| Page-level (layout) | `px-5 py-6` | `md:px-8 md:py-8` |
| Page-header block | `mb-section` | `mb-section` |
| Section gap inside page | `space-y-4` | `space-y-6` |
| Card padding | `p-4` | `md:p-6` |
| Sheet padding | `p-5` | `p-6 md:p-8` |
| Task row | `min-h-17` | `min-h-17` |

## Error Handling Standard

Every `fetch()` call MUST check response:
```tsx
const res = await fetch("/api/...");
if (!res.ok) {
  // readApiError (lib/api/client-errors.ts) keeps the server's Indonesian copy and maps
  // 401/403/5xx to ours; toastCaughtError (lib/feedback.ts) never shows a raw err.message.
  toastCaughtError(await readApiError(res, MESSAGES.generic), MESSAGES.generic);
  return;
}
const data = await res.json();
```

Never silently ignore errors: `.catch(() => {})` is forbidden.

## Household Overview (Parent Home)

**Rule:** parent home shows all children together, each with a clear next action or recent signal. This applies equally to two-child and larger households; a child switcher can remain inside detail pages.

**Why:** pill-tabs scale badly past 2 kids (wrap / overflow on 375 px), hide the non-selected child's state ("did I pay Yusuf's too?"), and force the parent to tab through each kid to find the one that needs attention. Household Overview makes "which child needs me right now?" the default question.

**Pattern:**
- Show a summary of verified urgent items when present. Derive urgency from actual records, never from missing attendance or an empty API response.
- One card per child — avatar + name + class + a verified recent signal or task.
- Give each child a small set of useful actions (for example, invoice and teacher note). Keep labels explicit and avoid a fixed three-cell grid when it hides the action text.
- Chevron on each row → child detail.
- Inner tabs (Tagihan / Kehadiran / Rapor) inside a child detail use a pinned top-level switcher (Option C from the brainstorm in `design-system.html` §14).

**Forbidden for larger households:**
- `<PortalTabs>` as the child switcher on parent home.
- "Select a child" dropdown in the header — hides state, defeats the purpose.

See `design-system.html` §14 for full mockup and the 4-option brainstorm behind this choice.

## WeekGrid Contract (Buku Penghubung)

The shared Student Journal grid used by both teacher (editable) and parent (read-only) views. Component lives at `components/portal/week-grid.tsx` (or its cycle-current equivalent — extraction trigger is the 2nd consumer).

**Rules:**
- **Same component, three modes:** `<WeekGrid editable onToggle>` (teacher entry) · `<WeekGrid readonly>` (parent view) · `<WeekGrid home-note>` (parent write — catatan tab).
- **Sticky first column** — indicator / category label, pinned so horizontal scroll doesn't lose context.
- **Category groupings** — Ibadah / Akademik / Karakter (school-defined). Grouped headers, not flat.
- **Today's column highlighted** — primary-tinted cell background on today's weekday.
- **Tap-to-toggle cells** — teacher mode cycles through states; parent mode is read-only. Minimum tap target: 32 px cell height, 40 px column width, 3 px vertical row margin, 0.5 rem column gap.

See `design-system.html` §15 for the mockup and the teacher-entry / parent-view state diagram.

## Class Attendance Entry

Class attendance entry (`/teacher/class-attendance`) is exception-first: most children are present, so the teacher marks the exceptions and records everyone else in one tap.

**Rules:**
- **Unknown stays unknown.** A missing record is not PRESENT or ABSENT. Only show a status when the API has recorded it or a teacher explicitly selects it.
- **Bulk for the common case.** A sticky "Tandai N siswa lainnya Hadir" button records every child *without* a status as Hadir in one request. It never overwrites a recorded status.
- **State choice is explicit.** Each row offers H · S · I · A (rapor order) as a radio group; one tap selects and saves. No cycle controls — a hidden rotation made Izin four taps and one extra tap saved Alpa.
- **Live summary** above the list: "Hadir N · Sakit N · Izin N · Alpa N · N belum", counting confirmed saves only.
- **Save feedback matches persistence.** One page-level status line (saving / saved). A failed row shows its error and "Coba lagi" inline; a failed bulk save puts its rows back to unknown and the bulk button is the retry.
- **Row tints** match the recorded state via `--status-*-subtle`.

## Portal Primitive Inventory

**Current (as of 2026-04-22):**
- `PortalHeader` — `components/portal/portal-header.tsx`
- `PortalTabs` (with `leading` slot) — `components/portal/portal-tabs.tsx`
- `PortalBottomNav` — `components/portal/portal-bottom-nav.tsx`
- `PageHeader` — `components/portal/page-header.tsx`

**Cycle-3 extraction candidates (2nd-instance trigger pending):**
- `PortalError` — unify parent + teacher `error.tsx` fallbacks
- `PageSkeleton` / `ListSkeleton` / `DetailSkeleton` — shared skeleton primitives for portal pages
- `RecentActivity` — promote from `components/parent/**` to `components/portal/**` if teacher home adopts the pattern
