import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { programIdSchema } from "@/lib/validations/program-id";
import { redactConsentSignatures } from "@/lib/enrollment/sanitize-consent";
import { isDocumentKey, toAdminDocuments } from "@/lib/enrollment/documents";
import { mergeJsonKey } from "@/lib/enrollment/json-merge";

// Admin status workflow. INVITED is owned by the parent (pre-submit) and is
// never an admin target. A converted application (studentId set) is frozen.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ["UNDER_REVIEW", "ACCEPTED", "REJECTED"],
  UNDER_REVIEW: ["ACCEPTED", "REJECTED", "SUBMITTED"],
  ACCEPTED: ["UNDER_REVIEW", "REJECTED"],
  REJECTED: ["UNDER_REVIEW"],
};

const patchSchema = z
  .object({
    status: z.enum(["UNDER_REVIEW", "ACCEPTED", "REJECTED", "SUBMITTED"]).optional(),
    studentData: z.object({}).passthrough().optional(),
    ayahData: z.object({}).passthrough().optional(),
    ibuData: z.object({}).passthrough().optional(),
    consentData: z.object({}).passthrough().optional(),
    programId: z.union([programIdSchema, z.literal(""), z.null()]).optional(),
    dcareAddon: z.boolean().optional(),
    // Kelengkapan Berkas: staff ticks "diterima (fisik)". Merged key-by-key in
    // SQL (never a blob replace) and the ONLY field allowed after conversion.
    documentsReceived: z
      .record(z.string(), z.boolean())
      .refine((o) => Object.keys(o).every(isDocumentKey), "Jenis berkas tidak dikenal")
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Tidak ada perubahan");

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Admin-edited consent blob: signatures are evidence, not form fields, so an
 * edit can never set or clear them. Client-sent `signatureToken`/`signedAt` are
 * dropped from ayah/ibu and the STORED values are carried over from the row.
 * (Read-modify-write is fine here: once submitted, the token routes no longer
 * write this row, so there is no concurrent writer.)
 */
function mergeConsentKeepingSignatures(incoming: Record<string, unknown>, stored: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  const storedConsent = asObject(stored);
  for (const side of ["ayah", "ibu"] as const) {
    const block = { ...asObject(out[side]) };
    delete block.signatureToken;
    delete block.signedAt;
    const prev = asObject(storedConsent[side]);
    if (prev.signatureToken !== undefined) block.signatureToken = prev.signatureToken;
    if (prev.signedAt !== undefined) block.signedAt = prev.signedAt;
    out[side] = block;
  }
  return out;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
      admission: { select: { id: true, parentName: true, parentPhone: true, parentRelationship: true } },
    },
  });
  if (!app || app.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tenantId, ...rest } = app;
  return NextResponse.json({
    ...rest,
    canEdit: hasPermission(session, "admissions.edit"),
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
  const { id } = await params;

  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: { id: true, tenantId: true, status: true, studentId: true, consentData: true },
  });
  if (!app || app.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    console.error("[enrollments PATCH] validation failed", JSON.stringify(parsed.error.issues));
    return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });
  }
  const body = parsed.data;

  // A converted application is frozen — except the physical-receipt checklist,
  // which staff keep ticking as paper documents arrive after conversion.
  if (app.studentId && Object.keys(body).some((k) => k !== "documentsReceived")) {
    return NextResponse.json(
      { error: "Pendaftaran ini sudah dikonversi menjadi siswa dan tidak bisa diubah." },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) {
    const allowed = ALLOWED_TRANSITIONS[app.status] ?? [];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: `Transisi status ${app.status} → ${body.status} tidak diizinkan` },
        { status: 400 },
      );
    }
    data.status = body.status;
  }
  if (body.studentData !== undefined) {
    data.studentData = body.studentData;
    const cn = (body.studentData as { childName?: unknown }).childName;
    if (typeof cn === "string" && cn.trim()) data.childName = cn.trim().slice(0, 80);
  }
  if (body.ayahData !== undefined) data.ayahData = body.ayahData;
  if (body.ibuData !== undefined) data.ibuData = body.ibuData;
  if (body.consentData !== undefined) {
    data.consentData = mergeConsentKeepingSignatures(body.consentData, app.consentData);
  }
  if (body.programId !== undefined) {
    if (body.programId && body.programId !== "") {
      // Guard against a cross-tenant program reference (IDOR write).
      if (!(await programBelongsToTenant(body.programId, session.tenantId))) {
        return NextResponse.json({ error: "Program tidak ditemukan" }, { status: 400 });
      }
      data.programId = body.programId;
    } else {
      data.programId = null;
    }
  }
  if (body.dcareAddon !== undefined) data.dcareAddon = body.dcareAddon;

  if (body.documentsReceived !== undefined) {
    const nowIso = new Date().toISOString();
    for (const [key, received] of Object.entries(body.documentsReceived)) {
      const ok = await mergeJsonKey(
        id,
        "documents",
        key,
        { receivedPhysical: received, receivedAt: received ? nowIso : null },
        { requireInvited: false },
      );
      if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ id: app.id, status: app.status });
  }
  const updated = await prisma.enrollmentApplication.update({
    where: { id },
    data,
    select: { id: true, status: true },
  });
  return NextResponse.json(updated);
}
