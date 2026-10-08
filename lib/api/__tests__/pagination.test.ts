import { describe, it, expect } from "vitest";
import { parsePagination, parseSort, cleanSearch, escapeLike } from "../pagination";

describe("parseSort — allowlist enforcement", () => {
  const opts = {
    allow: ["name", "createdAt", "status"] as const,
    default: "name",
    defaultOrder: "asc" as const,
  };

  it("returns default orderBy when sortBy absent", () => {
    const result = parseSort(new URLSearchParams(), opts);
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.orderBy).toEqual({ name: "asc" });
  });

  it("accepts a whitelisted sort key", () => {
    const result = parseSort(new URLSearchParams("sortBy=createdAt&sortOrder=desc"), opts);
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.orderBy).toEqual({ createdAt: "desc" });
  });

  it("rejects unknown sort key with 400 (no Prisma schema leak)", async () => {
    const result = parseSort(new URLSearchParams("sortBy=__proto__"), opts);
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toContain("__proto__");
    // crucial: error message must NOT reveal Prisma field names
    expect(body.error).not.toMatch(/Argument|Unknown field|Available options/i);
  });

  it("rejects invalid sort direction with 400", async () => {
    const result = parseSort(new URLSearchParams("sortBy=name&sortOrder=sideways"), opts);
    expect(result).toBeInstanceOf(Response);
    if (!(result instanceof Response)) return;
    expect(result.status).toBe(400);
    const body = await result.json();
    expect(body.error).toContain("sideways");
  });

  it("uses default order when sortOrder absent but sortBy provided", () => {
    const result = parseSort(new URLSearchParams("sortBy=status"), opts);
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;
    expect(result.orderBy).toEqual({ status: "asc" });
  });

  it("throws when default key is not in allowlist (programmer error)", () => {
    expect(() =>
      parseSort(new URLSearchParams(), {
        allow: ["name"],
        default: "createdAt",
      })
    ).toThrow(/default key/);
  });
});

describe("parsePagination — defensive parsing (STR-11)", () => {
  const parse = (qs: string) => parsePagination(new URLSearchParams(qs));

  it("defaults when absent", () => {
    expect(parse("")).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it("falls back to defaults for non-numeric values instead of NaN", () => {
    const r = parse("page=abc&pageSize=abc");
    expect(r).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
    expect(Number.isNaN(r.skip)).toBe(false);
  });

  it("treats blank and non-finite values as defaults", () => {
    expect(parse("page=&pageSize=").page).toBe(1);
    expect(parse("page=Infinity").page).toBe(1);
    expect(parse("pageSize=-Infinity").pageSize).toBe(20);
  });

  it("clamps a huge page to 10000 so skip stays within Int range", () => {
    const r = parse("page=99999999999999999999");
    expect(r.page).toBe(10_000);
    expect(r.skip).toBe(9_999 * 20);
    expect(r.skip).toBeLessThan(2 ** 31);
  });

  it("clamps pageSize to [1, 100] and page to >= 1", () => {
    expect(parse("pageSize=5000").pageSize).toBe(100);
    expect(parse("pageSize=0").pageSize).toBe(1);
    expect(parse("page=-4").page).toBe(1);
  });

  it("truncates fractional values and passes ordinary ones through", () => {
    expect(parse("page=3&pageSize=50")).toEqual({ page: 3, pageSize: 50, skip: 100, take: 50 });
    expect(parse("page=2.9").page).toBe(2);
  });
});

describe("cleanSearch (STR-11)", () => {
  it("strips NUL and control characters", () => {
    expect(cleanSearch("a\u0000b")).toBe("ab");
    expect(cleanSearch("\u0000")).toBe("");
    expect(cleanSearch("x\u0007y\u001Fz")).toBe("xyz");
  });

  it("trims, and returns empty for null/undefined/blank", () => {
    expect(cleanSearch("  Aisyah  ")).toBe("Aisyah");
    expect(cleanSearch(null)).toBe("");
    expect(cleanSearch(undefined)).toBe("");
    expect(cleanSearch("   ")).toBe("");
  });

  it("keeps Indonesian names, apostrophes and diacritics", () => {
    expect(cleanSearch("An Nisaa' Ibrâhim")).toBe("An Nisaa' Ibrâhim");
  });

  it("caps length by code point", () => {
    expect(cleanSearch("a".repeat(500))).toHaveLength(100);
    expect(Array.from(cleanSearch("😀".repeat(200)))).toHaveLength(100);
  });
});

describe("escapeLike (STR-11)", () => {
  it("escapes %, _ and backslash with a backslash", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\x")).toBe("c:\\\\x");
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });

  it("leaves ordinary text (and apostrophes) untouched", () => {
    expect(escapeLike("Aisyah")).toBe("Aisyah");
    expect(escapeLike("An Nisaa' Ibrâhim")).toBe("An Nisaa' Ibrâhim");
    expect(escapeLike("")).toBe("");
  });

  it("composes with cleanSearch without changing its output", () => {
    expect(cleanSearch("%")).toBe("%");
    expect(escapeLike(cleanSearch("  50%_off "))).toBe("50\\%\\_off");
  });
});
