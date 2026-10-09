import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { validateBody } from "@/lib/api/validate";
import { updateEmployeeSchema } from "@/lib/validations/employee";
import { fieldErrorResponse } from "@/lib/api/field-errors";
import { sumLeaveDays } from "@/lib/leave/balance";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("hr.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { campus: { select: { name: true } } },
  });

  if (!employee || employee.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Saldo Cuti shows what is left, not just the allowance: APPROVED days this
  // year, the same aggregate GET /api/leave/balance uses.
  const [leaveUsedAnnual, leaveUsedSick] = await Promise.all([
    sumLeaveDays(prisma, { employeeId: id, leaveType: "ANNUAL", statuses: ["APPROVED"] }),
    sumLeaveDays(prisma, { employeeId: id, leaveType: "SICK", statuses: ["APPROVED"] }),
  ]);

  if (!hasPermission(session, "payroll.view")) {
    const { bankAccountNo, bankName, bpjsEnrolled, ...rest } = employee;
    return NextResponse.json({ ...rest, leaveUsedAnnual, leaveUsedSick });
  }
  return NextResponse.json({ ...employee, leaveUsedAnnual, leaveUsedSick });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission("employees.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { id } = await params;

  // Verify tenant ownership before any mutation
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing || existing.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // F-13 fix: PUT no longer accepts `status` writes. The previous shortcut
  // here let `{status:"INACTIVE"}` skip validation, but the bigger bug was
  // that `updateEmployeeSchema` extended `status` so `{status:"ACTIVE"}`
  // would silently re-activate a deactivated employee. Both paths are gone
  // — status transitions go through POST /deactivate and POST /restore.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body harus JSON valid" }, { status: 400 });
  }

  const result = await validateBody(updateEmployeeSchema, rawBody);
  if (result.error) return result.error;
  const body = result.data;

  // HR-5: another Employee in the tenant must not share this email
  // (case-insensitive). Skipped when the address is unchanged so a legacy
  // duplicate row can still be edited for other fields.
  const nextEmail = body.email?.trim();
  if (nextEmail && nextEmail.toLowerCase() !== existing.email.trim().toLowerCase()) {
    const taken = await prisma.employee.findFirst({
      where: {
        tenantId: session.tenantId,
        id: { not: id },
        email: { equals: nextEmail, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (taken) return fieldErrorResponse("email", "Email sudah dipakai karyawan lain");
  }

  // Block re-assignment to INACTIVE/cross-tenant campus — see POST guard.
  if (body.campusId) {
    const activeCampus = await prisma.campus.findFirst({
      where: { id: body.campusId, tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!activeCampus) {
      return NextResponse.json(
        { error: "Kampus tidak ditemukan atau nonaktif." },
        { status: 400 },
      );
    }
  }

  // Only keys present in the parsed body are written. `undefined` is skipped
  // by Prisma, so a partial PUT such as `{ email }` leaves formalName/noHp/
  // bank*/bpjsEnrolled alone (HR-7); an explicit `null` or blank string still
  // clears a nullable column.
  const nullableTrim = (v: string | null | undefined) =>
    v === undefined ? undefined : v?.trim() || null;

  const employee = await prisma.employee.update({
    where: { id },
    data: {
      nama: body.nama?.trim(),
      formalName: nullableTrim(body.formalName),
      email: body.email?.trim(),
      noHp: nullableTrim(body.noHp),
      jabatan: body.jabatan?.trim(),
      campusId: body.campusId,
      hireDate: body.hireDate,
      bankName: nullableTrim(body.bankName),
      bankAccountNo: nullableTrim(body.bankAccountNo),
      bpjsEnrolled: body.bpjsEnrolled,
      // Undefined keys are omitted by Prisma — a blank input leaves the
      // existing balance untouched (no reset to default on every edit).
      leaveBalanceAnnual: body.leaveBalanceAnnual,
      leaveBalanceSick: body.leaveBalanceSick,
    },
  });

  // FIND-001: dashboard `TOTAL KARYAWAN` / `HADIR HARI INI` / `TIDAK HADIR`
  // KPI cards read from a cached query tagged "employees-count". Without
  // invalidation here the dashboard would show stale counts after an
  // Employee edit until the next deploy.
  revalidateTag("employees-count", { expire: 0 });

  return NextResponse.json(employee);
}
