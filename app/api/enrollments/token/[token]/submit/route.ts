// @public — tokenized enrollment final submit. NO session; the unguessable
// accessToken is the credential. See proxy.ts public allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess, programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { submitEnrollmentSchema, flattenSubmitErrors } from "@/lib/enrollment/submit-validation";

const RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60_000;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = rateLimit(`enroll-submit:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const now = new Date();
  const { access, id, tenantId } = await resolveEnrollmentAccess(token, now);
  if (access === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (access === "EXPIRED") return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  if (access === "SUBMITTED")
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  if (!id || !tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_failed", fields: { _root: "Body bukan JSON yang valid" } },
      { status: 400 },
    );
  }

  // Signatures live on the row (the signature route persists them the moment
  // they are drawn), so the parent who submits may never have seen the other
  // parent's pad. Overlay the stored tokens onto the body BEFORE validation and
  // ignore whatever the client sent — a missing token then fails the schema's
  // "Tanda tangan … wajib disimpan" check.
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const stored = await prisma.enrollmentApplication.findUnique({
      where: { id },
      select: { consentData: true },
    });
    const storedConsent = asObject(stored?.consentData);
    const b = body as Record<string, unknown>;
    const consent = { ...asObject(b.consentData) };
    for (const side of ["ayah", "ibu"] as const) {
      const token = asObject(storedConsent[side]).signatureToken;
      consent[side] = {
        ...asObject(consent[side]),
        signatureToken: typeof token === "string" ? token : "",
      };
    }
    b.consentData = consent;
  }

  const parsed = submitEnrollmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", fields: flattenSubmitErrors(parsed.error) },
      { status: 422 },
    );
  }
  const data = parsed.data;

  // Guard the chosen program against the application's tenant (IDOR write).
  if (!(await programBelongsToTenant(data.programId, tenantId))) {
    return NextResponse.json(
      { error: "validation_failed", fields: { programId: "Program tidak valid" } },
      { status: 422 },
    );
  }

  const nowIso = now.toISOString();

  // Server-stamp the signing time — client-supplied signedAt is not trusted.
  const consentData = {
    ...data.consentData,
    ayah: { ...data.consentData.ayah, signedAt: nowIso },
    ibu: { ...data.consentData.ibu, signedAt: nowIso },
  };

  // Guard the INVITED→SUBMITTED transition at the DB layer too: updateMany with
  // a status predicate makes a double-submit race a no-op (count 0) rather than
  // overwriting an already-submitted row.
  const result = await prisma.enrollmentApplication.updateMany({
    where: { id, status: "INVITED" },
    data: {
      status: "SUBMITTED",
      submittedAt: now,
      childName: data.studentData.childName,
      programId: data.programId,
      dcareAddon: data.dcareAddon,
      studentData: data.studentData,
      ayahData: data.ayahData,
      ibuData: data.ibuData,
      consentData,
    },
  });
  if (result.count === 0) {
    // Lost the race — someone already submitted between resolve and update.
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
