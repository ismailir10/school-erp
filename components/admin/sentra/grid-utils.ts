import { rotationDayLabel, sentraLabel } from "@/lib/sentra/rotation";

// Pure helpers for the putaran grid editor (rows = days, columns = classes).

export type SentraOption = { id: string; name: string; status: "ACTIVE" | "INACTIVE" };
export type GridSlot = { dayIndex: number; classSectionId: string; sentraId: string | null };
export type GridState = Record<string, string | null>;

export function cellKey(dayIndex: number, classSectionId: string): string {
  return `${dayIndex}:${classSectionId}`;
}

/** The API returns a Date as an ISO timestamp; the grid works with the calendar day. */
export function toYmd(value: string): string {
  return value.slice(0, 10);
}

export function buildGrid(slots: GridSlot[]): GridState {
  const grid: GridState = {};
  for (const s of slots) grid[cellKey(s.dayIndex, s.classSectionId)] = s.sentraId;
  return grid;
}

export function dayLabels(startDate: string, cycleDays: number): string[] {
  return Array.from({ length: cycleDays }, (_, i) => rotationDayLabel(toYmd(startDate), i));
}

export function gridToSlots(grid: GridState, cycleDays: number, classIds: string[]): GridSlot[] {
  const slots: GridSlot[] = [];
  for (let d = 0; d < cycleDays; d++) {
    for (const c of classIds) {
      slots.push({ dayIndex: d, classSectionId: c, sentraId: grid[cellKey(d, c)] ?? null });
    }
  }
  return slots;
}

/** True when any cell differs between the saved and the edited grid (empty = null). */
export function isGridDirty(
  saved: GridState,
  current: GridState,
  cycleDays: number,
  classIds: string[],
): boolean {
  for (let d = 0; d < cycleDays; d++) {
    for (const c of classIds) {
      const k = cellKey(d, c);
      if ((saved[k] ?? null) !== (current[k] ?? null)) return true;
    }
  }
  return false;
}

/** Cells whose sentra is used by another class on the same day, plus one note per (day, sentra). */
export function findDuplicates(
  grid: GridState,
  cycleDays: number,
  classIds: string[],
): { cells: Set<string>; notes: { dayIndex: number; sentraId: string }[] } {
  const cells = new Set<string>();
  const notes: { dayIndex: number; sentraId: string }[] = [];
  for (let d = 0; d < cycleDays; d++) {
    const seen = new Map<string, string[]>();
    for (const c of classIds) {
      const id = grid[cellKey(d, c)];
      if (!id) continue;
      seen.set(id, [...(seen.get(id) ?? []), c]);
    }
    for (const [sentraId, cols] of seen) {
      if (cols.length < 2) continue;
      for (const c of cols) cells.add(cellKey(d, c));
      notes.push({ dayIndex: d, sentraId });
    }
  }
  return { cells, notes };
}

/** Cells holding a sentra that is now INACTIVE (the save API rejects them). */
export function findInactiveCells(
  grid: GridState,
  cycleDays: number,
  classIds: string[],
  sentra: SentraOption[],
): { cells: Set<string>; sentraIds: string[] } {
  const inactive = new Set(sentra.filter((s) => s.status !== "ACTIVE").map((s) => s.id));
  const cells = new Set<string>();
  const ids = new Set<string>();
  for (let d = 0; d < cycleDays; d++) {
    for (const c of classIds) {
      const id = grid[cellKey(d, c)];
      if (id && inactive.has(id)) {
        cells.add(cellKey(d, c));
        ids.add(id);
      }
    }
  }
  return { cells, sentraIds: [...ids] };
}

export function sentraNameOf(sentra: SentraOption[], id: string): string {
  const s = sentra.find((x) => x.id === id);
  return sentraLabel(s?.name ?? "tidak dikenal");
}

export function duplicateNote(
  note: { dayIndex: number; sentraId: string },
  sentra: SentraOption[],
  startDate: string,
): string {
  return `${sentraNameOf(sentra, note.sentraId)} dipakai dua kelas di ${rotationDayLabel(toYmd(startDate), note.dayIndex)}.`;
}

export function inactiveNote(sentraId: string, sentra: SentraOption[]): string {
  return `${sentraNameOf(sentra, sentraId)} sudah nonaktif — ganti dulu sebelum menyimpan.`;
}
