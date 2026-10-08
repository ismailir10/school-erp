// @public — tokenized enrollment final submit. NO session; the unguessable
// accessToken is the credential. See proxy.ts public allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess, programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { submitEnrollmentSchema, flattenSubmitErrors, isSideWaived } from "@/lib/enrollment/submit-validation";
import { DOCUMENT_ITEMS, missingUploads } from "@/lib/enrollment/documents";
import { getRequiredDocuments } from "@/lib/enrollment/required-documents";

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

  // Everything from the signature read to the INVITED→SUBMITTED flip runs in
  // ONE transaction holding a row lock. A signature upload replacing a token
  // mid-submit would otherwise get its OLD token written back; with the lock the
  // concurrent signature UPDATE waits, then fails its INVITED guard (409) — the
  // form is closed, which is correct.
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "EnrollmentApplication" WHERE id = ${id} FOR UPDATE`;
    if (!locked || locked.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // `documents` is read in the same locked read: an upload racing the submit
    // waits on the row lock, so the required-documents check below sees every
    // file that was stored before the form closed.
    const stored = await tx.enrollmentApplication.findUnique({
      where: { id },
      select: { consentData: true, documents: true },
    });
    // Signatures live on the row (the signature route persists them the moment
    // they are drawn), so the parent who submits may never have seen the other
    // parent's pad. Overlay the stored tokens onto the body BEFORE validation and
    // ignore whatever the client sent — a missing token then fails the schema's
    // "Tanda tangan … wajib disimpan" check.
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const storedConsent = asObject(stored?.consentData);
      const b = body as Record<string, unknown>;
      const consent = { ...asObject(b.consentData) };
      const only = consent.onlyParent;
      for (const side of ["ayah", "ibu"] as const) {
        // R2-P-10: a waived parent has no signer block at all (a stored token
        // from before the parent was waived must not resurface either).
        if (isSideWaived(only === "ayah" || only === "ibu" ? only : null, side)) {
          delete consent[side];
          continue;
        }
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

    // Documents the school made mandatory (Pengaturan Pendaftaran). A staff
    // "received physically" tick does not count — only an uploaded file does.
    const required = await getRequiredDocuments(tenantId, tx);
    const missing = missingUploads(stored?.documents, required);
    if (missing.length > 0) {
      const labels = missing.map((k) => DOCUMENT_ITEMS.find((i) => i.key === k)?.label ?? k);
      return NextResponse.json(
        {
          error: "validation_failed",
          fields: { documents: "Berkas wajib belum diunggah: " + labels.join(", ") },
          // Public whitelist keys (DocumentKey) so the form can reset exactly
          // those rows instead of showing a stale "Terunggah".
          missingDocuments: missing,
        },
        { status: 422 },
      );
    }

    // Guard the chosen program against the application's tenant (IDOR write).
    if (!(await programBelongsToTenant(data.programId, tenantId, tx))) {
      return NextResponse.json(
        { error: "validation_failed", fields: { programId: "Program tidak valid" } },
        { status: 422 },
      );
    }

    const nowIso = now.toISOString();

    // Server-stamp the signing time — client-supplied signedAt is not trusted.
    // A waived parent (R2-P-10) gets no signer block and an empty data block, so
    // draft text typed before the waiver is not kept.
    const only = data.consentData.onlyParent;
    const ayahWaived = isSideWaived(only, "ayah");
    const ibuWaived = isSideWaived(only, "ibu");
    const { ayah: ayahSigner, ibu: ibuSigner, ...consentRest } = data.consentData;
    const consentData = {
      ...consentRest,
      ...(!ayahWaived && ayahSigner ? { ayah: { ...ayahSigner, signedAt: nowIso } } : {}),
      ...(!ibuWaived && ibuSigner ? { ibu: { ...ibuSigner, signedAt: nowIso } } : {}),
    };

    // Guard the INVITED→SUBMITTED transition at the DB layer too: updateMany with
    // a status predicate makes a double-submit race a no-op (count 0) rather than
    // overwriting an already-submitted row.
    const result = await tx.enrollmentApplication.updateMany({
      where: { id, status: "INVITED" },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        childName: data.studentData.childName,
        programId: data.programId,
        dcareAddon: data.dcareAddon,
        studentData: data.studentData,
        ayahData: ayahWaived ? {} : data.ayahData,
        ibuData: ibuWaived ? {} : data.ibuData,
        consentData,
      },
    });
    if (result.count === 0) {
      // Lost the race — someone already submitted between resolve and update.
      return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
    }

    return NextResponse.json({ ok: true, id }, { status: 201 });
  });
}
