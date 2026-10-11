// @public — tokenized Kelengkapan Berkas upload/removal for the enrollment form.
// NO session; the unguessable accessToken gates access. See proxy.ts allow-list.
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess } from "@/lib/enrollment/resolve-token";
import { denyTokenAccess } from "@/lib/enrollment/access-response";
import { mergeJsonKey, removeJsonFields } from "@/lib/enrollment/json-merge";
import {
  MAX_DOCUMENT_BYTES,
  isDocumentKey,
  sanitizeDocumentFileName,
  sanitizeDocumentLabel,
  type DocumentKey,
} from "@/lib/enrollment/documents";
import { saveFile } from "@/lib/storage";
import { deleteQuietly, discardIfUnreferenced, randomSegment } from "@/lib/enrollment/stored-files";
import { detectMime } from "@/lib/storage/mime";

const RATE_LIMIT_PER_MIN = 30;
const RATE_WINDOW_MS = 60_000;
// Multipart framing (boundary, part headers, the optional label field) rides on
// top of the file bytes; the exact cap is enforced on file.size below.
const MULTIPART_SLACK_BYTES = 64 * 1024;

type Gate = { id: string; key: DocumentKey } | { error: NextResponse };

/** Shared by POST and DELETE: rate limit, token access, key whitelist. */
async function gate(
  req: NextRequest,
  params: Promise<{ token: string }>,
): Promise<Gate> {
  const limit = rateLimit(`enroll-doc:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return { error: NextResponse.json({ error: "rate_limited" }, { status: 429 }) };
  }

  const { token } = await params;
  const { access, id } = await resolveEnrollmentAccess(token, new Date());
  const denied = denyTokenAccess(access);
  if (denied) return { error: denied };
  if (!id) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  const key = req.nextUrl.searchParams.get("key");
  if (!isDocumentKey(key)) {
    return { error: NextResponse.json({ error: "Jenis berkas tidak dikenal" }, { status: 400 }) };
  }
  return { id, key };
}

function fileTokenOf(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const t = (entry as Record<string, unknown>).fileToken;
  return typeof t === "string" && t ? t : null;
}

async function readDocuments(id: string): Promise<Record<string, unknown>> {
  const row = await prisma.enrollmentApplication.findUnique({ where: { id }, select: { documents: true } });
  const docs = row?.documents;
  return docs && typeof docs === "object" && !Array.isArray(docs) ? (docs as Record<string, unknown>) : {};
}

/** The stored token for `key`, read BEFORE a write so the old object can be cleaned up after it. */
async function previousFileToken(id: string, key: DocumentKey): Promise<string | null> {
  return fileTokenOf((await readDocuments(id))[key]);
}

/**
 * POST /api/enrollments/token/[token]/documents?key=<DocumentKey>
 *
 * Multipart `file` (JPEG/PNG/PDF by magic bytes, <= 4 MB) and, for `lainnya`
 * only, an optional `label`. The storage token is merged onto the row in one
 * atomic jsonb write (INVITED rows only) — the draft autosave and submit never
 * touch `documents`, so they cannot clobber it. The response carries the file
 * name and metadata only; the storage token never reaches the browser.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const g = await gate(req, params);
  if ("error" in g) return g.error;
  const { id, key } = g;

  const tooLarge = () =>
    NextResponse.json({ error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_DOCUMENT_BYTES }, { status: 413 });

  // Cheap precheck before buffering. A *missing* header is allowed — an HTTP/2
  // hop may legitimately drop it, and rejecting would break every upload on
  // that path; the exact cap on file.size below (and the platform's request
  // limit) still holds. A present-but-malformed header is rejected.
  const rawLen = req.headers.get("content-length");
  if (rawLen !== null) {
    const declaredLen = Number(rawLen);
    if (!Number.isFinite(declaredLen) || declaredLen < 0) {
      return NextResponse.json({ error: "LENGTH_REQUIRED" }, { status: 411 });
    }
    if (declaredLen > MAX_DOCUMENT_BYTES + MULTIPART_SLACK_BYTES) return tooLarge();
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
  if (file.size > MAX_DOCUMENT_BYTES) return tooLarge();

  const bytes = Buffer.from(await file.arrayBuffer());
  // Never trust file.type — the magic bytes decide (PDF allowed here).
  const mime = detectMime(bytes, file.type);
  if (!mime.ok) {
    return NextResponse.json({ error: "UNSUPPORTED_MEDIA_TYPE", detail: mime.error }, { status: 415 });
  }

  const label = key === "lainnya" ? sanitizeDocumentLabel(form.get("label")) : null;
  const fileName = sanitizeDocumentFileName(file.name, key, mime.ext);
  const uploadedAt = new Date().toISOString();

  const previousToken = await previousFileToken(id, key);

  const { token: fileToken } = await saveFile({
    entity: "enrollment",
    entityId: id,
    // Unique per upload: a deleted token can never be re-referenced (see stored-files.ts).
    field: `doc-${key}-${randomSegment()}`,
    file: { bytes, mimeType: mime.mimeType, ext: mime.ext },
  });

  const merged = await mergeJsonKey(
    id,
    "documents",
    key,
    { fileToken, fileName, mimeType: mime.mimeType, size: bytes.length, uploadedAt, ...(label ? { label } : {}) },
    { requireInvited: true },
  );
  if (!merged) {
    // Submitted between the access check and the write; row untouched. The
    // object we just stored has a unique path and no reference — drop it.
    await deleteQuietly(fileToken);
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }

  if (previousToken && previousToken !== fileToken) {
    await discardIfUnreferenced(id, "documents", previousToken);
  }

  return NextResponse.json({
    key,
    fileName,
    mimeType: mime.mimeType,
    size: bytes.length,
    uploadedAt,
    ...(label ? { label } : {}),
  });
}

/**
 * DELETE /api/enrollments/token/[token]/documents?key=<DocumentKey>
 *
 * Clears the file fields for `key` (an admin's physical-receipt tick, if any,
 * is not the parent's to remove and is left alone) and best-effort deletes the
 * stored object.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const g = await gate(req, params);
  if ("error" in g) return g.error;
  const { id, key } = g;

  const previousToken = await previousFileToken(id, key);

  const removed = await removeJsonFields(
    id,
    "documents",
    key,
    ["fileToken", "fileName", "mimeType", "size", "uploadedAt", "label"],
    { requireInvited: true },
  );
  if (!removed) return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });

  await discardIfUnreferenced(id, "documents", previousToken);
  return NextResponse.json({ ok: true });
}
