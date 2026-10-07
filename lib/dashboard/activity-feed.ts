import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export type ActivityEvent = {
  id: string;
  actorName: string;
  actorInitials: string;
  verb: string;
  target: string;
  href: string;
  timestamp: string; // ISO
};

type WhitelistedEntity =
  | "Employee"
  | "LeaveRequest"
  | "PayrollRun"
  | "Invoice"
  | "Payment"
  | "Admission"
  | "StudentEnrollment"
  | "ReportCardEntry"
  | "ClassSection";

type VerbKey = `${WhitelistedEntity}.${string}`;

/** The audit row's `before`/`after` JSON, for verbs that quote a detail from it. */
type AuditContext = { before: unknown; after: unknown };

type VerbBuilder = (target: string, ctx: AuditContext) => { verb: string; href: string };

function payloadString(json: unknown, key: string): string | undefined {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const v = (json as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

// Keys are `${entity}.${action}` exactly as the app writes them through
// `recordAudit` (lib/audit.ts) — several actions are namespaced strings such
// as `class.enrollment.add`, not bare create/update. Pairs the app has never
// written (e.g. `LeaveRequest.approve`) stay listed so they light up the day
// a route starts auditing them. Rows whose target no longer exists
// (`class.delete`, `class.teacher.remove` — hard deletes) and data-entry
// noise (assessment entries, curriculum edits, age-override side rows) are
// deliberately absent: the feed skips any pair not listed here.
const VERB_MAP: Record<VerbKey, VerbBuilder> = {
  "LeaveRequest.create": (t) => ({ verb: `mengajukan cuti untuk ${t}`, href: "/admin/leave-requests" }),
  "LeaveRequest.approve": (t) => ({ verb: `menyetujui cuti ${t}`, href: "/admin/leave-requests" }),
  "LeaveRequest.reject": (t) => ({ verb: `menolak cuti ${t}`, href: "/admin/leave-requests" }),
  "LeaveRequest.cancel": (t) => ({ verb: `membatalkan cuti ${t}`, href: "/admin/leave-requests" }),
  "Employee.create": (t) => ({ verb: `menambah karyawan ${t}`, href: "/admin/employees" }),
  "Employee.update": (t) => ({ verb: `memperbarui data ${t}`, href: "/admin/employees" }),
  "Employee.deactivate": (t) => ({ verb: `menonaktifkan karyawan ${t}`, href: "/admin/employees" }),
  "Employee.restore": (t) => ({ verb: `mengaktifkan kembali karyawan ${t}`, href: "/admin/employees" }),
  "PayrollRun.create": (t) => ({ verb: `membuat penggajian ${t}`, href: "/admin/payroll" }),
  "PayrollRun.approve": (t) => ({ verb: `menyetujui penggajian ${t}`, href: "/admin/payroll" }),
  "PayrollRun.cancel": (t) => ({ verb: `membatalkan penggajian ${t}`, href: "/admin/payroll" }),
  "Invoice.create": (t) => ({ verb: `membuat tagihan ${t}`, href: "/admin/invoices" }),
  "Invoice.payment": (t) => ({ verb: `mencatat pembayaran ${t}`, href: "/admin/invoices" }),
  "Invoice.void": (t) => ({ verb: `membatalkan tagihan ${t}`, href: "/admin/invoices" }),
  "Payment.record": (t) => ({ verb: `mencatat pembayaran ${t}`, href: "/admin/invoices" }),
  "Payment.reverse": (t) => ({ verb: `membatalkan pembayaran ${t}`, href: "/admin/invoices" }),
  "Admission.create": (t) => ({ verb: `pendaftaran baru: ${t}`, href: "/admin/admissions" }),
  "Admission.update": (t) => ({ verb: `memperbarui pendaftaran ${t}`, href: "/admin/admissions" }),
  "StudentEnrollment.create": (t) => ({ verb: `mendaftarkan siswa ${t}`, href: "/admin/classes" }),
  "StudentEnrollment.class.enrollment.add": (t, { after }) => {
    const cls = payloadString(after, "className");
    return {
      verb: cls ? `memasukkan ${t} ke kelas ${cls}` : `memasukkan ${t} ke sebuah kelas`,
      href: "/admin/classes",
    };
  },
  "StudentEnrollment.class.enrollment.remove": (t) => ({
    verb: `mengeluarkan ${t} dari kelasnya`,
    href: "/admin/classes",
  }),
  "ReportCardEntry.publish": (t) => ({ verb: `menerbitkan rapor ${t}`, href: "/admin/report-cards" }),
  "ReportCardEntry.unpublish": (t) => ({ verb: `menarik kembali rapor ${t}`, href: "/admin/report-cards" }),
  "ClassSection.class.create": (t) => ({ verb: `membuat kelas ${t}`, href: "/admin/classes" }),
};

/**
 * Indonesian verb + link for one audit row, or `null` when the
 * `(entity, action)` pair is not shown in the feed.
 */
export function describeAuditEntry(
  entity: string,
  action: string,
  target: string,
  ctx: AuditContext = { before: null, after: null }
): { verb: string; href: string } | null {
  const builder = (VERB_MAP as Record<string, VerbBuilder | undefined>)[`${entity}.${action}`];
  return builder ? builder(target, ctx) : null;
}

type TargetSpec = {
  /** Prisma `select` for the delegate; always includes `id`. */
  select: Record<string, unknown>;
  /** The human-readable label for the row, or undefined to skip the event. */
  pick: (row: Record<string, unknown>) => string | undefined;
};

const field = (name: string): TargetSpec => ({
  select: { id: true, [name]: true },
  pick: (row) => (typeof row[name] === "string" && row[name] ? (row[name] as string) : undefined),
});

const nested = (relation: string, name: string): TargetSpec => ({
  select: { id: true, [relation]: { select: { [name]: true } } },
  pick: (row) => {
    const rel = row[relation] as Record<string, unknown> | null | undefined;
    const v = rel?.[name];
    return typeof v === "string" && v ? v : undefined;
  },
});

const ENTITY_TARGET: Record<WhitelistedEntity, TargetSpec> = {
  Employee: field("nama"),
  // Falls back to the id so a row stays visible if the employee is gone.
  LeaveRequest: {
    select: { id: true, employee: { select: { nama: true } } },
    pick: (row) => {
      const emp = row.employee as { nama?: unknown } | null | undefined;
      return typeof emp?.nama === "string" && emp.nama ? emp.nama : (row.id as string);
    },
  },
  PayrollRun: field("periodStart"),
  Invoice: field("invoiceNumber"),
  Payment: nested("invoice", "invoiceNumber"),
  Admission: field("childName"),
  StudentEnrollment: nested("student", "name"),
  ReportCardEntry: nested("student", "name"),
  ClassSection: field("name"),
};

function initialsFor(name: string | null | undefined): string {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "??";
}

async function fetchRecentActivityImpl(
  tenantId: string,
  limit: number = 8
): Promise<ActivityEvent[]> {
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) return [];

  const grouped = new Map<WhitelistedEntity, Set<string>>();
  for (const row of rows) {
    const key = `${row.entity}.${row.action}` as VerbKey;
    if (!(key in VERB_MAP)) continue;
    const ent = row.entity as WhitelistedEntity;
    if (!grouped.has(ent)) grouped.set(ent, new Set());
    grouped.get(ent)!.add(row.entityId);
  }

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId)));
  const [users, ...entityResults] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, email: true },
    }),
    ...Array.from(grouped.entries()).map(([entity, ids]) => {
      const idArr = Array.from(ids);
      return resolveEntityNames(entity, idArr).then(
        (map) => [entity, map] as const
      );
    }),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const entityMaps = new Map(entityResults);

  const events: ActivityEvent[] = [];
  for (const row of rows) {
    const key = `${row.entity}.${row.action}` as VerbKey;
    if (!(key in VERB_MAP)) continue;
    const ent = row.entity as WhitelistedEntity;
    const targetName = entityMaps.get(ent)?.get(row.entityId);
    if (!targetName) continue;
    const displayName =
      ent === "PayrollRun"
        ? formatDate(targetName, { month: "long", year: "numeric" })
        : targetName;
    const user = userMap.get(row.actorId);
    const actorName = user?.name?.trim() || user?.email?.split("@")[0] || "Pengguna";
    const described = describeAuditEntry(row.entity, row.action, displayName, {
      before: row.before,
      after: row.after,
    });
    if (!described) continue;
    const { verb, href } = described;
    events.push({
      id: row.id,
      actorName,
      actorInitials: initialsFor(actorName),
      verb,
      target: displayName,
      href,
      timestamp: row.createdAt.toISOString(),
    });
  }

  return events;
}

async function resolveEntityNames(
  entity: WhitelistedEntity,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const spec = ENTITY_TARGET[entity];
  const delegate = (prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> }>)[
    entity.charAt(0).toLowerCase() + entity.slice(1)
  ];
  const rows = await delegate.findMany({
    where: { id: { in: ids } },
    select: spec.select,
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const label = spec.pick(row);
    if (label) map.set(row.id as string, label);
  }
  return map;
}

export const getRecentActivity = unstable_cache(
  fetchRecentActivityImpl,
  ["dashboard-recent-activity"],
  { revalidate: 60, tags: ["activity-feed"] }
);
