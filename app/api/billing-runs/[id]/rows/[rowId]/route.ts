import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { updateBillingRunRowSchema } from "@/lib/validations/billing-run";

// Billing Run wizard (Cycle B1 — docs/cycles/2026-08-14-billing-run-wizard.md,
// Task T5). Step 2's exclude/re-include toggle.
//
// Deliberately NO `export const revalidate` here — row status is mutable
// draft state toggled directly from step 2 of the wizard; caching would
// serve a stale exclude/re-include state on the very next render.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> },
) {
  const { success } = rateLimit(`update-billing-run-row:${getClientIp(req)}`, 60, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id: billingRunId, rowId } = await params;

  // Verify the run belongs to the tenant AND the row belongs to the run —
  // two separate ownership hops, checked before touching the payload.
  const run = await prisma.billingRun.findFirst({
    where: { id: billingRunId, tenantId: session.tenantId },
    select: { id: true, status: true },
  });
  if (!run) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const row = await prisma.billingRunRow.findFirst({
    where: { id: rowId, billingRunId },
    select: { id: true, status: true },
  });
  if (!row) return NextResponse.json({ error: "Baris tidak ditemukan" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateBillingRunRowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (run.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Run tagihan tidak lagi berstatus draft" },
      { status: 409 },
    );
  }

  // A COMMITTED row already has an invoice attached — flipping it back to
  // PENDING would let a later commit pass re-invent that invoice. Never
  // allowed, regardless of run status.
  if (row.status === "COMMITTED") {
    return NextResponse.json(
      { error: "Baris sudah dikomit, tidak bisa diubah" },
      { status: 409 },
    );
  }

  const updated = await prisma.billingRunRow.update({
    where: { id: rowId },
    // Clear any parked reason (e.g. "Rp 0 — tidak ditagih" from a commit
    // pass) — an explicit exclude/re-include by the admin supersedes it, and
    // the next commit re-evaluates the total from scratch.
    data: { status: parsed.data.status, error: null },
  });

  return NextResponse.json(updated);
}
