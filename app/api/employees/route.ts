import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createEmployeeSchema } from "@/lib/validations/employee";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { fieldErrorResponse, isUniqueViolation } from "@/lib/api/field-errors";
import { isKodeCollision, nextEmployeeKode } from "@/lib/employees/kode";

// A P2002 on (tenantId, kode) is retried with a freshly computed code; the
// advisory lock makes it rare, but a stale read or a second app instance can
// still race it.
const KODE_MAX_ATTEMPTS = 3;

export async function GET(req: NextRequest) {
  const auth = await requirePermission("hr.view");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  const { searchParams } = new URL(req.url);
  const { skip, take, page, pageSize } = parsePagination(searchParams);
  const sort = parseSort(searchParams, {
    allow: ["nama", "kode", "email", "jabatan", "hireDate", "createdAt", "status"],
    default: "nama",
    defaultOrder: "asc",
  });
  if (sort instanceof Response) return sort;
  const { orderBy } = sort;
  const search = escapeLike(cleanSearch(searchParams.get("search")));
  const campusId = searchParams.get("campusId");
  const status = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId: session.tenantId };
  if (campusId && campusId !== "all") where.campusId = campusId;
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { nama: { contains: search, mode: "insensitive" } },
      { kode: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take,
      include: { campus: { select: { name: true } } },
      orderBy,
    }),
    prisma.employee.count({ where }),
  ]);

  // Salary fields visibility keyed to payroll.view. SUPER_ADMIN passes via
  // the short-circuit; a custom role with payroll.view also gets bank/BPJS
  // fields; SCHOOL_ADMIN default set excludes hr.*, so shape is stripped.
  const canSeeSalary = hasPermission(session, "payroll.view");
  const safeEmployees = canSeeSalary
    ? employees
    : employees.map((e) => {
        const { bankAccountNo, bankName, bpjsEnrolled, ...rest } = e;
        return rest;
      });
  return NextResponse.json(paginatedResponse(safeEmployees, total, page, pageSize));
}

export async function POST(req: NextRequest) {
  const { success } = rateLimit(`create-employee:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const auth = await requirePermission("employees.create");
  if ("error" in auth) return auth.error;
  const { session } = auth;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }
  const result = await validateBody(createEmployeeSchema, rawBody);
  if (result.error) return result.error;
  const body = result.data;
  const tenantId = session.tenantId;

  // Block writes targeting INACTIVE/cross-tenant campus — without this,
  // a soft-deleted campus could still grow new employee dependents and
  // undermine the employee-attached guard on Campus DELETE.
  if (body.campusId) {
    const activeCampus = await prisma.campus.findFirst({
      where: { id: body.campusId, tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!activeCampus) {
      return NextResponse.json(
        { error: "Kampus tidak ditemukan atau nonaktif." },
        { status: 400 },
      );
    }
  }

  const email = body.email.trim();

  // Auto-generate employee code: initials + sequence number (atomic)
  const createOnce = () => prisma.$transaction(async (tx) => {
    // F-25: advisory lock per tenant to serialize employee code generation.
    // Use single-arg `pg_advisory_xact_lock(hashtext(...))` for parity with
    // invoice/webhook locks (`hashtext(invoiceId)`); namespacing by string
    // prevents collision with the bare numeric `12345` previously used —
    // any future caller that picks the same arbitrary integer would deadlock
    // employee creation. `hashtext` returns int4; Postgres implicitly widens
    // it to int8 for the `pg_advisory_xact_lock(bigint)` overload.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"employee_create_" + tenantId}))`;

    // HR-5: the email is the login identity. Refuse (inside the tenant-wide
    // advisory lock, so two concurrent creates cannot both pass) when another
    // Employee already carries it, or when a User with that email is already
    // linked to a different employee or holds a different role — the old
    // upsert silently rewrote that user's role and orphaned their employee.
    const emailTaken = await tx.employee.findFirst({
      where: { tenantId, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (emailTaken) {
      return { conflict: "Email sudah dipakai karyawan lain" } as const;
    }
    const existingUser = await tx.user.findFirst({
      where: { tenantId, email: { equals: email, mode: "insensitive" } },
      select: { id: true, role: true, employeeId: true },
    });
    if (existingUser?.employeeId) {
      return { conflict: "Email sudah terhubung ke karyawan lain" } as const;
    }
    if (existingUser && existingUser.role !== body.role) {
      return {
        conflict: `Email sudah terdaftar sebagai pengguna dengan peran ${existingUser.role}. Gunakan email lain atau samakan perannya.`,
      } as const;
    }

    // STR-4: numeric max suffix over every code in the tenant (INACTIVE
    // included — the unique index does not care about status).
    const existing = await tx.employee.findMany({
      where: { tenantId },
      select: { kode: true },
    });
    const kode = nextEmployeeKode(
      body.nama,
      existing.map((e) => e.kode),
    );

    const emp = await tx.employee.create({
      data: {
        tenantId,
        kode,
        nama: body.nama.trim(),
        formalName: body.formalName?.trim() || null,
        email,
        noHp: body.noHp?.trim() || null,
        jabatan: body.jabatan.trim(),
        campusId: body.campusId,
        hireDate: body.hireDate,
        bankName: body.bankName?.trim() || null,
        bankAccountNo: body.bankAccountNo?.trim() || null,
        bpjsEnrolled: body.bpjsEnrolled ?? false,
        // Undefined when the input is left blank — Prisma applies @default(12)
        // / @default(14). An explicit value (e.g. mid-year hire) is honoured.
        leaveBalanceAnnual: body.leaveBalanceAnnual,
        leaveBalanceSick: body.leaveBalanceSick,
      },
    });

    // F-26: role from validated body (defaults to TEACHER for legacy callers).
    // An existing User with this email (manually invited, preserved auth
    // login) is only *linked* — and only when it is unlinked and already has
    // the requested role (checked above); its role/name are never rewritten.
    if (existingUser) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: { employeeId: emp.id },
      });
    } else {
      await tx.user.create({
        data: {
          tenantId,
          email,
          role: body.role,
          name: body.nama.trim(),
          employeeId: emp.id,
        },
      });
    }

    return { employee: emp } as const;
  });

  let outcome: Awaited<ReturnType<typeof createOnce>> | undefined;
  for (let attempt = 1; attempt <= KODE_MAX_ATTEMPTS; attempt++) {
    try {
      outcome = await createOnce();
      break;
    } catch (e) {
      if (isKodeCollision(e)) continue;
      if (isUniqueViolation(e)) {
        return fieldErrorResponse("email", "Email sudah dipakai karyawan atau pengguna lain");
      }
      throw e;
    }
  }
  if (!outcome) {
    return NextResponse.json(
      { error: "Kode karyawan sedang dipakai permintaan lain. Coba simpan lagi." },
      { status: 409 },
    );
  }

  if (outcome.conflict !== undefined) return fieldErrorResponse("email", outcome.conflict);
  const employee = outcome.employee;

  revalidateTag("employees-count", {});
  return NextResponse.json(employee, { status: 201 });
}
