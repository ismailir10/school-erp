import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";
import { BILLABLE_FEE_COMPONENT_WHERE } from "@/lib/finance/billable-fees";
import { saveBundleFeesSchema } from "@/lib/validations/fee-bundle";

// Harga paket sekolah + daycare — docs/cycles/2026-10-29-school-daycare-bundle-price.md.
//
// One explicit total per (school program, daycare program, fee component) for
// one academic year, edited on Tarif per Program. The billing loaders read the
// ACTIVE rows; clearing a price is a soft delete (status INACTIVE) and setting
// it again reactivates the same row.
//
// Deliberately NO `export const revalidate` and no `revalidatePath`: a bundle
// price feeds the next billing-run rebuild, so a cached GET would show a stale
// price (unlike /api/fee-structure, which changes about once a year).

const SCHOOL_TYPE = "SEMESTER";
const DAYCARE_TYPE = "YEAR_ROUND";

const BAD_PAIR = "Pilih satu program sekolah dan satu program daycare";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "fees.view")) {
    return NextResponse.json({ error: "forbidden", missing: "fees.view" }, { status: 403 });
  }
  const { tenantId } = session;

  const academicYearId = new URL(req.url).searchParams.get("academicYearId");
  if (!academicYearId) {
    return NextResponse.json({ error: "Tahun ajaran wajib dipilih" }, { status: 400 });
  }
  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, tenantId },
    select: { id: true },
  });
  if (!year) return NextResponse.json({ error: "Tahun ajaran tidak ditemukan" }, { status: 404 });

  const [programs, components, bundles] = await Promise.all([
    prisma.program.findMany({
      where: { tenantId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, code: true, name: true, type: true, status: true },
    }),
    prisma.feeComponentDef.findMany({
      where: { tenantId, status: "ACTIVE", ...BILLABLE_FEE_COMPONENT_WHERE },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, code: true, label: true },
    }),
    prisma.programBundleFee.findMany({
      where: { tenantId, academicYearId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        schoolProgramId: true,
        daycareProgramId: true,
        feeComponentId: true,
        amount: true,
        status: true,
      },
    }),
  ]);

  const programFees =
    programs.length === 0 || components.length === 0
      ? []
      : await prisma.programFeeStructure.findMany({
          where: {
            tenantId,
            academicYearId,
            programId: { in: programs.map((p) => p.id) },
            feeComponentId: { in: components.map((c) => c.id) },
          },
          select: { programId: true, feeComponentId: true, amount: true },
        });

  return NextResponse.json({
    canEdit: hasPermission(session, "fees.edit"),
    programs,
    components,
    programFees: programFees.map((f) => ({
      programId: f.programId,
      feeComponentId: f.feeComponentId,
      amount: Number(f.amount),
    })),
    bundles: bundles.map((b) => ({
      id: b.id,
      schoolProgramId: b.schoolProgramId,
      daycareProgramId: b.daycareProgramId,
      feeComponentId: b.feeComponentId,
      amount: Number(b.amount),
      status: b.status,
    })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "fees.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "fees.edit" }, { status: 403 });
  }
  const { success } = rateLimit(`save-fee-bundles:${session.id}`, 20, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi." }, { status: 429 });
  }
  const { tenantId, id: actorId } = session;

  const result = await validateBody(saveBundleFeesSchema, await req.json().catch(() => ({})));
  if (result.error) return result.error;
  const { academicYearId, changes } = result.data;

  const year = await prisma.academicYear.findFirst({
    where: { id: academicYearId, tenantId },
    select: { id: true },
  });
  if (!year) return NextResponse.json({ error: "Tahun ajaran tidak ditemukan" }, { status: 404 });

  if (changes.length === 0) return NextResponse.json({ ok: true, changed: 0 });

  // Tenant ownership of every program and component named, before any rule.
  const programIds = [...new Set(changes.flatMap((c) => [c.schoolProgramId, c.daycareProgramId]))];
  const componentIds = [...new Set(changes.map((c) => c.feeComponentId))];
  const [programs, components] = await Promise.all([
    prisma.program.findMany({
      where: { id: { in: programIds }, tenantId },
      select: { id: true, name: true, type: true },
    }),
    prisma.feeComponentDef.findMany({
      where: { id: { in: componentIds }, tenantId },
      select: { id: true, label: true, isEnabled: true, isRecurring: true, status: true },
    }),
  ]);
  if (programs.length !== programIds.length) {
    return NextResponse.json({ error: "Program tidak ditemukan" }, { status: 404 });
  }
  if (components.length !== componentIds.length) {
    return NextResponse.json({ error: "Komponen biaya tidak ditemukan" }, { status: 404 });
  }
  const programById = new Map(programs.map((p) => [p.id, p]));
  const componentById = new Map(components.map((c) => [c.id, c]));

  // Rules apply only when SETTING a price. Clearing is always allowed, so a
  // price whose programs were later edited (type change, component switched
  // off) can still be taken away.
  const setting = changes.filter((c) => c.amount !== null);
  for (const change of setting) {
    const school = programById.get(change.schoolProgramId)!;
    const daycare = programById.get(change.daycareProgramId)!;
    if (school.id === daycare.id || school.type !== SCHOOL_TYPE || daycare.type !== DAYCARE_TYPE) {
      return NextResponse.json({ error: BAD_PAIR }, { status: 400 });
    }
    const component = componentById.get(change.feeComponentId)!;
    if (!component.isEnabled || !component.isRecurring || component.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `${component.label} tidak bisa diberi harga paket: komponen harus aktif dan ditagih bulanan.` },
        { status: 400 },
      );
    }
  }
  if (setting.length > 0) {
    const fees = await prisma.programFeeStructure.findMany({
      where: {
        tenantId,
        academicYearId,
        programId: { in: [...new Set(setting.flatMap((c) => [c.schoolProgramId, c.daycareProgramId]))] },
        feeComponentId: { in: [...new Set(setting.map((c) => c.feeComponentId))] },
      },
      select: { programId: true, feeComponentId: true },
    });
    const priced = new Set(fees.map((f) => `${f.programId}|${f.feeComponentId}`));
    for (const change of setting) {
      for (const programId of [change.schoolProgramId, change.daycareProgramId]) {
        if (!priced.has(`${programId}|${change.feeComponentId}`)) {
          const program = programById.get(programId)!;
          const component = componentById.get(change.feeComponentId)!;
          return NextResponse.json(
            { error: `${program.name} belum punya tarif ${component.label} di tahun ajaran ini. Isi tarifnya dulu di Tarif per Program.` },
            { status: 400 },
          );
        }
      }
    }
  }

  try {
    const changed = await prisma.$transaction(async (tx) => {
      // Two saves for one year queue here, so the second sees the first's rows
      // instead of racing to create the same (pair, component) row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fee-bundles:${tenantId}:${academicYearId}`}))`;

      let count = 0;
      for (const change of changes) {
        const existing = await tx.programBundleFee.findUnique({
          where: {
            schoolProgramId_daycareProgramId_academicYearId_feeComponentId: {
              schoolProgramId: change.schoolProgramId,
              daycareProgramId: change.daycareProgramId,
              academicYearId,
              feeComponentId: change.feeComponentId,
            },
          },
        });
        const key = {
          schoolProgramId: change.schoolProgramId,
          daycareProgramId: change.daycareProgramId,
          feeComponentId: change.feeComponentId,
        };

        if (change.amount === null) {
          // Nothing to clear.
          if (!existing || existing.status !== "ACTIVE") continue;
          await tx.programBundleFee.update({ where: { id: existing.id }, data: { status: "INACTIVE" } });
          await recordAudit(
            {
              tenantId,
              actorId,
              entity: "ProgramBundleFee",
              entityId: existing.id,
              action: "deactivate",
              before: { ...key, academicYearId, amount: Number(existing.amount), status: "ACTIVE" },
              after: { ...key, academicYearId, amount: Number(existing.amount), status: "INACTIVE" },
            },
            tx,
          );
          count += 1;
          continue;
        }

        if (!existing) {
          const created = await tx.programBundleFee.create({
            data: { tenantId, academicYearId, ...key, amount: change.amount, status: "ACTIVE" },
          });
          await recordAudit(
            {
              tenantId,
              actorId,
              entity: "ProgramBundleFee",
              entityId: created.id,
              action: "create",
              after: { ...key, academicYearId, amount: change.amount, status: "ACTIVE" },
            },
            tx,
          );
          count += 1;
          continue;
        }

        // Same amount and already ACTIVE: no write, no audit row.
        if (existing.status === "ACTIVE" && Number(existing.amount) === change.amount) continue;

        await tx.programBundleFee.update({
          where: { id: existing.id },
          data: { amount: change.amount, status: "ACTIVE" },
        });
        await recordAudit(
          {
            tenantId,
            actorId,
            entity: "ProgramBundleFee",
            entityId: existing.id,
            action: "update",
            before: { ...key, academicYearId, amount: Number(existing.amount), status: existing.status },
            after: { ...key, academicYearId, amount: change.amount, status: "ACTIVE" },
          },
          tx,
        );
        count += 1;
      }
      return count;
    });

    return NextResponse.json({ ok: true, changed });
  } catch (err) {
    console.error("save fee bundles:", err);
    return NextResponse.json({ error: "Terjadi kesalahan server" }, { status: 500 });
  }
}
