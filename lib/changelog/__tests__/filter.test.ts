import { describe, expect, it } from "vitest";
import { audienceForRole, filterReleases } from "../filter";
import type { Release } from "../schema";

const releases: Release[] = [
  {
    id: "2026-11-06",
    headline: "Campuran",
    items: [
      { kind: "baru", audience: "guru", module: "kehadiran-siswa", text: "Untuk guru." },
      { kind: "baru", audience: "orang-tua", module: "kehadiran-siswa", text: "Untuk orang tua." },
      { kind: "diperbaiki", audience: "semua", module: "umum", text: "Untuk semua." },
    ],
  },
  {
    id: "2026-10-31",
    headline: "Khusus admin",
    items: [
      { kind: "baru", audience: "admin", module: "tagihan-pembayaran", text: "A." },
      { kind: "baru", audience: "admin", module: "siswa-wali", text: "B." },
    ],
  },
];

describe("audienceForRole", () => {
  it.each([
    ["SUPER_ADMIN", "admin"],
    ["SCHOOL_ADMIN", "admin"],
    ["TEACHER", "guru"],
    ["GUARDIAN", "orang-tua"],
    ["OTHER", null],
  ])("%s -> %s", (role, expected) => expect(audienceForRole(role)).toBe(expected));
});

describe("filterReleases", () => {
  it("mine: own items plus 'semua', dropping releases with nothing for the viewer", () => {
    const out = filterReleases(releases, "guru", "mine");
    expect(out.map((r) => r.id)).toEqual(["2026-11-06"]);
    expect(out[0].items.map((i) => i.text)).toEqual(["Untuk guru.", "Untuk semua."]);
  });

  it("all: every release and item untouched", () => {
    expect(filterReleases(releases, "guru", "all")).toEqual(releases);
  });

  it("an unknown role sees everything", () => {
    expect(filterReleases(releases, null, "mine")).toEqual(releases);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterReleases([releases[1]], "orang-tua", "mine")).toEqual([]);
  });
});
