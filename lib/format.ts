const NUMBER_FORMATTERS = new Map<number | undefined, Intl.NumberFormat>();

/**
 * Plain number in Indonesian grouping: 1234567 → "1.234.567", 104.5 → "104,5".
 * Single source of truth for non-currency numbers — never call a bare
 * `toLocaleString()` (it reads the process locale, so SSR and the browser can
 * disagree). Without `maximumFractionDigits` the ICU default (3) applies.
 */
export function formatNumber(n: number, opts?: { maximumFractionDigits?: number }): string {
  const key = opts?.maximumFractionDigits;
  let fmt = NUMBER_FORMATTERS.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("id-ID", key === undefined ? undefined : { maximumFractionDigits: key });
    NUMBER_FORMATTERS.set(key, fmt);
  }
  return fmt.format(n);
}

/**
 * Format number as Indonesian Rupiah.
 * Single source of truth — use this everywhere instead of inline formatters.
 */
export function formatRupiah(amount: number | string): string {
  return "Rp " + formatNumber(Math.round(Number(amount)));
}

const COMPACT_RUPIAH = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Short Rupiah for chart axes and hints where the full figure would not fit:
 * "Rp 850 rb", "Rp 12,4 jt", "Rp 1,2 M". Same "Rp " prefix as `formatRupiah`;
 * use `formatRupiah` for anything a reader needs to reconcile to the rupiah.
 * ICU separates the unit with a no-break space; it is normalised to a plain
 * space so the string matches what a person (and a test) types.
 */
export function formatRupiahCompact(amount: number | string): string {
  return "Rp " + COMPACT_RUPIAH.format(Number(amount)).replace(/\u00a0/g, " ");
}

/**
 * Same value as `formatRupiah`, split so a caller can style the "Rp" apart
 * from the digits. `<Amount>` renders the symbol smaller and muted, which
 * stops it competing with the number for attention.
 */
export function formatRupiahParts(amount: number | string): {
  symbol: string;
  digits: string;
} {
  return {
    symbol: "Rp",
    digits: formatNumber(Math.round(Number(amount))),
  };
}

/**
 * Indonesian month names keyed by the English 3-letter abbreviation that
 * `Invoice.periodLabel` is generated with ("Apr-2026", "Aug-2025").
 */
const PERIOD_MONTHS: Record<string, string> = {
  jan: "Januari",
  feb: "Februari",
  mar: "Maret",
  apr: "April",
  may: "Mei",
  jun: "Juni",
  jul: "Juli",
  aug: "Agustus",
  sep: "September",
  oct: "Oktober",
  nov: "November",
  dec: "Desember",
};

/**
 * Render an invoice period the way a parent reads it.
 *
 * `Invoice.periodLabel` is a freeform string written at generation time and
 * historic rows carry English abbreviations — "Apr-2026", "Aug-2025" — which
 * then sit directly above Indonesian dates ("Dibayar 10 Agustus") in the
 * parent portal. Normalise on read so the portal is consistent without a
 * backfill; anything that does not match the `Mon-YYYY` shape (ad-hoc labels
 * like "PreviewVerify PR493 D") passes through untouched.
 */
export function formatInvoicePeriod(periodLabel: string): string {
  const match = /^([A-Za-z]{3})-(\d{4})$/.exec(periodLabel.trim());
  if (!match) return periodLabel;
  const month = PERIOD_MONTHS[match[1]!.toLowerCase()];
  return month ? `${month} ${match[2]}` : periodLabel;
}

/**
 * Mask a bank account number, revealing only the last 4 digits.
 * Use everywhere a bank account is rendered to the employee — slip detail,
 * profile page, payroll receipt, PDF. Single source of truth.
 *
 * - "1234567890" → "******7890"
 * - "1234"       → "****"     (≤ 4 chars: full mask — never reveal a short
 *                              value; real Indonesian accounts are 10–16
 *                              digits so this branch is unreachable in
 *                              normal data, but the function is a security
 *                              primitive and must fail closed)
 * - ""           → ""         (caller decides empty-state copy)
 */
export function maskBankAccount(accountNo: string): string {
  if (accountNo.length === 0) return accountNo;
  if (accountNo.length <= 4) return "*".repeat(accountNo.length);
  const visible = accountNo.slice(-4);
  const masked = "*".repeat(accountNo.length - 4);
  return `${masked}${visible}`;
}

/**
 * School wall-clock zone. Every timestamp the UI shows is read in WIB, never
 * the process zone: SSR on Vercel runs in UTC, the teacher's phone in WIB, and
 * a zoneless `toLocale*String` renders "00.02" on the server and "07.02" in the
 * browser — a React #418 hydration error on every load, and wrong times for
 * any device that is not on WIB.
 */
export const DISPLAY_TIME_ZONE = "Asia/Jakarta";

/**
 * Parse a full ISO timestamp (anything containing "T"). Returns null for a
 * date-only `YYYY-MM-DD` string or an unparseable value, so callers fall back
 * to the calendar-date path.
 */
function parseTimestamp(dateStr: string): Date | null {
  if (!dateStr.includes("T")) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date to Indonesian locale. Accepts either a `YYYY-MM-DD` calendar
 * date or an ISO timestamp (2026-04-10T14:30:45.123Z).
 *
 * A timestamp is an instant and renders on the Asia/Jakarta calendar day, so a
 * row created at 05:00 WIB reads as today, not as the UTC day before. A
 * date-only string is already a calendar day and is never shifted.
 */
export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const resolved: Intl.DateTimeFormatOptions = options ?? {
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  const instant = parseTimestamp(dateStr);
  if (instant) {
    return instant.toLocaleDateString("id-ID", { ...resolved, timeZone: DISPLAY_TIME_ZONE });
  }
  const dateOnly = dateStr.split("T")[0];
  return new Date(dateOnly + "T00:00:00").toLocaleDateString("id-ID", resolved);
}

/**
 * Format a date to short form (e.g., "8 Apr 2026"). Same input rules as
 * `formatDate`: a timestamp renders on the Asia/Jakarta day, a `YYYY-MM-DD`
 * string never shifts.
 */
export function formatDateShort(dateStr: string): string {
  return formatDate(dateStr, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Format a Mon–Fri week as one range label: `24 Agu – 28 Agu 2026`.
 *
 * The year belongs on the label — the teacher journal printed `7 Jun – 11 Jun`,
 * which is the same string for 2025, 2026 and 2027, and the week control let a
 * reader wander years away from today without any cue. Printing it once, at the
 * end, is the shape `/parent/attendance` already used; this is that shape,
 * shared, so the two journal surfaces stop disagreeing with each other.
 *
 * Returns "" for an empty range so callers can fall back to their own text.
 */
export function formatWeekRangeLabel(startYmd: string, endYmd: string): string {
  if (!startYmd || !endYmd) return "";
  const start = formatDate(startYmd, { day: "numeric", month: "short" });
  const end = formatDate(endYmd, { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${end}`;
}

/**
 * Format month + year as "Januari 2026" (Indonesian).
 */
export function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

/**
 * Format an ISO timestamp as a relative-time phrase in Indonesian
 * (e.g. "baru saja", "5 menit lalu", "2 jam lalu", "3 hari lalu").
 * Falls back to absolute short date for ages > 30 days.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return "";
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return "baru saja";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} hari lalu`;
  // Calendar day as the school reads it (WIB), not the UTC date part of the
  // ISO string — a 00:30 WIB timestamp is still "yesterday" in UTC.
  return then.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/**
 * Format time from ISO datetime string, always in Asia/Jakarta (see
 * `DISPLAY_TIME_ZONE`). `hourCycle: "h23"` keeps midnight as "00.05" — a bare
 * `hour12: false` can print "24.05" on some ICU builds.
 */
export function formatTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: DISPLAY_TIME_ZONE,
  });
}

/**
 * Format an ISO timestamp as "26 Apr 2026 · 16:23" in Asia/Jakarta.
 * Returns "—" for null or an unparseable value.
 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_TIME_ZONE,
  });
  return `${date} · ${formatTime(iso)}`;
}

/**
 * Indonesian display label for the `LearningCenter` Prisma enum.
 *
 * The enum names are English (per the C4 naming convention); this helper
 * supplies the user-facing Indonesian label everywhere a sentra room is
 * named in the UI (assessments hub cards, sentra page header, breadcrumb).
 *
 * Falls back to the raw enum value if a new center is added without a
 * label — a safe default that keeps the UI readable while flagging the
 * gap to whoever extended `enum LearningCenter` in `prisma/schema.prisma`.
 */
export type LearningCenterKey =
  | "WORSHIP"
  | "NATURAL_MATERIALS"
  | "ART"
  | "COOKING"
  | "ROLE_PLAY"
  | "BLOCKS"
  | "PREPARATION"
  | "AREA";

const LEARNING_CENTER_LABELS: Record<LearningCenterKey, string> = {
  WORSHIP: "Sentra Ibadah",
  NATURAL_MATERIALS: "Sentra Bahan Alam",
  ART: "Sentra Seni",
  COOKING: "Sentra Memasak",
  ROLE_PLAY: "Sentra Main Peran",
  BLOCKS: "Sentra Balok",
  PREPARATION: "Sentra Persiapan",
  AREA: "Sentra Area",
};

export function formatLearningCenter(center: string): string {
  return LEARNING_CENTER_LABELS[center as LearningCenterKey] ?? center;
}

export const ALL_LEARNING_CENTERS: ReadonlyArray<LearningCenterKey> = [
  "WORSHIP",
  "NATURAL_MATERIALS",
  "ART",
  "COOKING",
  "ROLE_PLAY",
  "BLOCKS",
  "PREPARATION",
  "AREA",
];

/**
 * Indonesian display label for the `CurriculumElement` Prisma enum.
 * Used by the C6 parent perkembangan rollup (5-row element progress
 * block) and any future surface that displays element names. Falls
 * back to the raw enum value when an unknown key is passed.
 */
export type CurriculumElementKey =
  | "RELIGIOUS_MORAL"
  | "IDENTITY"
  | "STEAM"
  | "MOTOR_SKILLS"
  | "ART";

const CURRICULUM_ELEMENT_LABELS: Record<CurriculumElementKey, string> = {
  RELIGIOUS_MORAL: "Nilai Agama & Budi Pekerti",
  IDENTITY: "Jati Diri",
  STEAM: "STEAM / Literasi",
  MOTOR_SKILLS: "Motorik",
  ART: "Seni",
};

export function formatCurriculumElement(element: string): string {
  return (
    CURRICULUM_ELEMENT_LABELS[element as CurriculumElementKey] ?? element
  );
}

/**
 * Structural input for `formatClassOptionLabel` — deliberately narrower than
 * either wire shape that produces it. `GET /api/class-sections` returns
 * `academicYear: { name }` + `_count: { enrollments }`; `GET /api/admin/classes`
 * returns a flattened `enrolledCount` and no nested academic year object.
 * Callers map their response shape into this before calling the helper —
 * keeps the helper dumb and shape-agnostic instead of accepting a union of
 * two wire formats.
 */
export interface ClassOptionLabelInput {
  name: string;
  /** Omit or pass null/undefined when the academic year is unknown — the
   *  " · TA …" segment is dropped rather than rendering "TA undefined". */
  academicYearName?: string | null;
  enrolled: number;
  capacity: number;
}

/**
 * Class dropdown option label — single source of truth for every class
 * picker (student enroll/promote dialogs, and future callers). Academic
 * year is the only field that disambiguates same-named classes across
 * years, so it's included; program name is redundant with the class name
 * (which already carries the level, e.g. "TK B 3") and is deliberately
 * left out.
 *
 * `<nama> · TA <tahun ajaran> · <terisi>/<kapasitas>`
 * e.g. "TK B 3 · TA 2026/2027 · 10/25"
 */
export function formatClassOptionLabel({
  name,
  academicYearName,
  enrolled,
  capacity,
}: ClassOptionLabelInput): string {
  const segments = [name];
  if (academicYearName) segments.push(`TA ${academicYearName}`);
  segments.push(`${enrolled}/${capacity}`);
  return segments.join(" · ");
}

/** Minimal row shape for `disambiguateClassLabels`. */
export interface ClassLabelInput {
  id: string;
  name: string;
  /** Campus display name, when known. */
  campusName?: string | null;
}

/**
 * Class-picker labels with the campus appended **only where the bare name
 * would be ambiguous**.
 *
 * Within one academic year An Nisaa' runs the same class name on more than
 * one campus, so a year-scoped picker can still show four identical "TKIT-A"
 * options with nothing to choose between them. Appending the campus to every
 * option would be noise; appending it only to collisions keeps the common
 * case short.
 *
 * A collision whose rows carry no campus name is left as-is rather than
 * rendering a dangling separator — nothing useful to add.
 */
export function disambiguateClassLabels<T extends ClassLabelInput>(
  rows: T[],
): Array<{ id: string; label: string }> {
  const nameCounts = new Map<string, number>();
  for (const r of rows) {
    nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
  }

  return rows.map((r) => {
    const ambiguous = (nameCounts.get(r.name) ?? 0) > 1;
    const campus = r.campusName?.trim();
    return {
      id: r.id,
      label: ambiguous && campus ? `${r.name} · ${campus}` : r.name,
    };
  });
}
