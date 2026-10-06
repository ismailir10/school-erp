import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isDocumentKey } from "@/lib/enrollment/documents";
import { streamFile } from "@/lib/storage";

/** ASCII-only, quote/backslash-free header filename (the real name stays in the UI). */
function headerFileName(name: unknown, fallback: string): string {
  const cleaned = typeof name === "string" ? name.replace(/[^\x20-\x7e]|["\\%;]/g, "_").trim() : "";
  return cleaned.replace(/^[._\s]+$/, "") || fallback;
}

/**
 * GET /api/enrollments/[id]/documents/[key] — admin-only stream of an uploaded
 * Kelengkapan Berkas file. Mirrors the sibling signature route: admin-gated
 * (`admissions.view`), tenant-scoped, no-store, inline. 404 when the key is
 * unknown, nothing was uploaded for it, or the underlying object is gone.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, key } = await params;
  if (!isDocumentKey(key)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const app = await prisma.enrollmentApplication.findUnique({
    where: { id },
    select: { tenantId: true, documents: true },
  });
  if (!app || app.tenantId !== session.tenantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const docs = (app.documents ?? {}) as Record<string, { fileToken?: unknown; fileName?: unknown } | null>;
  const entry = docs[key];
  const token = entry?.fileToken;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { stream, mimeType, filename } = await streamFile(token);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${headerFileName(entry?.fileName, filename)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
