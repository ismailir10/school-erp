/**
 * Entity-generic Supabase-backed storage adapter.
 *
 * Backs T3 (Student photo) and T14 (Parent KTP / KK) routes. The adapter
 * presents a stable interface — `saveFile`, `streamFile`, `deleteFile` —
 * so callers (`app/api/students/[id]/photo/route.ts` and
 * `lib/storage/parent-document.ts`) are oblivious to the backend.
 *
 * Backend (current): Supabase Storage bucket configured via
 * `STORAGE_SUPABASE_BUCKET` (default `attachments`). The bucket is private
 * (`public=false`) and has no `storage.objects` RLS policies, so the
 * service-role key (used by `lib/storage/supabase.ts`) is the only path
 * in. Auth gating stays the API route's job — KTP/KK reads still require
 * `requireAdmin`, photo reads still admin-or-linked-guardian.
 *
 * Token format:
 *   `supabase:v1:<entity>/<entityId>/<field>-<hash16>.<ext>`
 *   - `supabase:` prefix lets a later S3 adapter coexist (`s3:...`).
 *   - `v1:` reserves room for a future token format bump.
 *   - The path segment is regenerated into an object path on every read;
 *     we never concatenate untrusted input — `assertSafeSegment` rejects
 *     anything outside `[a-zA-Z0-9_-]`.
 *   - Hash is the first 16 hex chars of sha256(bytes). Deterministic — the
 *     same file uploaded twice yields the same path → Supabase `upsert`
 *     overwrites in place, no orphan objects.
 *
 * Legacy `local:v1:` tokens (4 stale Parent rows in staging from PR #294
 * preview-verify) parse cleanly but `streamFile`/`deleteFile` throw or
 * no-op respectively — the route's existing catch turns the throw into a
 * 404, which is the right user-visible outcome since the underlying files
 * never persisted on Vercel anyway.
 *
 * Demo disk backend (`demo:v1:`): when `DEMO_MODE=true` AND no Supabase
 * service-role key AND not on Vercel, files live under
 * `os.tmpdir()/talib-demo-storage`. Exists so E2E and local usability checks
 * can exercise real uploads without Supabase credentials. The condition is
 * re-evaluated on every call, and `demo:v1:` tokens are refused outside it, so
 * the backend can never engage (or be reached) on a deployment.
 *
 * Entity-generic: NEVER hardcode "students" / "photo" / "parent" / "ktp"
 * inside this module.
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { mkdir, writeFile, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { uploadObject, downloadObject, removeObject } from "./supabase";

export type SaveArgs = {
  entity: string;
  entityId: string;
  field: string;
  file: { bytes: Buffer; mimeType: string; ext: string };
};

export type SaveResult = { token: string };

export type StreamResult = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  filename: string;
};

const TOKEN_PREFIX = "supabase:v1:";
const LEGACY_LOCAL_PREFIX = "local:v1:";
const DEMO_PREFIX = "demo:v1:";

/** Re-read per call — env can change between tests / process phases. */
function isDemoBackend(): boolean {
  return (
    process.env.DEMO_MODE === "true" &&
    !process.env.SUPABASE_SERVICE_ROLE_KEY &&
    !process.env.VERCEL
  );
}

function demoRoot(): string {
  return path.join(os.tmpdir(), "talib-demo-storage");
}

const ALLOWED_EXTS = new Set(["jpg", "jpeg", "png", "pdf"]);
const SAFE_SEGMENT = /^[a-zA-Z0-9_-]+$/;

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

function assertSafeSegment(segment: string, label: string): void {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new Error(
      `Invalid ${label} segment ${JSON.stringify(segment)} — must match ${SAFE_SEGMENT}`,
    );
  }
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * Persist `file` to Supabase Storage and return an opaque token.
 * Idempotent on bytes: uploading the same content twice yields the same
 * token + overwrites in place (Supabase `upsert: true`), so we don't
 * accumulate orphans on re-upload.
 */
export async function saveFile(args: SaveArgs): Promise<SaveResult> {
  const { entity, entityId, field, file } = args;
  assertSafeSegment(entity, "entity");
  assertSafeSegment(entityId, "entityId");
  assertSafeSegment(field, "field");
  const ext = file.ext.toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(`Unsupported ext ${JSON.stringify(ext)}`);
  }

  const hash = hashBytes(file.bytes);
  const filename = `${field}-${hash}.${ext}`;
  const objectPath = `${entity}/${entityId}/${filename}`;

  if (isDemoBackend()) {
    const dest = path.join(demoRoot(), entity, entityId, filename);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.bytes);
    return { token: `${DEMO_PREFIX}${objectPath}` };
  }

  await uploadObject({ path: objectPath, bytes: file.bytes, mimeType: file.mimeType });

  const token = `${TOKEN_PREFIX}${objectPath}`;
  return { token };
}

type ParsedToken = {
  backend: "supabase" | "local" | "demo";
  path: string;
  filename: string;
  ext: string;
};

/**
 * Parse a token + return its backend, object path, filename, and ext.
 *
 * Hardening (carried forward from the local-disk adapter): a token that
 * contains `..`, backslash, leading `/`, or null bytes is rejected before
 * we touch the storage backend. Segment regex + ext whitelist match what
 * the bucket policy enforces on the server side.
 */
function parseToken(token: string): ParsedToken {
  let backend: "supabase" | "local" | "demo";
  let rest: string;
  if (token.startsWith(TOKEN_PREFIX)) {
    backend = "supabase";
    rest = token.slice(TOKEN_PREFIX.length);
  } else if (token.startsWith(DEMO_PREFIX)) {
    backend = "demo";
    rest = token.slice(DEMO_PREFIX.length);
  } else if (token.startsWith(LEGACY_LOCAL_PREFIX)) {
    backend = "local";
    rest = token.slice(LEGACY_LOCAL_PREFIX.length);
  } else {
    throw new Error("Invalid storage token (unknown prefix)");
  }

  // Expected shape: <entity>/<entityId>/<field>-<hash>.<ext>
  if (
    rest.length === 0 ||
    rest.includes("..") ||
    rest.includes("\\") ||
    rest.startsWith("/") ||
    rest.includes("\0")
  ) {
    throw new Error("Invalid storage token (path traversal attempt)");
  }
  const parts = rest.split("/");
  if (parts.length !== 3) {
    throw new Error("Invalid storage token (shape)");
  }
  const [entity, entityId, filename] = parts;
  assertSafeSegment(entity, "entity");
  assertSafeSegment(entityId, "entityId");
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    throw new Error("Invalid storage token (filename)");
  }
  const dotIdx = filename.lastIndexOf(".");
  const ext = filename.slice(dotIdx + 1).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error("Invalid storage token (ext)");
  }
  return { backend, path: rest, filename, ext };
}

/**
 * Stream the file referenced by `token`. Throws on missing object,
 * legacy `local:v1:` tokens (file unreachable on Vercel), or any token
 * validation failure.
 *
 * Callers (API routes) are responsible for the auth check — this adapter
 * has no concept of "who". It assumes its caller has already gated on
 * `requireAdmin` or a guardian-link check.
 */
export async function streamFile(token: string): Promise<StreamResult> {
  const { backend, path: objectPath, filename, ext } = parseToken(token);
  if (backend === "local") {
    throw new Error("Legacy local-disk token — file unavailable");
  }
  if (backend === "demo") {
    if (!isDemoBackend()) throw new Error("Demo storage token refused outside demo mode");
    const mimeType = EXT_TO_MIME[ext] ?? "application/octet-stream";
    const nodeStream = createReadStream(path.join(demoRoot(), ...objectPath.split("/")));
    // Fail now (ENOENT) rather than mid-response: wait for the fd to open.
    await new Promise<void>((resolve, reject) => {
      nodeStream.once("open", () => resolve());
      nodeStream.once("error", reject);
    });
    const stream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return { stream, mimeType, filename };
  }
  const { bytes } = await downloadObject(objectPath);
  // Construct a Web ReadableStream from the buffer so the route can pass
  // it straight to Response. Single chunk is fine for the 2-5 MB ceiling.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  const mimeType = EXT_TO_MIME[ext] ?? "application/octet-stream";
  return { stream, mimeType, filename };
}

/**
 * Best-effort delete. Swallows "not found"; the caller wants the file
 * gone, and "already gone" is success. Invalid tokens treated as
 * "nothing to delete" — caller will null the DB column either way.
 */
export async function deleteFile(token: string): Promise<void> {
  let parsed: ParsedToken;
  try {
    parsed = parseToken(token);
  } catch {
    return;
  }
  if (parsed.backend === "local") {
    return;
  }
  if (parsed.backend === "demo") {
    if (!isDemoBackend()) throw new Error("Demo storage token refused outside demo mode");
    try {
      await unlink(path.join(demoRoot(), ...parsed.path.split("/")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return;
  }
  await removeObject(parsed.path);
}

// Exported for tests that need to assert path resolution / token parsing.
export const __internal = { parseToken, TOKEN_PREFIX, LEGACY_LOCAL_PREFIX, DEMO_PREFIX };
