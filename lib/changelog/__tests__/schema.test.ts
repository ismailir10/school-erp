import { describe, expect, it } from "vitest";
import { RELEASES } from "../releases";
import {
  HEADLINE_MAX,
  ITEM_MAX,
  MAINTENANCE_ITEM,
  validateReleases,
  type Release,
} from "../schema";

const ok = (id: string): Release => ({
  id,
  headline: "Absensi lebih cepat",
  items: [
    { kind: "baru", audience: "guru", text: "Guru bisa menandai semua hadir sekali ketuk." },
    { kind: "diperbaiki", audience: "admin", text: "Daftar siswa tidak lagi memuat dua kali." },
  ],
});

describe("validateReleases", () => {
  it("accepts a well-formed newest-first list", () => {
    expect(validateReleases([ok("2026-11-06-2"), ok("2026-11-06"), ok("2026-10-31")])).toEqual([]);
  });

  it("accepts a single-item release such as the maintenance one", () => {
    expect(validateReleases([{ id: "2026-11-06", headline: "Pemeliharaan", items: [MAINTENANCE_ITEM] }])).toEqual([]);
  });

  it.each([
    ["bad id", { ...ok("2026-11-06"), id: "6 Nov" }, "id must be"],
    ["empty headline", { ...ok("2026-11-06"), headline: " " }, "headline is empty"],
    ["long headline", { ...ok("2026-11-06"), headline: "x".repeat(HEADLINE_MAX + 1) }, "headline over"],
    ["no items", { ...ok("2026-11-06"), items: [] }, "needs 1-7 items"],
    ["too many items", { ...ok("2026-11-06"), items: Array(8).fill(ok("x").items[0]) }, "more than 7"],
    ["long item", { ...ok("2026-11-06"), items: [{ ...ok("x").items[0], text: "x".repeat(ITEM_MAX + 1) }, ok("x").items[1]] }, "text over"],
    ["PR number", { ...ok("2026-11-06"), items: [{ ...ok("x").items[0], text: "Perbaikan (#712)." }, ok("x").items[1]] }, "no PR numbers"],
    ["bad kind", { ...ok("2026-11-06"), items: [{ ...ok("x").items[0], kind: "fix" as never }, ok("x").items[1]] }, "unknown kind"],
    ["bad audience", { ...ok("2026-11-06"), items: [{ ...ok("x").items[0], audience: "siswa" as never }, ok("x").items[1]] }, "unknown audience"],
  ])("rejects %s", (_name, release, message) => {
    expect(validateReleases([release as Release]).join("\n")).toContain(message);
  });

  it("rejects duplicate ids and wrong order", () => {
    expect(validateReleases([ok("2026-11-06"), ok("2026-11-06")]).join("\n")).toContain("duplicate id");
    expect(validateReleases([ok("2026-10-31"), ok("2026-11-06")]).join("\n")).toContain("newest first");
  });
});

describe("RELEASES (the shipped data)", () => {
  it("passes every rule", () => {
    expect(validateReleases(RELEASES)).toEqual([]);
  });
});
