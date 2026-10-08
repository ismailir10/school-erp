/**
 * Copy the identity documents a parent uploaded on the pendaftaran form into
 * the guardian's own record, right after `convert` creates or reuses the
 * Ayah/Ibu `Parent` rows.
 *
 *   ktp_ayah → Ayah Parent.ktpUrl
 *   ktp_ibu  → Ibu  Parent.ktpUrl
 *   kk       → Ayah Parent.kkUrl (Ibu's when the family has no Ayah), since the
 *              student page resolves KK through the primary guardian
 *
 * The guardian gets an independent object under `parents/<id>/<field>-…`, so a
 * later delete on either side cannot break the other. Best-effort and run AFTER
 * the convert transaction commits: it never throws, and a column that already
 * holds a document is never overwritten (the write is a conditional
 * `updateMany … where col is null`). Server-only (Prisma + storage).
 */

import { prisma } from "@/lib/db";
import { saveFile, streamFile, deleteFile } from "@/lib/storage";
import { detectMime } from "@/lib/storage/mime";
import type { DocumentKey } from "./documents";

export type CopyOutcome = "copied" | "skipped_existing" | "missing" | "failed";

export type DocumentsCopied = { ktpAyah: CopyOutcome; ktpIbu: CopyOutcome; kk: CopyOutcome };

type Column = "ktpUrl" | "kkUrl";

/** Same entity / field segments `lib/storage/parent-document.ts` writes. */
const PARENT_ENTITY = "parents";
const FIELD_FOR: Record<Column, "ktp" | "kk"> = { ktpUrl: "ktp", kkUrl: "kk" };

function fileTokenOf(documents: unknown, key: DocumentKey): string | null {
  if (!documents || typeof documents !== "object" || Array.isArray(documents)) return null;
  const entry = (documents as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const token = (entry as Record<string, unknown>).fileToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Best-effort removal of an object this run saved but could not (or did not)
 * attach. Object paths are content-addressed, so the column may legitimately
 * reference the very same token (a concurrent writer with identical bytes):
 * delete only when a fresh read shows the column holds something else. If the
 * read itself fails we cannot tell, and keep the object — an orphan is better
 * than a guardian pointing at a deleted file. Never throws.
 */
async function discardIfUnreferenced(parentId: string, tenantId: string, column: Column, token: string) {
  try {
    const now = (await prisma.parent.findFirst({
      where: { id: parentId, tenantId },
      select: { [column]: true } as never,
    })) as Record<Column, string | null> | null;
    if (now?.[column] !== token) await deleteFile(token);
  } catch {
    // cleanup is best-effort
  }
}

async function copyOne(args: {
  tenantId: string;
  parentId: string | null;
  sourceToken: string | null;
  column: Column;
}): Promise<CopyOutcome> {
  const { tenantId, parentId, sourceToken, column } = args;
  if (!sourceToken || !parentId) return "missing";

  let newToken: string | null = null;
  try {
    const current = (await prisma.parent.findFirst({
      where: { id: parentId, tenantId },
      select: { [column]: true } as never,
    })) as Record<Column, string | null> | null;
    if (!current) return "failed";
    if (current[column]) return "skipped_existing";

    const { stream, mimeType } = await streamFile(sourceToken);
    const bytes = Buffer.from(await new Response(stream as unknown as BodyInit).arrayBuffer());
    const mime = detectMime(bytes, mimeType);
    if (!mime.ok) return "failed";

    const saved = await saveFile({
      entity: PARENT_ENTITY,
      entityId: parentId,
      field: FIELD_FOR[column],
      file: { bytes, mimeType: mime.mimeType, ext: mime.ext },
    });
    newToken = saved.token;

    const result = await prisma.parent.updateMany({
      where: { id: parentId, tenantId, [column]: null },
      data: { [column]: newToken },
    });
    if (result.count === 0) {
      // Filled in between our read and write: drop our copy unless it is the
      // object the winner references.
      await discardIfUnreferenced(parentId, tenantId, column, newToken);
      return "skipped_existing";
    }
    return "copied";
  } catch (e) {
    // No tokens, ids or file names in the log line — just the failure class.
    console.error("[guardian-copy] copy failed", { column, error: e instanceof Error ? e.name : "unknown" });
    // Saved but the DB write failed: don't leave a sensitive orphan behind.
    if (newToken) await discardIfUnreferenced(parentId, tenantId, column, newToken);
    return "failed";
  }
}

export async function copyEnrollmentDocsToGuardians(args: {
  tenantId: string;
  applicationDocuments: unknown;
  ayahId: string | null;
  ibuId: string | null;
}): Promise<DocumentsCopied> {
  const { tenantId, applicationDocuments: docs, ayahId, ibuId } = args;
  const kkParent = ayahId ?? ibuId;
  // Sequential: same-bytes copies share a content-addressed path, and the
  // conditional write must see the previous outcome. copyOne never throws.
  const ktpAyah = await copyOne({ tenantId, parentId: ayahId, sourceToken: fileTokenOf(docs, "ktp_ayah"), column: "ktpUrl" });
  const ktpIbu = await copyOne({ tenantId, parentId: ibuId, sourceToken: fileTokenOf(docs, "ktp_ibu"), column: "ktpUrl" });
  const kk = await copyOne({ tenantId, parentId: kkParent, sourceToken: fileTokenOf(docs, "kk"), column: "kkUrl" });
  return { ktpAyah, ktpIbu, kk };
}
