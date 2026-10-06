import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { tenant: { findUnique: vi.fn() } } }));

import { getRequiredDocuments, normalizeRequiredDocuments } from "./required-documents";

const findUnique = vi.fn();
const db = { tenant: { findUnique } } as never;

describe("normalizeRequiredDocuments", () => {
  it("filters unknown keys, dedupes and keeps DOCUMENT_ITEMS order", () => {
    expect(normalizeRequiredDocuments(["surat_sehat", "kk", "x", "kk", "akta", 3, null])).toEqual(["akta", "kk", "surat_sehat"]);
  });
  it("is [] for anything that is not an array", () => {
    for (const bad of [null, undefined, "kk", {}, 1]) expect(normalizeRequiredDocuments(bad)).toEqual([]);
  });
});

describe("getRequiredDocuments", () => {
  it("is [] when the tenant row is not found", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getRequiredDocuments("t-1", db)).toEqual([]);
  });

  it("reads by tenant and normalizes the stored array", async () => {
    findUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk", "bogus", "akta", "kk"] });
    expect(await getRequiredDocuments("t-1", db)).toEqual(["akta", "kk"]);
    expect(findUnique.mock.calls.at(-1)![0].where).toEqual({ id: "t-1" });
  });
});
