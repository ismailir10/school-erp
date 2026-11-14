// @public — tokenized enrollment draft-save. NO session; the unguessable
// accessToken is the credential. See proxy.ts public allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mergeDraft } from "@/lib/enrollment/draft-merge";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess, programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { programIdSchema } from "@/lib/validations/program-id";
import { denyTokenAccess } from "@/lib/enrollment/access-response";

const RATE_LIMIT_PER_MIN = 30; // generous — autosave can fire often
const RATE_WINDOW_MS = 60_000;

// Draft save is intentionally loose — the parent may save a half-filled form.
// Blobs allow incomplete fields (validated at final submit). A client baseline
// lets the locked write merge only edited leaves and refuse stale conflicts.
// Not accepted here, by design: `documents` (owned by the documents routes) —
// zod strips unknown keys, so a client-sent `documents` never reaches the row.
const draftSchema = z.object({
  baseData: z.record(z.string(), z.unknown()).optional(),
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
  // The staff-recorded marker is evidence staff write ("Tandai formulir masuk");
  // a token holder must not be able to pre-seed it.
  for (const key of ["staffRecorded", "note", "by", "at"]) delete out[key];
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
  const denied = denyTokenAccess(access);
  if (denied) return denied;
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
  if (Object.keys(d).every((key) => key === "baseData")) return NextResponse.json({ ok: true });

  {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "EnrollmentApplication" WHERE id = ${id} FOR UPDATE`;
        const stored = await tx.enrollmentApplication.findUnique({ where: { id }, include: { admission: { select: { status: true } } } });
        if (!stored || stored.status !== "INVITED" || stored.admission?.status === "CANCELLED") throw new Error("DRAFT_CLOSED");
        const incoming: Record<string, unknown> = { ...d };
        delete incoming.baseData;
        // The wire uses an empty option while persistence uses null. Normalize
        // both snapshots before comparison so a lost-response clear is retryable.
        const baseData = { programId: null, dcareAddon: false, ...(d.baseData ?? {}) } as Record<string, unknown>;
        if (incoming.programId === "") incoming.programId = null;
        if (baseData.programId === "") baseData.programId = null;
        // Tokens belong to the upload route; they are never draft edits.
        if (incoming.consentData) incoming.consentData = normalizeConsentDraft(d.consentData!);
        if (d.programId && !(await programBelongsToTenant(d.programId, tenantId))) delete incoming.programId;
        const merged = mergeDraft(baseData, incoming, stored) as Record<string, unknown>;
        const data: Record<string, unknown> = {};
        for (const key of Object.keys(incoming)) data[key] = merged[key];
        if (data.programId === "") data.programId = null;
        const child = data.studentData as { childName?: string } | undefined;
        if (child?.childName?.trim()) data.childName = child.childName.trim().slice(0, 80);
        if (Object.keys(data).length > 0) await tx.enrollmentApplication.update({ where: { id }, data });
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && ["DRAFT_CONFLICT", "DRAFT_CLOSED"].includes(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

}
