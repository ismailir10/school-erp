import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { updateAdmissionSchema, hasAdmissionContact, ADMISSION_CONTACT_REQUIRED } from "@/lib/validations/admission";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { hasPermission } from "@/lib/permissions";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { programInTenant, PROGRAM_NOT_FOUND } from "@/lib/admission/program-scope";
import { recordAudit } from "@/lib/audit";

// Allowed status transitions for the Admission state machine.
// Terminal state CANCELLED has no outgoing transitions. ADMITTED is terminal
// in the next-action surface (no NEXT_STATUS entry) but retains the ADMITTED
// → CANCELLED escape hatch; "converted vs not" is encoded by `studentId`
// (cycle 2026-05-12 — REGISTERED state dropped, see docs/cycles/archive/2026-05-12-admission-lifecycle-simplification.md).
// Kept in sync with the ⋮ menu on /admin/admissions.
const VALID_TRANSITIONS: Record<string, string[]> = {
  INQUIRY: ["VISIT_SCHEDULED", "CANCELLED"],
  VISIT_SCHEDULED: ["VISITED", "CANCELLED"],
  VISITED: ["ADMITTED", "CANCELLED"],
  ADMITTED: ["CANCELLED"],
  CANCELLED: [],
};

/** Optional text/enum columns: a key present in the body is written; blank clears it to null. */
const NULLABLE_FIELDS = [
  "parentRelationship",
  "parentPhone",
  "parentWhatsapp",
  "parentEmail",
  "childGender",
  "dateOfBirth",
  "programId",
  "notes",
] as const;
const CONTACT_FIELDS = ["parentPhone", "parentWhatsapp", "parentEmail"] as const;

/**
 * A client that round-trips a GET row sends `null` for empty columns; read that
 * as "clear", the same as a blank string. `status` is left alone.
 */
function nullToBlank(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value === null && key !== "status" ? "" : value]),
  );
}

function fieldError(field: string, message: string) {
  return NextResponse.json({ error: "Validasi gagal", errors: [{ field, message }] }, { status: 400 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { success } = rateLimit(`update-admission:${getClientIp(req)}`, 20, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const { id } = await params;
  const existing = await prisma.admission.findFirst({ where: { id, tenantId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = nullToBlank(await req.json().catch(() => null));
  const parsed = updateAdmissionSchema.safeParse(raw);
  if (!parsed.success) {
    // Log the rejection shape so Vercel runtime logs surface the actual reason
    // (issues array, not just the 400 envelope). Bodies are not captured by
    // default; this line is what makes 400s diagnosable without DevTools.
    console.error(
      `[admin-admissions PUT] validation failed id=${id}`,
      JSON.stringify(parsed.error.issues),
    );
    const errors = parsed.error.issues.map((e) => ({ field: e.path.join("."), message: e.message }));
    return NextResponse.json({ error: "Validasi gagal", errors }, { status: 400 });
  }
  const body = parsed.data;
  // The schema turns a blank string into `undefined`, so "was this key sent?" is
  // read from the raw body: a present key is written (blank clears it).
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(raw as object, key);

  if (body.status && body.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.status)) {
      console.error(
        `[admin-admissions PUT] invalid transition id=${id} from=${existing.status} to=${body.status}`,
      );
      return NextResponse.json(
        { error: `Invalid status transition from ${existing.status} to ${body.status}` },
        { status: 400 },
      );
    }
  }

  const data: Record<string, string | null> = {};
  if (sent("parentName") && body.parentName !== undefined) data.parentName = body.parentName.trim();
  // The column is NOT NULL: a blank child name is stored as "".
  if (sent("childName")) data.childName = body.childName?.trim() ?? "";
  for (const key of NULLABLE_FIELDS) {
    if (sent(key)) data[key] = body[key]?.trim() || null;
  }

  // The row that would exist after this write must still be reachable. Only
  // checked when the body touches the parent or a contact, so a status change
  // or a note on an older contact-less lead is never blocked.
  if (sent("parentName") || CONTACT_FIELDS.some(sent)) {
    const merged = {
      parentName: "parentName" in data ? data.parentName : existing.parentName,
      parentPhone: "parentPhone" in data ? data.parentPhone : existing.parentPhone,
      parentWhatsapp: "parentWhatsapp" in data ? data.parentWhatsapp : existing.parentWhatsapp,
      parentEmail: "parentEmail" in data ? data.parentEmail : existing.parentEmail,
    };
    if (!merged.parentName?.trim()) {
      return fieldError("parentName", "Nama orang tua wajib diisi");
    }
    if (!hasAdmissionContact(merged)) {
      return fieldError("parentPhone", ADMISSION_CONTACT_REQUIRED);
    }
  }

  if (data.programId && !(await programInTenant(tenantId, data.programId))) {
    return fieldError("programId", PROGRAM_NOT_FOUND);
  }

  const statusChanged = body.status !== undefined && body.status !== existing.status;
  const changedFields = Object.keys(data).filter(
    (k) => data[k] !== (existing as unknown as Record<string, string | null>)[k],
  );

  // Nothing would change (an ignored key, or values equal to the stored ones): no write, no audit.
  if (changedFields.length === 0 && !statusChanged) return NextResponse.json(existing);

  // Update + audit commit together (recordAudit re-throws inside a transaction).
  // The audit row names the fields that changed, never their values (PII).
  let admission = await prisma.$transaction(async (tx) => {
    const updated = await tx.admission.update({
      // tenantId in the unique filter: a write can never land on another school's row.
      where: { id, tenantId },
      data: { ...data, ...(body.status ? { status: body.status } : {}) },
    });
    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "Admission",
        entityId: id,
        action: "update",
        ...(statusChanged ? { before: { status: existing.status } } : {}),
        after: { changedFields, ...(statusChanged ? { status: body.status } : {}) },
      },
      tx,
    );
    return updated;
  });

  // Re-run sibling detection when a contact changed (same swallow-on-failure
  // rule as create: the update is already committed). A stale match from the
  // old contact is dropped; a failure leaves the stored match as it was.
  if (CONTACT_FIELDS.some((k) => k in data && data[k] !== existing[k])) {
    try {
      const match = await detectSibling(
        {
          tenantId,
          parentEmail: admission.parentEmail,
          parentPhone: admission.parentPhone,
          parentWhatsapp: admission.parentWhatsapp,
        },
        prisma,
      );
      const detectedParentId = match?.parentId ?? null;
      if (detectedParentId !== admission.detectedParentId) {
        admission = await prisma.admission.update({ where: { id, tenantId }, data: { detectedParentId } });
      }
    } catch (err) {
      console.error(`[admin-admissions PUT] sibling-detect failed for admission ${id}:`, err);
    }
  }
  return NextResponse.json(admission);
}
