/**
 * Pure helpers behind the session view's "Semua hadir" / "Semua pulang" taps.
 *
 * Both only ever fill gaps: they never touch a row whose status is an
 * exception (ABSENT / SICK / PERMISSION) and never overwrite a time that is
 * already there. The caller keeps a snapshot for the undo toast.
 */

export type BulkRow = {
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  pickedUpByRelation: string | null;
  pickedUpByName: string | null;
};

/** Explicit bulk arrival records unmarked children as present and fills gaps. */
export function applyAllArrived<T extends BulkRow>(
  rows: T[],
  nowIso: string,
): { rows: T[]; changed: number } {
  let changed = 0;
  const next = rows.map((r) => {
    if ((r.status !== "PRESENT" && r.status !== "UNKNOWN") || r.checkInTime) return r;
    changed += 1;
    return { ...r, status: "PRESENT", checkInTime: nowIso };
  });
  return { rows: next, changed };
}

/** Pickup (default relation Orang tua) for everyone present not yet picked up. */
export function applyAllPickedUp<T extends BulkRow>(
  rows: T[],
  nowIso: string,
): { rows: T[]; changed: number } {
  let changed = 0;
  const next = rows.map((r) => {
    if (r.status !== "PRESENT" || r.checkOutTime) return r;
    changed += 1;
    return {
      ...r,
      checkOutTime: nowIso,
      pickedUpByRelation: r.pickedUpByRelation ?? "PARENT",
    };
  });
  return { rows: next, changed };
}
