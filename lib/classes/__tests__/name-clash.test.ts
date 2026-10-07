import { describe, it, expect, vi } from "vitest";
import { findClassNameClash } from "../name-clash";

function makeDb(result: { id: string; name: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(result);
  return { db: { classSection: { findFirst } } as never, findFirst };
}

describe("findClassNameClash", () => {
  it("matches case-insensitively on the trimmed name within tenant + year + campus", async () => {
    const { db, findFirst } = makeDb({ id: "c1", name: "TK A" });
    const hit = await findClassNameClash(db, {
      tenantId: "t1",
      academicYearId: "y1",
      campusId: "k1",
      name: "  tk a ",
    });
    expect(hit).toEqual({ id: "c1", name: "TK A" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        academicYearId: "y1",
        campusId: "k1",
        name: { equals: "tk a", mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
  });

  it("returns null when nothing clashes", async () => {
    const { db } = makeDb(null);
    expect(
      await findClassNameClash(db, {
        tenantId: "t1",
        academicYearId: "y1",
        campusId: "k1",
        name: "TK C",
      }),
    ).toBeNull();
  });

  it("excludes the class being renamed so it never clashes with itself", async () => {
    const { db, findFirst } = makeDb(null);
    await findClassNameClash(db, {
      tenantId: "t1",
      academicYearId: "y1",
      campusId: "k1",
      name: "TK A",
      excludeId: "c1",
    });
    expect(findFirst.mock.calls[0][0].where.id).toEqual({ not: "c1" });
  });
});
