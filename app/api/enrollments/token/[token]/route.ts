// @public — tokenized enrollment draft-save. NO session; the unguessable
// accessToken is the credential. See proxy.ts public allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess, programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { writeConsentPreservingSignatures } from "@/lib/enrollment/json-merge";
import { programIdSchema } from "@/lib/validations/program-id";

const RATE_LIMIT_PER_MIN = 30; // generous — autosave can fire often
const RATE_WINDOW_MS = 60_000;

// Draft save is intentionally loose — the parent may save a half-filled form.
// Blobs are stored as-is (validated only at final submit). passthrough() keeps
// nested keys; the whole blob is replaced per save (client sends current state).
// Not accepted here, by design: `documents` (owned by the documents routes) —
// zod strips unknown keys, so a client-sent `documents` never reaches the row.
const draftSchema = z.object({
  studentData: z.object({}).passthrough().optional(),
  ayahData: z.object({}).passthrough().optional(),
  ibuData: z.object({}).passthrough().optional(),
  consentData: z.object({}).passthrough().optional(),
  programId: z.union([programIdSchema, z.literal(""), z.null()]).optional(),
  dcareAddon: z.boolean().optional(),
});

/**
 * Draft consent blob → what we are willing to write. Signatures are owned by
 * the signature route, so any client-sent `signatureToken`/`signedAt` is
 * dropped; `ayah`/`ibu` are forced to objects so the SQL carry-over of the
 * stored tokens has somewhere to land.
 */
function normalizeConsentDraft(consent: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...consent };
  for (const side of ["ayah", "ibu"] as const) {
    const v = out[side];
    const block: Record<string, unknown> =
      v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
    delete block.signatureToken;
    delete block.signedAt;
    out[side] = block;
  }
  return out;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = rateLimit(`enroll-draft:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const { access, id, tenantId } = await resolveEnrollmentAccess(token, new Date());
  if (access === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (access === "EXPIRED") return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  if (access === "SUBMITTED")
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  if (!id || !tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const d = parsed.data;

  // Only persist keys the client actually sent. childName mirror keeps the
  // admin list column in sync with the in-progress student blob.
  const data: Record<string, unknown> = {};
  if (d.studentData !== undefined) {
    data.studentData = d.studentData;
    const cn = (d.studentData as { childName?: unknown }).childName;
    if (typeof cn === "string" && cn.trim()) data.childName = cn.trim().slice(0, 80);
  }
  if (d.ayahData !== undefined) data.ayahData = d.ayahData;
  if (d.ibuData !== undefined) data.ibuData = d.ibuData;
  // consentData is written separately (below) in one UPDATE that carries the
  // stored signature tokens over, so autosave can never clear a signature.
  if (d.programId !== undefined) {
    // Drop a cross-tenant program ref silently — this is an autosave, not a
    // hard gate; the final submit re-checks and 422s if still invalid.
    if (d.programId && d.programId !== "" && (await programBelongsToTenant(d.programId, tenantId))) {
      data.programId = d.programId;
    } else if (d.programId === "" || d.programId === null) {
      data.programId = null;
    }
  }
  if (d.dcareAddon !== undefined) data.dcareAddon = d.dcareAddon;

  if (d.consentData !== undefined) {
    const written = await writeConsentPreservingSignatures(id, normalizeConsentDraft(d.consentData));
    // Submitted between the access check and the write: leave the row alone.
    if (!written) return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }
  if (Object.keys(data).length > 0) {
    // Same INVITED guard as the consent write: a submit that landed in between
    // must not be overwritten by a late autosave.
    const result = await prisma.enrollmentApplication.updateMany({ where: { id, status: "INVITED" }, data });
    if (result.count === 0) return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
