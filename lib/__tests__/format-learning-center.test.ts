import { describe, it, expect } from "vitest";
import {
  formatLearningCenter,
  formatEntrySentra,
  ALL_LEARNING_CENTERS,
} from "@/lib/format";

describe("formatLearningCenter", () => {
  it.each([
    ["WORSHIP", "Sentra Ibadah"],
    ["NATURAL_MATERIALS", "Sentra Bahan Alam"],
    ["ART", "Sentra Seni"],
    ["COOKING", "Sentra Memasak"],
    ["ROLE_PLAY", "Sentra Main Peran"],
    ["BLOCKS", "Sentra Balok"],
    ["PREPARATION", "Sentra Persiapan"],
    ["AREA", "Sentra Area"],
  ])("%s → %s", (input, expected) => {
    expect(formatLearningCenter(input)).toBe(expected);
  });

  it("falls back to the raw enum value when unknown", () => {
    expect(formatLearningCenter("UNKNOWN_FUTURE_CENTER")).toBe(
      "UNKNOWN_FUTURE_CENTER",
    );
  });
});

describe("ALL_LEARNING_CENTERS", () => {
  it("lists all 8 sentra keys in a stable order", () => {
    expect(ALL_LEARNING_CENTERS).toEqual([
      "WORSHIP",
      "NATURAL_MATERIALS",
      "ART",
      "COOKING",
      "ROLE_PLAY",
      "BLOCKS",
      "PREPARATION",
      "AREA",
    ]);
  });
});

describe("formatEntrySentra", () => {
  it("prefers the campus sentra name", () => {
    expect(formatEntrySentra({ sentra: { name: "Makro" }, center: "WORSHIP" })).toBe("Sentra Makro");
  });
  it("does not double the Sentra prefix", () => {
    expect(formatEntrySentra({ sentra: { name: "Sentra Balok" } })).toBe("Sentra Balok");
  });
  it("falls back to the legacy label, then a dash", () => {
    expect(formatEntrySentra({ sentra: null, center: "WORSHIP" })).toBe("Sentra Ibadah");
    expect(formatEntrySentra({})).toBe("—");
  });
});
