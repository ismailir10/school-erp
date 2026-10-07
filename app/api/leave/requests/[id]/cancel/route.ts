import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { recordAudit } from "@/lib/audit";

/**
 * F-27: leave-request cancel endpoint.
 *
 * Two cancel paths share this handler:
 *
 *   1. PENDING — owner (matches `employeeId === session.employeeId`) cancels
 *      their own pending request before approval. Status flip only; no
 *      balance / attendance side-effects, because none have been applied yet.
 *
 *   2. APPROVED — owner OR an admin holding `leave.approve` reverses an
 *      already-approved leave. Inside a Serializable transaction we:
 *        a) Re-read the row (CAS-style status guard inside tx).
 *        b) Restore the employee leave balance (annual / sick) by
 *           `request.days`.
 *        c) Delete the LEAVE attendance rows that the approve handler
 *           generated. The approve handler stamps every generated row with
 *           `overrideReason` starting `Cuti:` — that prefix is the
 *           discriminator. Manual LEAVE rows entered through other admin
 *           flows carry a different override reason and are left untouched.
 *           Locked rows (`isLocked = true`, written by payroll approve) are
 *           also skipped — once payroll has frozen the day we cannot retro-
 *           silently mutate it.
 *        d) Flip status to CANCELLED with the optional `reviewNote`.
 *        e) Record an audit row (re-throws on failure → tx aborts).
 *
 * REJECTED / CANCELLED → 409 (no-op, not an error worth retrying).
 *
 * Tenancy: LeaveRequest has no `tenantId` column — tenancy is derived via
 * the employee relation. The handler refuses to operate on a request whose
 * employee belongs to a different tenant (404, indistinguishable from
 * "not found" on purpose).
 */

const cancelBodySchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = rateLimit(`leave-cancel:${getClientIp(req)}`, 30, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const session = await getSession();
  if (!session || !session.tenantId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const canSubmit = hasPermission(session, "leave.submit");
  const canApprove = hasPermission(session, "leave.approve");
  if (!canSubmit && !canApprove) {
    return NextResponse.json(
      { error: "forbidden", missing: "leave.submit" },
      { status: 403 }
    );
  }

  const { id } = await params;

  // Body is optional — empty body, {}, and {note:"..."} all valid.
  let rawBody: unknown = {};
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }
  }
  const parsed = await validateBody(cancelBodySchema, rawBody ?? {});
  if (parsed.error) return parsed.error;
  const { note } = parsed.data;

  const existing = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { employee: { select: { tenantId: true } } },
  });

  if (!existing || existing.employee.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Authorisation: owner OR holder of leave.approve. A non-owner without
  // `leave.approve` cannot cancel someone else's request even if they hold
  // `leave.submit` for themselves.
  const isOwner =
    !!session.employeeId && existing.employeeId === session.employeeId;
  if (!isOwner && !canApprove) {
    return NextResponse.json(
      { error: "forbidden", missing: "leave.approve" },
      { status: 403 }
    );
  }

  // Status guard before opening the transaction. The tx re-reads inside
  // Serializable so a concurrent approve/cancel cannot slip past us.
  if (existing.status !== "PENDING" && existing.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Hanya pengajuan PENDING atau APPROVED yang bisa dibatalkan" },
      { status: 409 }
    );
  }

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.leaveRequest.findUnique({ where: { id } });
        if (!fresh) {
          // Race: row vanished. Bubble up via sentinel.
          return { kind: "not-found" as const };
        }
        if (fresh.status !== "PENDING" && fresh.status !== "APPROVED") {
          return { kind: "conflict" as const };
        }

        const wasApproved = fresh.status === "APPROVED";

        if (wasApproved) {
          // No balance write here. Remaining leave is derived — the
          // entitlement column minus the sum of APPROVED requests
          // (lib/leave/balance.ts) — and approve never decrements the column,
          // so flipping this row to CANCELLED already gives the days back.
          // Incrementing the column as well raised the entitlement itself and
          // double-counted every cancellation.

          // Delete generated LEAVE attendance rows. Match by:
          //   - employeeId
          //   - date in [startDate, endDate]
          //   - status === "LEAVE"
          //   - overrideReason starts with "Cuti:" (the prefix the approve
          //     handler stamps on every row it generates)
          //   - isLocked === false (don't touch payroll-frozen rows)
          // Manual LEAVE entries carry a different reason and survive.
          await tx.attendanceRecord.deleteMany({
            where: {
              employeeId: fresh.employeeId,
              date: { gte: fresh.startDate, lte: fresh.endDate },
              status: "LEAVE",
              overrideReason: { startsWith: "Cuti:" },
              isLocked: false,
            },
          });
        }

        const after = await tx.leaveRequest.update({
          where: { id },
          data: {
            status: "CANCELLED",
            reviewNote: note?.trim() || null,
            reviewedBy: session.id,
            reviewedAt: new Date(),
          },
        });

        await recordAudit(
          {
            tenantId: session.tenantId!,
            actorId: session.id,
            entity: "LeaveRequest",
            entityId: id,
            action: "cancel",
            before: {
              status: fresh.status,
              leaveType: fresh.leaveType,
              days: fresh.days,
            },
            after: { status: "CANCELLED", note: note ?? null },
          },
          tx
        );

        return { kind: "ok" as const, row: after };
      },
      { isolationLevel: "Serializable" }
    );

    if (updated.kind === "not-found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (updated.kind === "conflict") {
      return NextResponse.json(
        { error: "Hanya pengajuan PENDING atau APPROVED yang bisa dibatalkan" },
        { status: 409 }
      );
    }
    return NextResponse.json(updated.row);
  } catch (err) {
    // Serializable conflict surfaces as Prisma error P2034 — surface as 409
    // so the caller can refetch and retry.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2034") {
      return NextResponse.json(
        { error: "Terjadi konflik, silakan coba lagi" },
        { status: 409 }
      );
    }
    throw err;
  }
}
