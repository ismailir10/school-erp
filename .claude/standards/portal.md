# Portal Consistency Standard

> Loaded on demand by `/build` when staged paths match `app/teacher/**`, `app/parent/**`, `app/**/layout.tsx`, `components/{teacher,parent}/**`, or `lib/format.ts`.

> Admin, Teacher, and Parent portals MUST use the same Shadcn components and patterns.

**Canonical reference:** `.claude/standards/design-system.html` — §14 Portal Shell, §15 Student Journal, §16 Attendance Flows. Read the relevant section before touching portal code.

## All Portals Must Use:

| Need | Use | NEVER |
|------|-----|-------|
| Data display | `DataTable` (if >10 items) or Card list (if <10) | Custom divs with `.map()` |
| Status display | `StatusBadge` / `Badge` variants (see `ui.md` § Reach for) | A page-local tone map |
| Empty state | `EmptyState` component | Plain `<p>` or `<div>` |
| Loading state | `Skeleton` / `Spinner` (see `ui.md` § Reach for) | `animate-pulse` divs |
| Currency, numbers | `formatRupiah()` / `formatNumber()` from `@/lib/format` (guard rule G) | Inline `.toLocaleString()` |
| Dates | `formatDate()` / `formatDateShort()` from `@/lib/format` | Inline `new Date().toLocaleDateString()` |
| Time | `formatTime()` from `@/lib/format` | Inline formatting |
| Colors | Token utilities (see `colors.md`) | Hardcoded hex or raw palette classes (guard rules A, B) |
| Errors | `toastError` / `toastCaughtError` from `lib/feedback.ts` (see `ui.md` § Feedback) | `alert()` or `console.error()` only |
| Confirmations | `ConfirmDialog` (see `ui.md` § Overlays Rule, § Undo or confirm) | `window.confirm()`, raw `AlertDialog` |
| Forms | `FormField` + Zod validation | Raw `Label` + `Input` |

## Portal Navigation Standard

**Teacher Portal** (mobile-first, max-w-md):
- Header: logo + school name + user name + logout button
- Bottom nav: exactly four direct destinations — **Beranda**, **Absensi**, **Jurnal**, **Penilaian** — plus a fifth **Lainnya** overflow trigger, with icons + labels + active indicator
- `Lainnya` opens the teacher overflow sheet (`components/teacher/more-sheet.tsx`) and holds **Kehadiran saya**, **Slip gaji**, **Profil saya**, **Apa yang Baru**, and **Panduan Talib**; new teacher account/secondary destinations go into `TEACHER_MORE_ITEMS`, never into the direct tab array
- Every teacher route highlights its owning destination. **Gerbang** and **Sesi** belong to **Beranda**. A salary-slip detail belongs to **Lainnya**.
- Content: centered `max-w-md`

**Parent Portal** (mobile-first, max-w-md — MUST match teacher pattern):
- Header: logo + school name + user name + logout button (same as teacher)
- Bottom nav: 4 destination tabs (Beranda, Tagihan, Kehadiran, Jurnal) **+ a `Lainnya` overflow tab** — icons + labels + active indicator
- `Lainnya` opens a bottom sheet (`components/parent/more-sheet.tsx`) holding **Perkembangan**, **Rapor**, and **Profil**. The links carry the active guardian-linked child.
- New parent destinations go into `PARENT_MORE_ITEMS`, **never** into the tab array
- Content: centered `max-w-md` (NOT max-w-2xl — parents are mobile users)
- Logout: accessible from header (same pattern as teacher)

**Both portals MUST have:**
- At most five bottom-nav slots: four direct destinations plus an overflow trigger whenever more surfaces are needed
- Active state on the current tab (teal line at the top and matching icon/label), or on **Lainnya** while its sheet is open
- Logout button in header with `aria-label="Keluar"` for accessibility (`title` is optional)
- Framer Motion `layoutId` for smooth active indicator animation, guarded by `useReducedMotion()`
- Safe area padding for mobile (`safe-area-bottom` on bottom nav)
- A visible focus outline on every tab. The sheet focuses its first link when opened and restores focus to its trigger on dismissal.
- Explicit, stable labels for every tab and overflow-sheet action; icon-only navigation is forbidden

### Bottom-nav width budget — hard limit, 5 slots

With five equal-width slots, a 320 px viewport gives each slot 64 px. Keep `px-0.5` (4 px combined) so the 12 px **Kehadiran** label fits in 60 px. Add new destinations to **Lainnya** once the four direct slots are used. Keep `flex-1 basis-0 min-w-0` for equal slots and verify the text itself fits at 320 px.

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

Rationale: screenshots + audits surfaced that labels at 10 px were consistently missed by the target persona (Pak Budi, PAUD/TKIT parent) and failed WCAG AA contrast-size combinations on muted-foreground. Codified 2026-04-21 in cycle `parent-ux-cycle-1`. Teacher portal text-size sweep completed 2026-04-22 in cycle `parent-portal-polish-cycle-2`; the 12 px floor also applies to bottom-nav labels.

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

**Use it** as the top-level `<header>` inside every portal layout. Logo + brand on the left, avatar + first name + logout on the right. Sticky, `h-14`, `max-w-md mx-auto`, `px-5` (see Spacing Scale).

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
| action | `{ kind: "action", label, icon, onSelect?, drawerTrigger?, expanded?, active? }` | `<button aria-haspopup="dialog" aria-expanded>` — for an overflow sheet. Not a destination, so it must not carry `aria-current` |

Canonical consumers: `components/parent/bottom-nav.tsx` and `components/teacher/bottom-nav.tsx`. Both use `PortalMoreSheet` for overflow and mark the **Lainnya** action as a `drawerTrigger`. The shared sheet owns the link layout, scroll and keyboard focus. The role wrappers supply destinations and any link context.

**Example inside the shared sheet:**

```tsx
<PortalBottomNav
  ariaLabel="Navigasi utama orang tua"
  items={[
    { label: "Beranda", href: "/parent", icon: Home },
    { label: "Tagihan", href: "/parent/invoices", icon: CreditCard },
    { label: "Kehadiran", href: "/parent/attendance", icon: CalendarDays },
    { label: "Jurnal", href: "/parent/student-journal", icon: BookHeart },
    { kind: "action", label: "Lainnya", icon: MoreHorizontal, drawerTrigger: true },
  ]}
/>
```

## PageHeader Primitive

Shared in-content page header for portal routes (title + optional subtitle + optional actions slot). Located at `components/portal/page-header.tsx`.

**Use it** for every portal page title. Back navigation or context can precede it when needed. Semantic `<header>` with `<h1>`. Do NOT hand-roll `h1` + `p` headers in new pages.

**Props:**

| Prop | Type | Notes |
|---|---|---|
| `title` | `string` | Plain string — no icons. If you need adornment, wrap the primitive |
| `subtitle?` | `ReactNode` (plain text or inline elements) | Renders below the h1 as muted text |
| `actions?` | `ReactNode` | Right-aligned slot for filters and actions. Wraps below the heading on narrow widths. |
| `className?` | `string` | Merged into the outer `<header>` |

**Spacing contract** (the primitive wraps `components/admin/page-header.tsx`, so admin and portal titles are identical):
- Block margin: `mb-section`
- Title: `text-h1` with the token's own weight (semibold) and line-height; never add `font-*` or `leading-*` (see `ui.md` § Heading weight)
- Subtitle: `text-body text-muted-foreground`, `mt-1` below the title

**Example:**

```tsx
<PageHeader
  title="Tagihan Saya"
  subtitle="Kelola pembayaran bulanan anak Anda"
  actions={<Button size="sm">Unduh</Button>}
/>
```

## Spacing Scale

What the portal layouts render today (token rules: `ui.md` § Design tokens; values in `app/globals.css`). The portal is one `max-w-md` column at every width, so there is no separate desktop spacing.

| Surface | Class |
|---|---|
| Page content (`app/teacher/layout.tsx`, `app/parent/layout.tsx`) | `max-w-md mx-auto px-page-x py-6`, wrapper `pb-20` to clear the bottom nav |
| Sticky `PortalHeader` | `h-14`, `px-5` inside `max-w-md mx-auto` |
| Page-header block | `mb-section` (inside `PageHeader`) |
| Section gap inside page | `space-y-section` between home blocks; `space-y-2` / `space-y-3` for rows within a block |
| Card padding | `SectionCard` is `p-4 md:p-card`; prefer it over a hand-built card |
| Task row | `min-h-17` |

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
- One card per child with name, class and a verified recent signal or task.
- Give each child a small set of useful actions (for example, invoice and teacher note). Keep labels explicit and avoid a fixed three-cell grid when it hides the action text.
- Child-specific links carry that child’s context into Tagihan, Kehadiran, Jurnal, Rapor and Perkembangan. Destination pages can use a pinned child switcher.

**Forbidden for larger households:**
- `<PortalTabs>` as the child switcher on parent home.
- "Select a child" dropdown in the header — hides state, defeats the purpose.

See `design-system.html` §14 for the household overview example.

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
- `PortalMoreSheet` — `components/portal/more-sheet.tsx`
- `PageHeader` — `components/portal/page-header.tsx`

**Cycle-3 extraction candidates (2nd-instance trigger pending):**
- `PortalError` — unify parent + teacher `error.tsx` fallbacks
- `PageSkeleton` / `ListSkeleton` / `DetailSkeleton` — shared skeleton primitives for portal pages
- `RecentActivity` — promote from `components/parent/**` to `components/portal/**` if teacher home adopts the pattern
