import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redactConsentSignatures } from "@/lib/enrollment/sanitize-consent";
import { toAdminDocuments } from "@/lib/enrollment/documents";
import { mergeJsonKey } from "@/lib/enrollment/json-merge";
import { ADMIN_FEE_SELECT, feeAttentionFrom, toAdminFeeView, type AdminFeeView } from "@/lib/enrollment/fee-admin-view";
import { getProgramFees } from "@/lib/enrollment/fee-config";
import { repriceUnpaidFee, type FeeNote } from "@/lib/enrollment/fee-snapshot";
import { changedKeys, isPlainObject, mergeSection } from "@/lib/enrollment/staff-edit";
import { parseEnrollmentEdit } from "@/lib/validations/enrollment-edit";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canRemind, parentFormUrl } from "@/lib/enrollment/follow-up";
import { resolveAppOrigin } from "@/lib/payments/session";

// Admin status workflow. INVITED is owned by the parent (pre-submit) and is
// never an admin target. A converted application (studentId set) is frozen.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ["UNDER_REVIEW", "ACCEPTED", "REJECTED"],
  UNDER_REVIEW: ["ACCEPTED", "REJECTED", "SUBMITTED"],
  ACCEPTED: ["UNDER_REVIEW", "REJECTED"],
  REJECTED: ["UNDER_REVIEW"],
};

// Thrown inside the transaction to abort it with a specific HTTP response.
class PatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

const REPRICE_FORBIDDEN = "Mengubah program mengubah biaya pendaftaran; butuh izin keuangan.";
const CONVERTED = "Pendaftaran ini sudah dikonversi menjadi siswa dan tidak bisa diubah.";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      accessToken: true,
      status: true,
      studentId: true,
      childName: true,
      parentEmail: true,
      dcareAddon: true,
      submittedAt: true,
      studentData: true,
      ayahData: true,
      ibuData: true,
      consentData: true,
      documents: true,
      program: { select: { id: true, name: true } },
      admission: {
        select: { id: true, parentName: true, parentPhone: true, parentWhatsapp: true, parentRelationship: true },
      },
      fee: { select: { ...ADMIN_FEE_SELECT, id: true } },
    },
  });
  if (!app || app.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // `accessToken` is a credential: it is only ever used here to build the one
  // link staff may copy, and is never sent on its own.
  const { tenantId, accessToken, fee, ...rest } = app;
  const canEdit = hasPermission(session, "admissions.edit");
  const feeView = fee ? toAdminFeeView(fee) : null;

  // Chasing an unpaid fee. `formUrl` is the parent's form link (it leads to the
  // fee once submitted) for "Salin tautan"; the WhatsApp reminder itself is
  // opened through the reminder endpoint, so this is the ONLY place a token is
  // returned — for one application, to staff who can act on it.
  let followUp: { formUrl: string; canRemind: boolean } | null = null;
  // Not for a REJECTED application: the parent's pay link is closed (409
  // APPLICATION_CLOSED), so a reminder would send them to a dead end.
  if (canEdit && feeView?.status === "UNPAID" && rest.status !== "REJECTED") {
    followUp = {
      formUrl: parentFormUrl(resolveAppOrigin(new URL(req.url).origin), accessToken),
      canRemind: canRemind({ admission: rest.admission, ayahData: rest.ayahData, ibuData: rest.ibuData }),
    };
  }

  // Payments the processor refused to credit (wrong amount, a second payment,
  // money on a waived fee): written against this fee's id, shown as "perlu dicek".
  const problems =
    fee && feeView
      ? feeAttentionFrom(
          await prisma.webhookEvent.findMany({
            where: { invoiceId: fee.id, status: "ERROR" },
            select: { errorMessage: true },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
          feeView.status,
        )
      : [];

  return NextResponse.json({
    ...rest,
    canEdit,
    fee: feeView,
    followUp,
    feeProblems: problems,
    // What the signed-in staff member may do to the fee: the UI hides what it
    // would only be refused (the API enforces the same keys).
    feePermissions: {
      recordPayment: canEdit && hasPermission(session, "payments.record"),
      adjust: canEdit && hasPermission(session, "fees.edit"),
    },
    consentData: redactConsentSignatures(rest.consentData),
    // Per-item state only — storage tokens never leave the server.
    documents: toAdminDocuments(rest.documents),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;

  const limit = rateLimit(`enrollment-edit:${session.id}`, 60, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;

  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      status: true,
      studentId: true,
      programId: true,
      dcareAddon: true,
      fee: { select: { status: true } },
    },
  });
  if (!app || app.tenantId !== tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = parseEnrollmentEdit(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validasi gagal", errors: parsed.errors }, { status: 400 });
  }
  const { data: body, clears } = parsed;

  // A converted application is frozen — except the physical-receipt checklist,
  // which staff keep ticking as paper documents arrive after conversion.
  const touchesForm = Object.entries(body).some(([k, v]) => k !== "documentsReceived" && v !== undefined);
  if (app.studentId && touchesForm) {
    return NextResponse.json({ error: CONVERTED }, { status: 409 });
  }

  // Changing the program or Day Care re-prices an UNPAID fee: that is the same
  // revenue decision as a discount, so it needs the finance key on top of
  // admissions.edit (checked before anything is written; re-checked under the lock).
  const canEditFees = hasPermission(session, "fees.edit");
  const programMoves = body.programId !== undefined && (body.programId || null) !== (app.programId ?? null);
  const dcareMoves = body.dcareAddon !== undefined && body.dcareAddon !== app.dcareAddon;
  if ((programMoves || dcareMoves) && app.fee?.status === "UNPAID" && !canEditFees) {
    return NextResponse.json({ error: REPRICE_FORBIDDEN }, { status: 403 });
  }

  let result: { id: string; status: string; fee?: AdminFeeView | null; feeNote?: FeeNote } = { id: app.id, status: app.status };

  if (touchesForm) {
    try {
      result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Row lock: a parent's draft save (a single UPDATE) waits for this
        // transaction, so the read-merge-write below cannot lose a signature or
        // a field the parent typed meanwhile. Also re-checks the converted rule.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "EnrollmentApplication" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE
        `;
        if (!locked || locked.length === 0) throw new PatchError("Not found", 404);
        const cur = await tx.enrollmentApplication.findUnique({
          where: { id },
          select: {
            status: true,
            studentId: true,
            programId: true,
            dcareAddon: true,
            studentData: true,
            ayahData: true,
            ibuData: true,
            consentData: true,
          },
        });
        if (!cur) throw new PatchError("Not found", 404);
        if (cur.studentId) throw new PatchError(CONVERTED, 409);

        const data: Record<string, unknown> = {};
        const changed: string[] = [];
        let onlyParentChange: { from: string | null; to: string | null } | null = null;

        if (body.status !== undefined) {
          const allowed = ALLOWED_TRANSITIONS[cur.status] ?? [];
          if (!allowed.includes(body.status)) {
            throw new PatchError(`Transisi status ${cur.status} → ${body.status} tidak diizinkan`, 400);
          }
          data.status = body.status;
          changed.push("status");
        }

        for (const section of ["studentData", "ayahData", "ibuData"] as const) {
          if (body[section] === undefined) continue;
          const next = mergeSection(cur[section], body[section], clears[section]);
          const keys = changedKeys(cur[section], next);
          if (keys.length === 0) continue;
          data[section] = next;
          changed.push(...keys.map((k) => `${section}.${k}`));
          if (section === "studentData" && keys.includes("childName")) {
            // The column mirrors the form field; a cleared name is stored empty.
            const cn = next.childName;
            data.childName = typeof cn === "string" ? cn.trim().slice(0, 80) : "";
          }
        }

        if (body.consentData !== undefined) {
          // Only `onlyParent` survives validation, so the stored signatures, signing
          // times and agreement ride through the merge untouched.
          const next = mergeSection(cur.consentData, body.consentData, clears.consentData);
          const keys = changedKeys(cur.consentData, next);
          if (keys.length > 0) {
            data.consentData = next;
            if (keys.includes("onlyParent")) {
              onlyParentChange = {
                from: ((isPlainObject(cur.consentData) ? cur.consentData.onlyParent : undefined) as string | undefined) ?? null,
                to: (next.onlyParent as string | undefined) ?? null,
              };
            }
            changed.push(...keys.map((k) => `consentData.${k}`));
          }
        }

        let nextProgramId: string | null = cur.programId ?? null;
        if (body.programId !== undefined) {
          const requested = body.programId || null;
          if (requested !== (cur.programId ?? null)) {
            if (requested) {
              // ACTIVE program of THIS tenant only (IDOR guard + no retired program).
              // Only checked when it CHANGES: re-sending a retired program the
              // form already holds must not block fixing a typo elsewhere.
              const programs = await getProgramFees(tenantId, tx);
              if (!programs.some((p) => p.id === requested)) {
                throw new PatchError("Validasi gagal", 400, [
                  { field: "programId", message: "Program tidak ditemukan atau sudah tidak aktif" },
                ]);
              }
            }
            nextProgramId = requested;
            data.programId = requested;
            changed.push("programId");
          }
        }
        const nextDcare = body.dcareAddon ?? cur.dcareAddon;
        if (nextDcare !== cur.dcareAddon) {
          data.dcareAddon = nextDcare;
          changed.push("dcareAddon");
        }

        if (("programId" in data || "dcareAddon" in data) && !canEditFees) {
          // The pre-read can be stale: re-check under the lock before touching a fee.
          const owed = await tx.enrollmentFee.findFirst({
            where: { applicationId: id, tenantId, status: "UNPAID" },
            select: { id: true },
          });
          if (owed) throw new PatchError(REPRICE_FORBIDDEN, 403);
        }

        const out: { id: string; status: string; fee?: AdminFeeView | null; feeNote?: FeeNote } = { id, status: cur.status };
        if (Object.keys(data).length > 0) {
          const updated = await tx.enrollmentApplication.update({ where: { id, tenantId }, data, select: { id: true, status: true } });
          out.id = updated.id;
          out.status = updated.status;
        }
        if (changed.length > 0) {
          // Field NAMES only — the values are parent / child PII.
          await recordAudit(
            {
              tenantId,
              actorId: session.id,
              entity: "EnrollmentApplication",
              entityId: id,
              action: "update",
              after: {
                fields: changed,
                // An enum, not PII: say who fills the form, from and to.
                ...(onlyParentChange ? { onlyParent: onlyParentChange } : {}),
              },
            },
            tx,
          );
        }

        // Program or Day Care moved: the price moves with it (UNPAID only).
        if ("programId" in data || "dcareAddon" in data) {
          const repriced = await repriceUnpaidFee(tx, {
            tenantId,
            applicationId: id,
            programId: nextProgramId,
            dcareAddon: nextDcare,
            actorId: session.id,
          });
          out.fee = repriced.fee;
          out.feeNote = repriced.note;
        }
        return out;
      });
    } catch (e) {
      if (e instanceof PatchError) {
        return NextResponse.json(
          e.errors ? { error: e.message, errors: e.errors } : { error: e.message },
          { status: e.status },
        );
      }
      throw e;
    }
  }

  if (body.documentsReceived !== undefined) {
    const nowIso = new Date().toISOString();
    for (const [key, received] of Object.entries(body.documentsReceived)) {
      const ok = await mergeJsonKey(
        id,
        "documents",
        key,
        { receivedPhysical: received, receivedAt: received ? nowIso : null },
        { requireInvited: false, tenantId },
      );
      if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // The checklist is merged key-by-key outside the form transaction (its own
    // atomic UPDATE), so its audit row is separate. Names only.
    await recordAudit({
      tenantId,
      actorId: session.id,
      entity: "EnrollmentApplication",
      entityId: id,
      action: "update",
      after: { fields: ["documentsReceived"], documents: Object.keys(body.documentsReceived) },
    });
  }

  return NextResponse.json(result);
}
