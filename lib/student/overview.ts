/**
 * Pure shaping helpers for the student dossier's aggregate routes
 * (`/api/students/[id]/overview` and `/api/students/[id]/academics`).
 *
 * Every function here takes what Prisma's `groupBy` / `count` already handed
 * back and turns it into the wire shape. Nothing fetches, so the arithmetic the
 * dossier's number tiles depend on is unit-testable without a database.
 *
 * The one number deliberately NOT computed here is **outstanding**. Increment 2
 * gave that exactly one owner — `summarizeStudentInvoices` in
 * `lib/finance/student-invoice-summary.ts`, shared with the parent portal after
 * the UAT-2026-05-03 INV-01 disagreement. A `groupBy` sum cannot reproduce its
 * per-row `remaining > 0` post-filter (an overpaid invoice would net against an
 * underpaid one inside the same status bucket), so this module returns the
 * per-status *breakdown* and leaves "what does this family owe" where it is.
 */

/** One `Invoice.status` bucket, as returned by `invoice.groupBy`. */
export type InvoiceStatusGroup = {
  status: string;
  count: number;
  totalDue: number;
  totalPaid: number;
  /** `totalDue - totalPaid` for the bucket, clamped at zero. */
  balance: number;
};

/**
 * Render order for the breakdown line. Money still owed first, settled last —
 * an admin scanning it is looking for the problem, not the receipt. Statuses
 * outside this list (a future one) sort after it, alphabetically, rather than
 * being dropped.
 */
const STATUS_ORDER = [
  "OVERDUE",
  "PARTIALLY_PAID",
  "SENT",
  "PENDING_PAYMENT_LINK",
  "DRAFT",
  "PAID",
  "CANCELLED",
] as const;

/** `Decimal | string | number | null` → finite number, never NaN. */
function amount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function orderInvoiceGroups(
  rows: ReadonlyArray<{
    status: string;
    count: number;
    totalDue: number | string | null;
    totalPaid: number | string | null;
  }>,
): InvoiceStatusGroup[] {
  const rank = (s: string) => {
    const i = STATUS_ORDER.indexOf(s as (typeof STATUS_ORDER)[number]);
    return i === -1 ? STATUS_ORDER.length : i;
  };
  return rows
    .map((r) => {
      const totalDue = amount(r.totalDue);
      const totalPaid = amount(r.totalPaid);
      return {
        status: r.status,
        count: r.count,
        totalDue,
        totalPaid,
        balance: Math.max(0, totalDue - totalPaid),
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || a.status.localeCompare(b.status));
}

export type AttendanceCounts = {
  present: number;
  absent: number;
  sick: number;
  permission: number;
  /** Rows of any status — the denominator the tile shows. */
  total: number;
};

export const EMPTY_ATTENDANCE_COUNTS: AttendanceCounts = {
  present: 0,
  absent: 0,
  sick: 0,
  permission: 0,
  total: 0,
};

/**
 * `StudentAttendance.groupBy({ by: ["status"], _count })` → the four named
 * counts. An unrecognised status still lands in `total`, so the denominator
 * never quietly shrinks below the number of rows that actually exist.
 */
export function countAttendanceByStatus(
  rows: ReadonlyArray<{ status: string; count: number }>,
): AttendanceCounts {
  const out = { ...EMPTY_ATTENDANCE_COUNTS };
  for (const row of rows) {
    const n = Number.isFinite(row.count) ? row.count : 0;
    out.total += n;
    if (row.status === "PRESENT") out.present += n;
    else if (row.status === "ABSENT") out.absent += n;
    else if (row.status === "SICK") out.sick += n;
    else if (row.status === "PERMISSION") out.permission += n;
  }
  return out;
}

/**
 * Penilaian coverage: how much of this child's IKTP indicator set has been
 * assessed at least once inside the term.
 *
 * Returns `null` — not 0 — when there is no denominator (the student has no
 * active enrolment, so no age-group cohort, or the semester has no indicators
 * yet). A 0% coverage badge on a child nobody could have assessed reads as a
 * teacher failing to do their job; a dash reads as "we cannot say", which is
 * the truth.
 */
export function coveragePercent(assessed: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const pct = (assessed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export type TermRef = {
  id: string;
  number: number;
  semesterNumber: number;
  academicYear: string;
  startDate: string;
  endDate: string;
};

/** "TW1 · Sem 1 · 2025/2026" — the label every raport surface already speaks. */
export function termLabel(term: Pick<TermRef, "number" | "semesterNumber" | "academicYear">): string {
  return `TW${term.number} · Sem ${term.semesterNumber} · ${term.academicYear}`;
}

export type RaportTermStatus = "NONE" | "DRAFT" | "PUBLISHED";

export type RaportTermRow = {
  term: TermRef;
  status: RaportTermStatus;
  publishedAt: string | null;
  updatedAt: string | null;
};

/**
 * Left-join the tenant's terms against whatever `ReportCardEntry` rows exist
 * for this student. A term with no entry is `NONE`, not absent — "no raport for
 * TW3" is the answer an admin came for, and dropping the row hides it.
 */
export function joinRaportByTerm(
  terms: readonly TermRef[],
  entries: ReadonlyArray<{
    termId: string;
    status: string;
    publishedAt: string | null;
    updatedAt: string | null;
  }>,
): RaportTermRow[] {
  const byTerm = new Map(entries.map((e) => [e.termId, e]));
  return terms.map((term) => {
    const entry = byTerm.get(term.id);
    return {
      term,
      status: (entry?.status === "PUBLISHED" ? "PUBLISHED" : entry ? "DRAFT" : "NONE") as RaportTermStatus,
      publishedAt: entry?.publishedAt ?? null,
      updatedAt: entry?.updatedAt ?? null,
    };
  });
}

export type RaportTally = { published: number; draft: number; total: number };

/**
 * Wire shape of `GET /api/students/[id]/overview`. Declared here rather than in
 * the route so the client can import it without pulling Prisma into the bundle
 * — this module is deliberately dependency-free.
 */
export type StudentOverview = {
  finance: { invoiceCount: number; byStatus: InvoiceStatusGroup[] };
  attendance: { month: string; counts: AttendanceCounts };
  penilaian: {
    term: { id: string; label: string };
    entryCount: number;
    indicatorsAssessed: number;
    indicatorsTotal: number;
    coveragePct: number | null;
  } | null;
  raport: RaportTally & {
    current: { termId: string; label: string; status: RaportTermStatus } | null;
  };
  documents: {
    photo: boolean;
    kk: boolean;
    ktpPresent: number;
    ktpTotal: number;
    consent: boolean;
    /** Kelengkapan Berkas progress from the pendaftaran form; null without an application. */
    enrollment: { done: number; required: number } | null;
  };
  enrollmentApplication: { id: string; status: string; submittedAt: string | null } | null;
};

/** Rail-tile denominator: published / every term on the calendar. */
export function tallyRaport(rows: readonly RaportTermRow[]): RaportTally {
  let published = 0;
  let draft = 0;
  for (const row of rows) {
    if (row.status === "PUBLISHED") published += 1;
    else if (row.status === "DRAFT") draft += 1;
  }
  return { published, draft, total: rows.length };
}
