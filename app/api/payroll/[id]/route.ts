import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import {
  actualWorkDaysRangeMessage,
  calendarDaysInPeriod,
  updatePayrollRunSchema,
} from "@/lib/validations/payroll";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("payroll.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!hasPermission(session, "hr.view")) return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });

  const { id } = await params;

  const payroll = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          employee: {
            select: { id: true, kode: true, nama: true, jabatan: true, bankAccountNo: true, bankName: true },
          },
          lines: {
            include: { componentDef: { select: { code: true, calcType: true } } },
            orderBy: { componentDef: { sortOrder: "asc" } },
          },
        },
        orderBy: { employee: { nama: "asc" } },
      },
    },
  });

  if (!payroll || payroll.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(payroll);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`payroll-update:${getClientIp(req)}`, 10, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const auth = await requirePermission("payroll.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  if (!hasPermission(session, "hr.view")) return NextResponse.json({ error: "forbidden", missing: "hr.view" }, { status: 403 });

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  // validateBody's `{ error, errors: [{ field, message }] }` shape is what
  // `applyServerErrors` maps onto the period-edit form's fields; the prior
  // `safeParse` + `{ error, details }` shape wasn't mapped onto anything and
  // only ever surfaced as "Validation error" (F-15 forms cycle).
  const result = await validateBody(updatePayrollRunSchema, body);
  if (result.error) return result.error;
  const parsed = { data: result.data } as const;

  // Serializable: fetch + status guard + overlap check + update commit
  // atomically so two concurrent DRAFT edits cannot both pass the overlap
  // guard and both write.
  let updated: Awaited<ReturnType<typeof prisma.payrollRun.update>>;
  try {
    updated = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.payrollRun.findUnique({ where: { id } });
        if (!existing || existing.tenantId !== session.tenantId) {
          throw new Error("NOT_FOUND");
        }
        if (existing.status !== "DRAFT") {
          throw new Error("NOT_DRAFT");
        }

        const nextStart = parsed.data.periodStart ?? existing.periodStart;
        const nextEnd = parsed.data.periodEnd ?? existing.periodEnd;
        if (nextStart > nextEnd) {
          throw new Error("PERIOD_INVALID");
        }

        // HRX-3: Hari Kerja Aktual is 1..calendar days of the (possibly updated)
        // period. The schema enforces the lower bound; only here do we know the
        // period. Checked against the effective value so shrinking the period
        // under a stored value is caught too.
        const maxWorkDays = calendarDaysInPeriod(nextStart, nextEnd);
        const nextWorkDays = parsed.data.actualWorkDays ?? existing.actualWorkDays;
        if (nextWorkDays > maxWorkDays) {
          throw Object.assign(new Error("WORKDAYS_RANGE"), { msg: actualWorkDaysRangeMessage(maxWorkDays) });
        }

        if (parsed.data.periodStart !== undefined || parsed.data.periodEnd !== undefined) {
          const overlapping = await tx.payrollRun.findFirst({
            where: {
              tenantId: session.tenantId!,
              id: { not: id },
              periodStart: { lte: nextEnd },
              periodEnd: { gte: nextStart },
            },
            select: { periodStart: true, periodEnd: true },
          });
          if (overlapping) {
            throw Object.assign(new Error("OVERLAP"), {
              msg: `Periode tumpang tindih dengan penggajian ${overlapping.periodStart} - ${overlapping.periodEnd}`,
            });
          }
        }

        return tx.payrollRun.update({ where: { id }, data: parsed.data });
      },
      { isolationLevel: "Serializable" }
    );
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (e.message === "NOT_DRAFT") return NextResponse.json({ error: "Hanya draf yang bisa diubah" }, { status: 409 });
      if (e.message === "PERIOD_INVALID") return NextResponse.json({ error: "Tanggal mulai periode harus sebelum atau sama dengan tanggal selesai" }, { status: 400 });
      if (e.message === "WORKDAYS_RANGE") {
        const msg = (e as Error & { msg: string }).msg;
        return NextResponse.json(
          { error: msg, errors: [{ field: "actualWorkDays", message: msg }] },
          { status: 400 },
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (e.message === "OVERLAP") return NextResponse.json({ error: (e as any).msg }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json(updated);
}
