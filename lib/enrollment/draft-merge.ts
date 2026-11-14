/** Merge only leaves edited since this browser's last acknowledged snapshot.
 * A concurrent edit to the same leaf is rejected instead of silently replaced. */
export function mergeDraft(base: unknown, incoming: unknown, stored: unknown): unknown {
  if (JSON.stringify(base) === JSON.stringify(incoming)) return stored === undefined ? incoming : stored;
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    const b = (base && typeof base === "object" ? base : {}) as Record<string, unknown>;
    const current = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
    const result = { ...current };
    for (const [key, value] of Object.entries(incoming)) result[key] = mergeDraft(b[key], value, current[key]);
    return result;
  }
  if (stored !== undefined && !(stored === null && base === "") && JSON.stringify(stored) !== JSON.stringify(base) && JSON.stringify(stored) !== JSON.stringify(incoming)) throw new Error("DRAFT_CONFLICT");
  return incoming;
}
