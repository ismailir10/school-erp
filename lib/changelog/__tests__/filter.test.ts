import { describe, expect, it } from "vitest";
import { audienceForRole, filterReleases, paginateReleases, releaseMonths } from "../filter";
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

describe("release discovery", () => {
  const sameDay = { ...releases[0], id: "2026-11-06-2" };
  const olderYear = { ...releases[0], id: "2025-11-06" };

  it("lists archive months once in descending order across years", () => {
    expect(releaseMonths([olderYear, ...releases, sameDay])).toEqual([
      "2026-11", "2026-10", "2025-11",
    ]);
  });

  it("combines month, module and audience, including a second same-day release", () => {
    const archive = [sameDay, ...releases, olderYear];
    const filters = { month: "2026-11", module: "kehadiran-siswa" } as const;
    const mine = filterReleases(archive, "guru", "mine", filters);
    expect(mine.map((release) => release.id)).toEqual([sameDay.id, releases[0].id]);
    expect(mine.map((release) => release.items.map((item) => item.text))).toEqual([
      ["Untuk guru."], ["Untuk guru."],
    ]);
    expect(filterReleases(archive, "guru", "all", filters)[0].items.map((item) => item.text)).toEqual([
      "Untuk guru.", "Untuk orang tua.",
    ]);
    expect(filterReleases(archive, "guru", "mine", { ...filters, module: "sdm" })).toEqual([]);
  });

  it("paginates matching releases in order and bounds the final page", () => {
    const archive = Array.from({ length: 7 }, (_, index) => ({
      ...releases[0],
      id: `2026-11-0${7 - index}`,
    }));
    const matches = filterReleases([releases[1], ...archive], "guru", "mine");
    expect(paginateReleases(matches, 1)).toMatchObject({
      page: 1, totalPages: 2, releases: matches.slice(0, 5),
    });
    expect(paginateReleases(matches, 9)).toMatchObject({
      page: 2, totalPages: 2, releases: matches.slice(5),
    });
    expect(paginateReleases([], 2)).toEqual({ page: 1, totalPages: 0, releases: [] });
  });
});
