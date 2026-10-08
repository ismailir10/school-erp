import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarHeart,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock,
  Info,
  Minus,
  Plane,
  Sparkles,
  Thermometer,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * Status badge with consistent color mapping across the entire app.
 * Single source of truth for status → color + label + icon mapping.
 *
 * Variants:
 *   - "solid" (default): existing Badge pill — preserves behavior for 30+ existing consumers.
 *   - "intent": icon + label + subtle-tinted bg + 2 px tone-tinted left border.
 *     Used by the parent-portal visual overhaul (cycle 3, task S1) where severity
 *     must be decipherable at a 3m glance (icon + color + left-accent).
 *
 * Correctness fixes in cycle 3:
 *   - `text-[10px]` → `text-xs` (portal.md §Portal Text-Size Scale floor).
 *   - SICK tone: red (status-absent) → amber (status-late) per voice.md + design-system.html
 *     §Status palette. Sakit is a warn-severity, not a danger-severity state.
 *   - ABSENT label: "Tidak Hadir" → "Alpa" per voice.md glossary (canonical Indonesian
 *     attendance term). Consumers can still override via the `label` prop.
 */

type StatusConfig = {
  label: string;
  className: string;
};

const STATUS_MAP: Record<string, StatusConfig> = {
  // Attendance
  PRESENT: { label: "Hadir", className: "bg-status-present-subtle text-status-present-text" },
  LATE: { label: "Terlambat", className: "bg-status-late-subtle text-status-late-text" },
  // voice.md canonical term: "Alpa" (not "Tidak Hadir").
  ABSENT: { label: "Alpa", className: "bg-status-absent-subtle text-status-absent-text" },
  // voice.md canonical term: "Izin" (not "Cuti") for the attendance LEAVE status.
  LEAVE: { label: "Izin", className: "bg-status-leave-subtle text-status-leave-text" },
  HOLIDAY: { label: "Libur", className: "bg-status-holiday-subtle text-status-holiday-text" },
  HALF_DAY: { label: "Setengah Hari", className: "bg-status-late-subtle text-status-late-text" },
  PRESENT_NO_CHECKOUT: { label: "Hadir Tanpa Pulang", className: "bg-status-no-checkout-subtle text-status-late-text" },

  // Leave
  PENDING: { label: "Menunggu", className: "bg-status-late-subtle text-status-late-text" },
  APPROVED: { label: "Disetujui", className: "bg-status-present-subtle text-status-present-text" },
  REJECTED: { label: "Ditolak", className: "bg-status-absent-subtle text-status-absent-text" },
  CANCELLED: { label: "Dibatalkan", className: "bg-muted text-muted-foreground" },

  // Payroll
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
  EXPORTED: { label: "Diekspor", className: "bg-status-leave-subtle text-status-leave-text" },
  SLIPS_SENT: { label: "Slip Terkirim", className: "bg-status-holiday-subtle text-status-holiday-text" },
  // Salary component types (T17 salary-components consumes via <StatusBadge>)
  INCOME: { label: "Pemasukan", className: "bg-status-present-subtle text-status-present-text" },
  DEDUCTION: { label: "Potongan", className: "bg-status-absent-subtle text-status-absent-text" },

  // Employee
  ACTIVE: { label: "Aktif", className: "bg-status-present-subtle text-status-present-text" },
  INACTIVE: { label: "Tidak Aktif", className: "bg-muted text-muted-foreground" },
  PLANNING: { label: "Perencanaan", className: "bg-status-leave-subtle text-status-leave-text" },
  // AcademicYear.status — an archived year was rendering the raw enum.
  ARCHIVED: { label: "Diarsipkan", className: "bg-muted text-muted-foreground" },

  // Invoice
  // "Link Dibuat" not "Terkirim": SENT only means a payment-link session exists
  // server-side. Nothing is dispatched — DOKU sends no notification and the admin
  // still shares the link manually — so "Terkirim" overclaimed delivery.
  SENT: { label: "Link Dibuat", className: "bg-status-leave-subtle text-status-leave-text" },
  PAID: { label: "Lunas", className: "bg-status-present-subtle text-status-present-text" },
  // "Lewat Tempo" not "Jatuh Tempo": "jatuh tempo" is the due *date*, and that exact
  // phrase captions the due-date field on the same invoice row. Reusing it as the
  // overdue status made the badge and the date indistinguishable. voice.md glossary.
  OVERDUE: { label: "Lewat Tempo", className: "bg-status-absent-subtle text-status-absent-text" },
  // "Dibayar Sebagian" not "Sebagian": a parent who has already paid part of the SPP
  // must be able to tell this apart from an untouched invoice at a glance.
  PARTIALLY_PAID: { label: "Dibayar Sebagian", className: "bg-status-late-subtle text-status-late-text" },
  PENDING_PAYMENT_LINK: { label: "Link Gagal", className: "bg-status-late-subtle text-status-late-text" },

  // Payment ledger (Payment.status) — present in the schema, previously unmapped,
  // so a surfaced value would have rendered the raw English enum.
  RECORDED: { label: "Tercatat", className: "bg-status-present-subtle text-status-present-text" },
  REVERSED: { label: "Dibatalkan", className: "bg-muted text-muted-foreground" },

  // Email log (EmailLog.status) — same reason.
  FAILED: { label: "Gagal", className: "bg-status-absent-subtle text-status-absent-text" },

  // Admission (future)
  INQUIRY: { label: "Pertanyaan", className: "bg-status-leave-subtle text-status-leave-text" },
  VISIT_SCHEDULED: { label: "Kunjungan", className: "bg-status-late-subtle text-status-late-text" },
  VISITED: { label: "Sudah Kunjungan", className: "bg-status-holiday-subtle text-status-holiday-text" },
  ADMITTED: { label: "Diterima", className: "bg-status-present-subtle text-status-present-text" },
  ENROLLED: { label: "Terdaftar di Kelas", className: "bg-status-present-subtle text-status-present-text" },
  GRADUATED: { label: "Lulus", className: "bg-status-holiday-subtle text-status-holiday-text" },
  WITHDRAWN: { label: "Keluar", className: "bg-muted text-muted-foreground" },
  // Registered-but-not-yet-tallied — the "Terdaftar" chip hand-rolled by
  // admin/admissions and admin/enrollments/status-chip when an ADMITTED /
  // ACCEPTED row already has a linked studentId. Ported from those local
  // `bg-primary/10 text-primary` badges (finding F10 — component half).
  REGISTERED: { label: "Terdaftar", className: "bg-status-present-subtle text-status-present-text" },

  // Enrollment application (ported from app/admin/enrollments/status-chip.tsx
  // `STATUS_META` — finding F10 — component half. REJECTED already existed
  // above with an identical label/className and is reused as-is.)
  INVITED: { label: "Diundang", className: "bg-muted text-muted-foreground" },
  SUBMITTED: { label: "Terkirim", className: "bg-status-leave-subtle text-status-leave-text" },
  UNDER_REVIEW: { label: "Ditinjau", className: "bg-status-late-subtle text-status-late-text" },
  ACCEPTED: { label: "Diterima", className: "bg-status-present-subtle text-status-present-text" },

  // Student attendance (future)
  // Fixed in cycle 3: SICK is warn-severity (amber), not danger (red).
  SICK: { label: "Sakit", className: "bg-status-late-subtle text-status-late-text" },
  PERMISSION: { label: "Izin", className: "bg-status-leave-subtle text-status-leave-text" },

  // Leave types
  ANNUAL: { label: "Cuti Tahunan", className: "bg-status-leave-subtle text-status-leave-text" },
  OTHER: { label: "Lainnya", className: "bg-muted text-muted-foreground" },

  // Assessment / Raport
  // The shared default is parent-facing raport copy: voice.md and the
  // toast/email/SMS examples use "rapor sudah terbit". Assessment surfaces
  // that need "Dipublikasi"/"Dipublikasikan" pass an explicit label override.
  PUBLISHED: { label: "Terbit", className: "bg-status-present-subtle text-status-present-text" },

  // Data completeness (e.g. missing bank account)
  UNFILLED: { label: "Belum diisi", className: "bg-status-absent-subtle text-status-absent-text" },

  // Student-journal audit-trail actions (ported from
  // app/admin/student-journal/students/[id]/page.tsx `ACTION_LABELS` +
  // its inline text-destructive/text-primary/text-status-present ternary —
  // finding F10 — component half).
  CREATE: { label: "Dibuat", className: "bg-status-present-subtle text-status-present-text" },
  UPDATE: { label: "Diubah", className: "bg-status-leave-subtle text-status-leave-text" },
  DELETE: { label: "Dihapus", className: "bg-status-absent-subtle text-status-absent-text" },

  // Class health ("Kondisi", admin/classes list + detail). Keys are the
  // Indonesian health labels the classes module already carries as the
  // `health` field's own values (not an English enum) — same convention as
  // the "Leave"/"Payroll" groups above reusing their raw status string.
  // Ported from the standalone `healthTone()` helper (finish-admin-standard
  // cycle, T2) so classes stop hand-rolling a second colour table. Its fifth
  // case, "Tidak Aktif", needs no entry here — the fallback below already
  // renders the raw status text on a muted pill, identical to what
  // `healthTone()`'s own default case produced.
  Sehat: { label: "Sehat", className: "bg-status-present-subtle text-status-present-text" },
  Perhatian: { label: "Perhatian", className: "bg-status-late-subtle text-status-late-text" },
  Kritis: { label: "Kritis", className: "bg-status-absent-subtle text-status-absent-text" },
  Libur: { label: "Libur", className: "bg-status-leave-subtle text-status-leave-text" },
};

/**
 * Icon auto-selection for `variant="intent"`. Consumers can override via the `icon` prop.
 * Mapping rules follow design-system.html §Status-chip set severity families.
 */
const STATUS_ICON_MAP: Record<string, LucideIcon> = {
  // Attendance
  PRESENT: Check,
  ABSENT: X,
  SICK: Thermometer,
  PERMISSION: Info,
  LATE: Clock,
  LEAVE: Plane,
  HOLIDAY: CalendarHeart,
  HALF_DAY: Clock,
  PRESENT_NO_CHECKOUT: Clock,

  // Lifecycle — neutral / dormant
  INACTIVE: Minus,
  ARCHIVED: Minus,
  DRAFT: Minus,
  CANCELLED: Minus,
  WITHDRAWN: Minus,
  OTHER: Minus,

  // Positive confirm
  ACTIVE: CheckCircle2,
  APPROVED: CheckCircle2,
  PAID: CheckCircle2,
  ENROLLED: CheckCircle2,
  ACCEPTED: CheckCircle2,
  REGISTERED: CheckCircle2,
  CREATE: CheckCircle2,

  // Negative / attention
  REJECTED: AlertTriangle,
  OVERDUE: AlertTriangle,
  UNFILLED: AlertTriangle,
  FAILED: AlertTriangle,
  DELETE: X,

  // Payment ledger
  RECORDED: CheckCircle2,
  REVERSED: Minus,

  // In-progress / pending
  PENDING: CircleDot,
  PARTIALLY_PAID: CircleDot,
  UNDER_REVIEW: CircleDot,

  // Transit / sent
  SENT: ArrowRight,
  INQUIRY: ArrowRight,
  VISIT_SCHEDULED: ArrowRight,
  SUBMITTED: ArrowRight,
  INVITED: ArrowRight,
  UPDATE: Info,

  // Celebration
  PUBLISHED: Sparkles,
  // Salary component types
  INCOME: CheckCircle2,

  // Verified milestones
  VISITED: BadgeCheck,
  ADMITTED: BadgeCheck,
  GRADUATED: BadgeCheck,
  SLIPS_SENT: BadgeCheck,
  EXPORTED: BadgeCheck,

  // Leave types
  ANNUAL: Plane,
};

/**
 * Tone-tinted left-border color for `variant="intent"`. Keeps the severity
 * signal readable even at 3m glance / 2× shrink.
 */
const STATUS_LEFT_BORDER_MAP: Record<string, string> = {
  // Green / positive
  PRESENT: "border-l-status-present",
  ACTIVE: "border-l-status-present",
  APPROVED: "border-l-status-present",
  PAID: "border-l-status-present",
  ENROLLED: "border-l-status-present",
  ADMITTED: "border-l-status-present",
  PUBLISHED: "border-l-status-present",
  ACCEPTED: "border-l-status-present",
  REGISTERED: "border-l-status-present",
  CREATE: "border-l-status-present",

  // Red / absent
  ABSENT: "border-l-status-absent",
  DELETE: "border-l-status-absent",

  // Red / danger (attention-required)
  OVERDUE: "border-l-destructive",
  REJECTED: "border-l-destructive",
  UNFILLED: "border-l-destructive",
  FAILED: "border-l-destructive",

  // Amber / warn
  SICK: "border-l-status-late",
  LATE: "border-l-status-late",
  PARTIALLY_PAID: "border-l-status-late",
  PENDING: "border-l-status-late",
  HALF_DAY: "border-l-status-late",
  PRESENT_NO_CHECKOUT: "border-l-status-late",
  VISIT_SCHEDULED: "border-l-status-late",
  UNDER_REVIEW: "border-l-status-late",

  // Blue / info
  PERMISSION: "border-l-status-leave",
  LEAVE: "border-l-status-leave",
  SENT: "border-l-status-leave",
  INQUIRY: "border-l-status-leave",
  ANNUAL: "border-l-status-leave",
  EXPORTED: "border-l-status-leave",
  SUBMITTED: "border-l-status-leave",
  UPDATE: "border-l-status-leave",

  // Purple / holiday
  HOLIDAY: "border-l-status-holiday",
  VISITED: "border-l-status-holiday",
  GRADUATED: "border-l-status-holiday",
  SLIPS_SENT: "border-l-status-holiday",

  // Neutral
  INACTIVE: "border-l-border",
  ARCHIVED: "border-l-border",
  DRAFT: "border-l-border",
  CANCELLED: "border-l-border",
  WITHDRAWN: "border-l-border",
  OTHER: "border-l-border",
  INVITED: "border-l-border",
  // Salary component types
  INCOME: "border-l-status-present",
  DEDUCTION: "border-l-status-absent",
  // Payment ledger
  RECORDED: "border-l-status-present",
  REVERSED: "border-l-border",
};

export type StatusBadgeProps = {
  status: string;
  /** Override the default label from STATUS_MAP. */
  label?: string;
  /** Additional class names merged onto the badge root. */
  className?: string;
  /**
   * Visual variant.
   * - "solid" (default): classic pill — unchanged behavior for existing consumers.
   * - "intent": icon + label + left-accent border — used by parent portal surfaces.
   */
  variant?: "solid" | "intent";
  /** Override the auto-selected Lucide icon (intent variant only). */
  icon?: LucideIcon;
};

export function StatusBadge({
  status,
  label,
  className,
  variant = "solid",
  icon,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const toneClass = config?.className ?? "bg-muted text-muted-foreground";
  const resolvedLabel = label ?? config?.label ?? status;

  if (variant === "intent") {
    const Icon = icon ?? STATUS_ICON_MAP[status] ?? Circle;
    const leftBorder = STATUS_LEFT_BORDER_MAP[status] ?? "border-l-border";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border-l-4 px-2 py-0.5 text-xs font-medium ${toneClass} ${leftBorder} ${className ?? ""}`}
      >
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
        {resolvedLabel}
      </span>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={`text-xs ${toneClass} ${className ?? ""}`}
    >
      {resolvedLabel}
    </Badge>
  );
}

/**
 * Get the status config for programmatic use (e.g., in charts).
 */
export function getStatusConfig(status: string): StatusConfig {
  return STATUS_MAP[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
}
