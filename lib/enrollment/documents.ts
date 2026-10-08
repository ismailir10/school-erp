/**
 * Kelengkapan Berkas — the paper form's document checklist, digitised.
 *
 * Single source for the item list, the shape stored in
 * `EnrollmentApplication.documents` and the two redacted views of it (parent
 * and admin). Importable from client components: NO server imports here. The
 * storage token (`fileToken`) exists only in the raw column and is dropped by
 * both `toPublicDocuments` and `toAdminDocuments` — it never reaches a browser.
 *
 * Raw column shape (written by the public documents routes and the admin tick):
 *   { [key]: { fileToken, fileName, mimeType, size, uploadedAt, label?,
 *              receivedPhysical?, receivedAt? } }
 * Everything read back from JSON is treated as untrusted: unknown keys are
 * dropped and wrongly typed fields are ignored.
 */

export type DocumentItem = {
  key: string;
  label: string;
  required: boolean;
  note?: string;
};

export const DOCUMENT_ITEMS = [
  { key: "akta", label: "Akta kelahiran anak", required: true },
  { key: "kk", label: "Kartu Keluarga (KK)", required: true },
  { key: "kia", label: "Kartu Identitas Anak (KIA)", required: true },
  { key: "ktp_ayah", label: "KTP Ayah", required: true },
  { key: "ktp_ibu", label: "KTP Ibu", required: true },
  {
    key: "foto_anak",
    label: "Pas foto berwarna anak 3×4",
    required: true,
    note: "Bawa juga 4 lembar cetak ke sekolah",
  },
  { key: "foto_ayah", label: "Pas foto berwarna Ayah 3×4", required: true },
  { key: "foto_ibu", label: "Pas foto berwarna Ibu 3×4", required: true },
  { key: "surat_sehat", label: "Surat keterangan sehat", required: true },
  {
    key: "surat_pindah",
    label: "Surat keterangan pindah sekolah",
    required: false,
    note: "Hanya bagi yang pernah mendaftar di sekolah lain",
  },
  { key: "lainnya", label: "Berkas lainnya", required: false },
] as const satisfies readonly DocumentItem[];

export type DocumentKey = (typeof DOCUMENT_ITEMS)[number]["key"];

export const DOCUMENT_KEYS: readonly DocumentKey[] = DOCUMENT_ITEMS.map((i) => i.key);

const KEY_SET: ReadonlySet<string> = new Set(DOCUMENT_KEYS);

export function isDocumentKey(value: unknown): value is DocumentKey {
  return typeof value === "string" && KEY_SET.has(value);
}

const REQUIRED_KEYS: readonly DocumentKey[] = DOCUMENT_ITEMS.filter((i) => i.required).map((i) => i.key);

/** Items that count toward "x / 9 berkas lengkap". */
export const REQUIRED_DOCUMENT_COUNT = REQUIRED_KEYS.length;

/** Server cap per upload — Vercel's request body limit is 4.5 MB. */
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export type PublicDocument = {
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  label?: string;
};
/** What the parent's browser sees: uploaded files by key, never tokens. */
export type PublicDocuments = Partial<Record<DocumentKey, PublicDocument>>;

export type AdminDocument = {
  hasFile: boolean;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  uploadedAt: string | null;
  label?: string;
  receivedPhysical: boolean;
  receivedAt: string | null;
};
/** What staff see: every key that has a file or a physical-receipt record. */
export type AdminDocuments = Partial<Record<DocumentKey, AdminDocument>>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** Parsed view of one raw entry; `fileToken` is only read to decide `hasFile`. */
function parseEntry(raw: unknown) {
  const o = asRecord(raw);
  if (!o) return null;
  const hasFile = str(o.fileToken) !== null;
  return {
    hasFile,
    fileName: str(o.fileName),
    mimeType: str(o.mimeType),
    size: num(o.size),
    uploadedAt: str(o.uploadedAt),
    label: str(o.label) ?? undefined,
    receivedPhysical: o.receivedPhysical === true,
    receivedAt: str(o.receivedAt),
  };
}

export function toPublicDocuments(raw: unknown): PublicDocuments {
  const root = asRecord(raw);
  const out: PublicDocuments = {};
  if (!root) return out;
  for (const key of DOCUMENT_KEYS) {
    const e = parseEntry(root[key]);
    if (!e || !e.hasFile || !e.fileName) continue;
    out[key] = {
      fileName: e.fileName,
      mimeType: e.mimeType ?? "application/octet-stream",
      size: e.size ?? 0,
      uploadedAt: e.uploadedAt ?? "",
      ...(e.label ? { label: e.label } : {}),
    };
  }
  return out;
}

export function toAdminDocuments(raw: unknown): AdminDocuments {
  const root = asRecord(raw);
  const out: AdminDocuments = {};
  if (!root) return out;
  for (const key of DOCUMENT_KEYS) {
    const e = parseEntry(root[key]);
    if (!e || (!e.hasFile && !e.receivedPhysical)) continue;
    out[key] = {
      hasFile: e.hasFile,
      fileName: e.hasFile ? e.fileName : null,
      mimeType: e.hasFile ? e.mimeType : null,
      size: e.hasFile ? e.size : null,
      uploadedAt: e.hasFile ? e.uploadedAt : null,
      ...(e.hasFile && e.label ? { label: e.label } : {}),
      receivedPhysical: e.receivedPhysical,
      receivedAt: e.receivedPhysical ? e.receivedAt : null,
    };
  }
  return out;
}

type AnyDocuments = PublicDocuments | AdminDocuments;

/** An item is "done" when a file is uploaded or staff marked it received. */
function isDone(entry: unknown): boolean {
  const o = asRecord(entry);
  if (!o) return false;
  // Admin shape carries hasFile/receivedPhysical; public shape is presence-only.
  if ("hasFile" in o || "receivedPhysical" in o) {
    return o.hasFile === true || o.receivedPhysical === true;
  }
  return typeof o.fileName === "string" && o.fileName.length > 0;
}

/**
 * Accepts the public or admin view, OR the raw column (it reads `fileToken`
 * defensively), and counts required items only.
 */
function normalize(docs: unknown): AnyDocuments {
  const root = asRecord(docs);
  if (!root) return {};
  const looksRaw = Object.values(root).some((v) => {
    const o = asRecord(v);
    return !!o && "fileToken" in o;
  });
  return looksRaw ? toAdminDocuments(root) : (root as AnyDocuments);
}

export function documentProgress(docs: unknown): { done: number; required: number } {
  const d = normalize(docs) as Record<string, unknown>;
  const done = REQUIRED_KEYS.filter((k) => isDone(d[k])).length;
  return { done, required: REQUIRED_DOCUMENT_COUNT };
}

/** Required keys that are neither uploaded nor marked received, in form order. */
export function missingRequiredDocuments(docs: unknown): DocumentKey[] {
  const d = normalize(docs) as Record<string, unknown>;
  return REQUIRED_KEYS.filter((k) => !isDone(d[k]));
}

/**
 * Of the `required` keys, those with no uploaded file, in `DOCUMENT_ITEMS`
 * order. Unlike `missingRequiredDocuments`, a staff "received physically" tick
 * does NOT count: this gates the parent's submit, and the parent can only
 * satisfy it by uploading. Accepts the raw column or either redacted view.
 */
export function missingUploads(docs: unknown, required: readonly DocumentKey[]): DocumentKey[] {
  const root = asRecord(docs);
  const want = new Set<string>(required);
  return DOCUMENT_KEYS.filter((k) => {
    if (!want.has(k)) return false;
    const entry = root ? asRecord(root[k]) : null;
    if (!entry) return true;
    if ("fileToken" in entry) return str(entry.fileToken) === null;
    if ("hasFile" in entry) return entry.hasFile !== true;
    return str(entry.fileName) === null; // public view: presence-only
  });
}

const MAX_FILE_NAME = 120;
const MAX_LABEL = 80;

/**
 * Display name for an uploaded file, taken from the client-supplied
 * `File.name`: basename only, control characters and path separators removed,
 * capped at 120 chars with the extension kept. It is stored and shown as plain
 * text and never used to build a storage path (the storage token is
 * content-addressed). Falls back to `<key>.<ext>` when nothing usable is left.
 */
export function sanitizeDocumentFileName(raw: unknown, fallbackBase: string, fallbackExt: string): string {
  const fallback = `${fallbackBase}.${fallbackExt}`;
  if (typeof raw !== "string") return fallback;
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!base || /^\.+$/.test(base)) return fallback;
  if (base.length <= MAX_FILE_NAME) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, MAX_FILE_NAME - ext.length) + ext;
}

/** Free-text label for the "Berkas lainnya" slot: control chars out, trimmed, max 80. */
export function sanitizeDocumentLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
  return v || null;
}
