"use client";

/**
 * AuditDiff — side-by-side JSON snapshot viewer for the audit trail.
 *
 * Left panel (before) uses a subtle destructive tint; right panel (after)
 * uses a subtle primary tint. Both use CSS vars — no hex.
 */
export function AuditDiff({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}) {
  function readable(value: unknown): string {
    if (value === null || value === undefined) return "Belum ada";
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.checked === "boolean") return record.checked ? "Sudah dilakukan" : "Belum dilakukan";
      if (typeof record.body === "string") return record.body;
      if (record.status === "ACTIVE") return "Catatan aktif";
      if (record.status === "INACTIVE") return "Catatan dinonaktifkan";
    }
    return "Perubahan data";
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><p className="text-xs text-muted-foreground">Sebelum</p><p className="whitespace-pre-wrap break-words">{readable(before)}</p></div>
        <div><p className="text-xs text-muted-foreground">Sesudah</p><p className="whitespace-pre-wrap break-words">{readable(after)}</p></div>
      </div>
      <details className="text-xs text-muted-foreground"><summary>Detail teknis</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify({ before, after }, null, 2)}</pre></details>
    </div>
  );
}
