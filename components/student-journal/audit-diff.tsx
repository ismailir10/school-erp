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
  return (
    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-sans">Sebelum</p>
        <pre className="bg-destructive-subtle p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(before, null, 2)}
        </pre>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-sans">Sesudah</p>
        <pre className="bg-primary/10 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(after, null, 2)}
        </pre>
      </div>
    </div>
  );
}
