// @public — tokenized signature upload for the enrollment consent step. NO
// session; the unguessable accessToken gates access. See proxy.ts allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess } from "@/lib/enrollment/resolve-token";
import { prisma } from "@/lib/db";
import { mergeJsonKey } from "@/lib/enrollment/json-merge";
import { saveFile } from "@/lib/storage";
import { deleteQuietly, discardIfUnreferenced, randomSegment } from "@/lib/enrollment/stored-files";
import { detectMime } from "@/lib/storage/mime";

const RATE_LIMIT_PER_MIN = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_SIGNATURE_BYTES = 1 * 1024 * 1024; // 1 MB — a drawn PNG is a few KB

/**
 * GET /api/enrollments/token/[token]/signature
 *
 * Which parents' signatures are saved on the row: `{ ayah, ibu }` booleans, plus
 * the saved signer names (`ayahName`, `ibuName`, "" when absent) so a second
 * device can fill its empty name fields. Lets the second parent (or the first,
 * re-checking) see the other's signature without a reload. Never returns
 * storage tokens.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = rateLimit(`enroll-sig-status:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const { access, id } = await resolveEnrollmentAccess(token, new Date());
  if (access === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (access === "EXPIRED") return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  if (access === "SUBMITTED")
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: { consentData: true },
  });
  const consent = (row?.consentData ?? {}) as Record<string, { signatureToken?: unknown; name?: unknown } | null>;
  const saved = (which: "ayah" | "ibu") => {
    const t = consent[which]?.signatureToken;
    return typeof t === "string" && t.length > 0;
  };
  const nameOf = (which: "ayah" | "ibu") => {
    const n = consent[which]?.name;
    return typeof n === "string" ? n : "";
  };
  return NextResponse.json({
    ayah: saved("ayah"),
    ibu: saved("ibu"),
    ayahName: nameOf("ayah"),
    ibuName: nameOf("ibu"),
  });
}

/**
 * POST /api/enrollments/token/[token]/signature?which=ayah|ibu
 *
 * Accepts a drawn-signature image (PNG/JPEG, magic-byte validated), stores it
 * under the application id and persists its opaque storage token into
 * consentData.<which>.signatureToken in the same request (one atomic jsonb
 * merge, INVITED rows only). Persisting here — not at submit — is what lets two
 * parents sign from two different places: each signature lands on the row the
 * moment it is drawn, and the draft autosave can never clear it. The token
 * never goes back to the browser; the response is just `{ saved: true }`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = rateLimit(`enroll-sig:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { token } = await params;
  const { access, id } = await resolveEnrollmentAccess(token, new Date());
  if (access === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (access === "EXPIRED") return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  if (access === "SUBMITTED")
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const which = req.nextUrl.searchParams.get("which");
  if (which !== "ayah" && which !== "ibu") {
    return NextResponse.json({ error: "Parameter 'which' harus ayah atau ibu" }, { status: 400 });
  }

  // Cheap precheck before buffering. A *missing* header is allowed (an HTTP/2
  // hop may drop it; rejecting would break signing on that path) — the exact
  // file.size cap below still holds. A present-but-malformed header is rejected.
  const rawLen = req.headers.get("content-length");
  if (rawLen !== null) {
    const declaredLen = Number(rawLen);
    if (!Number.isFinite(declaredLen) || declaredLen < 0) {
      return NextResponse.json({ error: "LENGTH_REQUIRED" }, { status: 411 });
    }
    if (declaredLen > MAX_SIGNATURE_BYTES) {
      return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_SIGNATURE_BYTES }, { status: 413 });
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Body multipart tidak valid." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Field 'file' wajib diisi." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File kosong." }, { status: 400 });
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_SIGNATURE_BYTES }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // imagesOnly — a signature is never a PDF; don't trust file.type.
  const mime = detectMime(bytes, file.type, { imagesOnly: true });
  if (!mime.ok) {
    return NextResponse.json({ error: "UNSUPPORTED_MEDIA_TYPE", detail: mime.error }, { status: 415 });
  }

  // Read BEFORE the write so a replaced signature's object can be cleaned up after it.
  const before = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: { consentData: true },
  });
  const prevBlock = (before?.consentData as Record<string, { signatureToken?: unknown } | null> | null)?.[which];
  const prevRaw = prevBlock && typeof prevBlock === "object" ? prevBlock.signatureToken : null;
  const previousToken = typeof prevRaw === "string" && prevRaw ? prevRaw : null;

  const { token: signatureToken } = await saveFile({
    entity: "enrollment",
    entityId: id,
    // Unique per upload: a deleted token can never be re-referenced (see stored-files.ts).
    field: `${which}-signature-${randomSegment()}`,
    file: { bytes, mimeType: mime.mimeType, ext: mime.ext },
  });

  const merged = await mergeJsonKey(id, "consentData", which, { signatureToken }, { requireInvited: true });
  if (!merged) {
    // Submitted between the access check and the write — the row must stay
    // untouched, and the image we just stored (unique path) is unreferenced.
    await deleteQuietly(signatureToken);
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }

  if (previousToken && previousToken !== signatureToken) {
    await discardIfUnreferenced(id, "consentData", previousToken);
  }

  return NextResponse.json({ saved: true });
}
