import { describe, expect, it } from "vitest";

import {
  buildGrid,
  cellKey,
  dayLabels,
  duplicateNote,
  findDuplicates,
  findInactiveCells,
  gridToSlots,
  inactiveNote,
  isGridDirty,
  toYmd,
  type SentraOption,
} from "../grid-utils";

const sentra: SentraOption[] = [
  { id: "s1", name: "Balok", status: "ACTIVE" },
  { id: "s2", name: "Seni", status: "ACTIVE" },
  { id: "s3", name: "Sentra Lama", status: "INACTIVE" },
];
const classes = ["a", "b"];

describe("day labels", () => {
  it("labels weeks and weekdays from a Monday start, tolerating ISO timestamps", () => {
    const labels = dayLabels("2026-11-09T00:00:00.000Z", 10);
    expect(labels[0]).toBe("Pekan 1 · Senin");
    expect(labels[4]).toBe("Pekan 1 · Jumat");
    expect(labels[5]).toBe("Pekan 2 · Senin");
    expect(labels).toHaveLength(10);
    expect(toYmd("2026-11-09T00:00:00.000Z")).toBe("2026-11-09");
  });

  it("moves a weekend start to the next Monday", () => {
    expect(dayLabels("2026-11-07", 1)[0]).toBe("Pekan 1 · Senin");
  });
});

describe("duplicates", () => {
  it("flags both cells of a sentra used twice on one day and writes the note", () => {
    const grid = buildGrid([
      { dayIndex: 0, classSectionId: "a", sentraId: "s1" },
      { dayIndex: 0, classSectionId: "b", sentraId: "s1" },
      { dayIndex: 1, classSectionId: "a", sentraId: "s1" },
      { dayIndex: 1, classSectionId: "b", sentraId: "s2" },
    ]);
    const { cells, notes } = findDuplicates(grid, 2, classes);
    expect([...cells].sort()).toEqual([cellKey(0, "a"), cellKey(0, "b")].sort());
    expect(notes).toEqual([{ dayIndex: 0, sentraId: "s1" }]);
    expect(duplicateNote(notes[0], sentra, "2026-11-09")).toBe(
      "Sentra Balok dipakai dua kelas di Pekan 1 · Senin.",
    );
  });

  it("ignores empty cells", () => {
    const grid = buildGrid([
      { dayIndex: 0, classSectionId: "a", sentraId: null },
      { dayIndex: 0, classSectionId: "b", sentraId: null },
    ]);
    expect(findDuplicates(grid, 1, classes).cells.size).toBe(0);
  });
});

describe("inactive sentra", () => {
  it("finds cells holding a nonaktif sentra and words the note", () => {
    const grid = buildGrid([
      { dayIndex: 0, classSectionId: "a", sentraId: "s3" },
      { dayIndex: 1, classSectionId: "b", sentraId: "s3" },
      { dayIndex: 1, classSectionId: "a", sentraId: "s1" },
    ]);
    const res = findInactiveCells(grid, 2, classes, sentra);
    expect(res.cells.size).toBe(2);
    expect(res.sentraIds).toEqual(["s3"]);
    expect(inactiveNote("s3", sentra)).toBe("Sentra Lama sudah nonaktif — ganti dulu sebelum menyimpan.");
  });

  it("clears once the cells are changed or emptied", () => {
    const grid = { [cellKey(0, "a")]: null, [cellKey(0, "b")]: "s1" };
    expect(findInactiveCells(grid, 1, classes, sentra).cells.size).toBe(0);
  });
});

describe("dirty + slots", () => {
  it("treats undefined and null as the same empty cell", () => {
    const saved = buildGrid([{ dayIndex: 0, classSectionId: "a", sentraId: null }]);
    expect(isGridDirty(saved, {}, 1, classes)).toBe(false);
    expect(isGridDirty(saved, { [cellKey(0, "a")]: "s1" }, 1, classes)).toBe(true);
  });

  it("emits every cell, null for empty", () => {
    const slots = gridToSlots({ [cellKey(0, "a")]: "s1" }, 2, classes);
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ dayIndex: 0, classSectionId: "a", sentraId: "s1" });
    expect(slots[1].sentraId).toBeNull();
  });
});
