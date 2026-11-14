import { NextRequest, NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { updateStudentFeeAdjustmentSchema } from "@/lib/validations/student-fee-adjustment";

// PUT is the only mutation here — no DELETE. Soft delete and reactivate are
// both `PUT { status }` per .claude/standards/crud.md's Category A pattern.

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`update-student-fee-adjustment:${getClientIp(req)}`, 30, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "fees.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  // Verify tenant ownership before touching the payload at all.
  const existing = await prisma.studentFeeAdjustment.findFirst({
    where: { id, tenantId: session.tenantId },
  });
  if (!existing) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateStudentFeeAdjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { mode, value, reason, validFrom, validTo, status } = parsed.data;

  // CRITICAL — the update schema cannot enforce the PERCENT <= 100 cap on
  // its own: a payload that changes only `value` (the common "admin
  // corrects the discount amount" case) never resends `mode`, and the
  // schema has no visibility into the stored row. Re-check here against the
  // EFFECTIVE mode/value — the ones this write will actually leave in place
  // — so a percent grant can't be pushed past 100% one field at a time
  // (e.g. PUT { value: 150 } against a row already stored as PERCENT).
  const effectiveMode = mode ?? existing.mode;
  const effectiveValue = value ?? Number(existing.value);
  if (effectiveMode === "PERCENT" && effectiveValue > 100) {
    return NextResponse.json(
      {
        error: "Nilai persentase tidak boleh lebih dari 100",
        issues: [{ path: ["value"], message: "Nilai persentase tidak boleh lebih dari 100" }],
      },
      { status: 400 },
    );
  }

  // Same partial-update problem as the cap above, one field over: sending
  // only `validFrom` can leave it after a `validTo` that was stored by an
  // earlier request, which the schema's own refinement never sees. Compare
  // the EFFECTIVE window. `undefined` means unchanged, `null` means cleared.
  const effectiveValidFrom = validFrom === undefined ? existing.validFrom : validFrom;
  const effectiveValidTo = validTo === undefined ? existing.validTo : validTo;
  if (effectiveValidFrom && effectiveValidTo && effectiveValidTo < effectiveValidFrom) {
    return NextResponse.json(
      {
        error: "Tanggal berakhir tidak boleh sebelum tanggal mulai",
        issues: [
          { path: ["validTo"], message: "Tanggal berakhir tidak boleh sebelum tanggal mulai" },
        ],
      },
      { status: 400 },
    );
  }

  // Partial update — Prisma omits undefined keys, so a payload carrying only
  // { value } (or only { status } for the soft-delete/reactivate toggle)
  // touches just that column, matching the PUT pattern in
  // app/api/fee-components/[id]/route.ts.
  const adjustment = await prisma.studentFeeAdjustment.update({
    where: { id },
    data: { mode, value, reason, validFrom, validTo, status },
  });

  return NextResponse.json(adjustment);
}
