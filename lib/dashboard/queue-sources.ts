import { prisma } from "@/lib/db";
import { stageWhere } from "@/lib/admission/stage";
import { adminWorkPermissions, type AdminQueueSection, type AdminQueueSources } from "./admin-work-queue";

/** How long an unanswered inquiry counts as "new" work. */
export const INQUIRY_WINDOW_DAYS = 14;

type PermissionSession = { role: string; permissions?: string[] | null };

async function loadSection<T>(
  allowed: boolean,
  key: string,
  query: () => Promise<{ records: T[]; count: number }>,
): Promise<AdminQueueSection<T>> {
  if (!allowed) return { status: "hidden" };
  try {
    const { records, count } = await query();
    return { status: "ready", records, count };
  } catch (error) {
    console.error("[dashboard] source unavailable", { key, error });
    return { status: "unavailable" };
  }
}

/**
 * Loads the five admin work-queue sources (inquiries, enrollments, leave,
 * invoices, payroll), bounded to `take` records each but reporting the true total via
 * a parallel `count` query with the same `where`. Shared by the dashboard
 * (`take: 5`, most-urgent-first) and `/admin/work-queue` (`take: 200`, the
 * full triage table) so the four Prisma queries live in exactly one place.
 */
export async function loadAdminQueueSources(
  session: PermissionSession & { tenantId: string },
  { take }: { take: number },
): Promise<AdminQueueSources> {
  const tenantId = session.tenantId;
  const permitted = adminWorkPermissions(session);

  const [inquiries, enrollments, leave, invoices, payroll] = await Promise.all([
    // A public /daftar submission lands as an Admission and used to be visible only inside
    // Pendaftaran (X-6). "New" = the last INQUIRY_WINDOW_DAYS days; "not yet followed up" = the
    // list's own Baru stage (lib/admission/stage): no formulir sent yet, not cancelled, not a
    // student. Legacy VISIT_* / ADMITTED-without-formulir rows read as Baru too, so the queue and
    // the list's "Baru" filter always show the same families.
    loadSection(permitted.inquiries, "inquiries", async () => {
      const where = {
        tenantId,
        AND: [stageWhere("BARU")],
        createdAt: { gte: new Date(Date.now() - INQUIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000) },
      };
      const [count, records] = await Promise.all([
        prisma.admission.count({ where }),
        prisma.admission.findMany({
          where,
          select: { id: true, childName: true, parentName: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take,
        }),
      ]);
      return { count, records: records.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
    }),
    loadSection(permitted.enrollments, "enrollments", async () => {
      const where = { tenantId, studentId: null, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } };
      const [count, records] = await Promise.all([
        prisma.enrollmentApplication.count({ where }),
        prisma.enrollmentApplication.findMany({
          where,
          select: { id: true, childName: true, status: true, updatedAt: true },
          orderBy: { updatedAt: "asc" },
          take,
        }),
      ]);
      return { count, records: records.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
    }),
    loadSection(permitted.leave, "leave", async () => {
      const where = { status: "PENDING" as const, employee: { tenantId } };
      const [count, records] = await Promise.all([
        prisma.leaveRequest.count({ where }),
        prisma.leaveRequest.findMany({
          where,
          select: { id: true, leaveType: true, startDate: true, endDate: true, status: true, employee: { select: { nama: true } } },
          orderBy: { startDate: "asc" },
          take,
        }),
      ]);
      return { count, records };
    }),
    loadSection(permitted.invoices, "invoices", async () => {
      const where = { tenantId, status: "PENDING_PAYMENT_LINK" as const };
      const [count, records] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
          where,
          select: { id: true, invoiceNumber: true, periodLabel: true, dueDate: true, status: true, student: { select: { name: true } } },
          orderBy: { dueDate: "asc" },
          take,
        }),
      ]);
      return { count, records };
    }),
    loadSection(permitted.payroll, "payroll", async () => {
      const where = { tenantId, status: "DRAFT" as const };
      const [count, records] = await Promise.all([
        prisma.payrollRun.count({ where }),
        prisma.payrollRun.findMany({
          where,
          select: { id: true, periodStart: true, periodEnd: true, status: true },
          orderBy: { periodStart: "asc" },
          take,
        }),
      ]);
      return { count, records };
    }),
  ]);

  return { inquiries, enrollments, leave, invoices, payroll };
}
