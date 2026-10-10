import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { saveFile, streamFile, deleteFile } from "@/lib/storage";
import { detectMime } from "@/lib/storage/mime";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Student photo upload + auth-proxied read.
 *
 * Why a dedicated route (not direct static serving):
 *   Photos are stored under `.data/` (outside `public/`). Reads MUST flow
 *   through an auth-checked API so the same storage adapter can also serve
 *   sensitive PII (T14 KTP/KK). See lib/storage/index.ts for adapter notes.
 *
 * Surface:
 *   POST   — multipart upload (admin only, ≤ 2 MB, JPEG/PNG with magic-byte check)
 *   GET    — stream (admin OR a guardian linked to the student via active StudentGuardian).
 *            Revalidated with an ETag derived from the stored object path
 *            (itself content-addressed), `private, no-cache`: the browser keeps
 *            the bytes but asks every time, so the auth check below always
 *            runs, and an unchanged photo answers 304 without downloading it
 *            from Supabase Storage again (egress: the admin student list
 *            shows ~20 of these per page view).
 *   DELETE — remove (admin only)
 */

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB hard cap, enforced server-side
const STUDENT_ENTITY = "students";
const PHOTO_FIELD = "photo";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success } = rateLimit(`student-photo:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

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
  const student = await prisma.student.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, photoUrl: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cheap pre-check on Content-Length so we can refuse oversized uploads
  // before buffering the body. Some clients omit Content-Length on
  // chunked uploads — we re-check after buffering.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (declaredLen > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_PHOTO_BYTES },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body multipart tidak valid." },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Field 'file' wajib diisi." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File kosong." }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "PAYLOAD_TOO_LARGE", maxBytes: MAX_PHOTO_BYTES },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Magic-byte check — DO NOT trust file.type from the client.
  // imagesOnly: T14 broadens detectMime to include PDF for KTP/KK; photos
  // here must still reject PDF (an avatar PDF isn't useful and bypasses
  // the image-only client-side accept attribute).
  const mime = detectMime(bytes, file.type, { imagesOnly: true });
  if (!mime.ok) {
    return NextResponse.json(
      { error: "UNSUPPORTED_MEDIA_TYPE", detail: mime.error },
      { status: 415 },
    );
  }

  const { token } = await saveFile({
    entity: STUDENT_ENTITY,
    entityId: student.id,
    field: PHOTO_FIELD,
    file: { bytes, mimeType: mime.mimeType, ext: mime.ext },
  });

  // Point the row at the new object first, then best-effort delete the old
  // one (content-addressed: same bytes → same token → nothing to delete).
  // In this order a failed update never leaves the row naming a deleted
  // object, which GET's ETag/304 would otherwise keep "revalidating" as the
  // stale photo; the worst case is an orphaned object in the bucket.
  await prisma.student.update({
    where: { id: student.id },
    data: { photoUrl: token },
  });

  if (student.photoUrl && student.photoUrl !== token) {
    await deleteFile(student.photoUrl).catch(() => undefined);
  }

  return NextResponse.json({ photoUrl: token });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const student = await prisma.student.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, photoUrl: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Authorisation: admin OR an active guardian of this student.
  // We resolve the guardian's Parent row via User.parentId so a guardian
  // cannot view siblings they are not linked to.
  if (!isAdminRole(session.role)) {
    if (session.role !== "GUARDIAN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { parentId: true },
    });
    if (!user?.parentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const link = await prisma.studentGuardian.findFirst({
      where: { studentId: student.id, parentId: user.parentId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!link) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!student.photoUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A new upload writes a new content-hashed path, so the ETag changes with
  // the photo. Checked only after authorisation above.
  const etag = `"${createHash("sha256").update(student.photoUrl).digest("base64url").slice(0, 27)}"`;
  const cacheHeaders = { ETag: etag, "Cache-Control": "private, no-cache" };
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag)) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  try {
    const { stream, mimeType, filename } = await streamFile(student.photoUrl);
    // RFC 5987 filename* — defends against header injection if filename
    // ever broadens to user-supplied content (e.g. T14 KTP download with
    // original filename). Today filename is regex-restricted to safe chars,
    // but defensive now means T14 inherits a hardened pattern.
    const safeFilename = encodeURIComponent(filename);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        ...cacheHeaders,
        "Content-Disposition": `inline; filename*=UTF-8''${safeFilename}`,
      },
    });
  } catch {
    // File missing from disk while DB still references it → 404.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success } = rateLimit(`student-photo:${getClientIp(req)}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

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
  const student = await prisma.student.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, photoUrl: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Clear the row before deleting the object (see POST): a failed update
  // must not leave a token that points at a deleted object.
  if (student.photoUrl) {
    await prisma.student.update({
      where: { id: student.id },
      data: { photoUrl: null },
    });
    await deleteFile(student.photoUrl).catch(() => undefined);
  }

  return new Response(null, { status: 204 });
}
