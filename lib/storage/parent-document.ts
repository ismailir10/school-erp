import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { saveFile, streamFile, deleteFile } from "./index";
import { detectMime } from "./mime";

/**
 * Shared POST/GET/DELETE handlers for Parent document fields (KTP, KK).
 *
 * Why a factory: the two routes do byte-identical work — same auth gate,
 * same MIME validation, same size cap, same response shape. Differences are
 * only the storage `field` segment and the Prisma column name. Factoring
 * here keeps the routes thin and means hardening lands in one place.
 *
 * Hardening notes (apply to both routes):
 *   - Both POST and GET require `isAdminRole` — KTP/KK are sensitive PII
 *     under UU PDP 27/2022. Portal users (TEACHER, GUARDIAN) MUST NOT read
 *     these documents this cycle. Student detail surfaces the KK preview
 *     by linking to this admin endpoint; non-admins get 403.
 *   - Magic-byte validation accepts JPEG / PNG / PDF only (`detectMime`
 *     without `imagesOnly`). A `.exe` renamed to `.pdf` is rejected.
 *   - 5 MB hard cap, enforced pre-buffer via Content-Length and again
 *     after buffering (some clients omit Content-Length on chunked).
 *   - Files are NEVER reachable at a guessable public URL — the storage
 *     adapter writes under `.data/` (outside `public/`) and tokens are
 *     opaque (`local:v1:parents/<id>/<field>-<hash>.<ext>`).
 *   - `Cache-Control: private, no-store` prevents shared-cache retention
 *     of sensitive PII.
 *   - `Content-Disposition: inline; filename*=UTF-8''<encoded>` uses
 *     RFC 5987 encoding to defend against future header-injection if
 *     filename ever broadens to user-supplied content.
 */

const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB hard cap per spec
const PARENT_ENTITY = "parents";

/** Discriminator between the two routes — also the storage `field` segment. */
export type ParentDocField = "ktp" | "kk";

/** Prisma column on Parent for the given doc field. Centralised to keep the
 *  route files free of the field→column mapping. */
function columnFor(field: ParentDocField): "ktpUrl" | "kkUrl" {
  return field === "ktp" ? "ktpUrl" : "kkUrl";
}

/**
 * Load the tenant-scoped Parent row with just the id + the requested doc's
 * current token. The field-to-column dispatch lives here so neither the
 * handlers nor a future caller can drift between "selected from DB" and
 * "read from the returned object" — a mismatch would silently 404 even
 * when the document exists.
 */
async function loadParentToken(
  id: string,
  tenantId: string,
  field: ParentDocField,
): Promise<{ id: string; token: string | null } | null> {
  const col = columnFor(field);
  const parent = (await prisma.parent.findFirst({
    where: { id, tenantId },
    select: { id: true, [col]: true } as never,
  })) as { id: string; ktpUrl?: string | null; kkUrl?: string | null } | null;
  if (!parent) return null;
  return { id: parent.id, token: (parent[col] ?? null) as string | null };
}

export async function postParentDoc(
  req: NextRequest,
  params: Promise<{ id: string }>,
  field: ParentDocField,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role) || !session.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }

  const { id } = await params;
  const parent = await loadParentToken(id, session.tenantId, field);
  if (!parent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Pre-check Content-Length to refuse oversized uploads without buffering.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_DOC_BYTES) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_DOC_BYTES },
      { status: 413 },
    );
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
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_DOC_BYTES },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Magic-byte check — DO NOT trust file.type from the client.
  // imagesOnly omitted: PDF is allowed alongside JPEG/PNG for ID docs.
  const mime = detectMime(bytes, file.type);
  if (!mime.ok) {
    return NextResponse.json(
      { error: "UNSUPPORTED_MEDIA_TYPE", detail: mime.error },
      { status: 415 },
    );
  }

  const { token } = await saveFile({
    entity: PARENT_ENTITY,
    entityId: parent.id,
    field,
    file: { bytes, mimeType: mime.mimeType, ext: mime.ext },
  });

  // Best-effort cleanup of the prior file when the new token differs.
  if (parent.token && parent.token !== token) {
    await deleteFile(parent.token).catch(() => undefined);
  }

  await prisma.parent.update({
    where: { id: parent.id },
    data: { [columnFor(field)]: token },
  });

  return NextResponse.json({ [columnFor(field)]: token });
}

export async function getParentDoc(
  _req: NextRequest,
  params: Promise<{ id: string }>,
  field: ParentDocField,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin-only — KTP/KK are sensitive PII; portal users do not read these.
  if (!isAdminRole(session.role) || !session.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parent = await loadParentToken(id, session.tenantId, field);
  if (!parent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!parent.token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { stream, mimeType, filename } = await streamFile(parent.token);
    const safeFilename = encodeURIComponent(filename);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${safeFilename}`,
      },
    });
  } catch {
    // File missing on disk while DB still references it → 404 to caller.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function deleteParentDoc(
  _req: NextRequest,
  params: Promise<{ id: string }>,
  field: ParentDocField,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role) || !session.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasPermission(session, "students.edit")) {
    return NextResponse.json({ error: "forbidden", missing: "students.edit" }, { status: 403 });
  }

  const { id } = await params;
  const parent = await loadParentToken(id, session.tenantId, field);
  if (!parent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parent.token) {
    await deleteFile(parent.token).catch(() => undefined);
    await prisma.parent.update({
      where: { id: parent.id },
      data: { [columnFor(field)]: null },
    });
  }

  return new Response(null, { status: 204 });
}
