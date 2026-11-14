import { describe, it, expect } from "vitest";
import { createCampusSchema, updateCampusSchema } from "@/lib/validations/campus";

describe("createCampusSchema", () => {
  it("accepts a well-formed campus body", () => {
    const res = createCampusSchema.safeParse({
      name: "Taman Aster",
      address: "Jl. Contoh No.1",
      lat: "-6.2234",
      lng: "106.8432",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.lat).toBeCloseTo(-6.2234);
      expect(res.data.lng).toBeCloseTo(106.8432);
    }
  });

  it("rejects an empty name", () => {
    expect(
      createCampusSchema.safeParse({ name: "", address: "", lat: "", lng: "" }).success,
    ).toBe(false);
  });

  it("treats an empty lat/lng as absent rather than 0", () => {
    const res = createCampusSchema.safeParse({ name: "Kampus Timur", address: "", lat: "", lng: "" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.lat).toBeUndefined();
      expect(res.data.lng).toBeUndefined();
    }
  });

  it("treats an empty address as absent", () => {
    const res = createCampusSchema.safeParse({ name: "Kampus Timur", address: "  ", lat: "", lng: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.address).toBeUndefined();
  });

  it("trims the name", () => {
    const res = createCampusSchema.safeParse({ name: "  Kampus Timur  ", address: "", lat: "", lng: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.name).toBe("Kampus Timur");
  });
});

describe("updateCampusSchema (unchanged)", () => {
  it("still accepts a partial body", () => {
    expect(updateCampusSchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
  });
});

describe("campus coordinates are range-checked (HR-9)", () => {
  it("rejects out-of-range latitude/longitude on create with field paths", () => {
    const res = createCampusSchema.safeParse({ name: "K", lat: "999", lng: "-500" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const byPath = Object.fromEntries(res.error.issues.map((i) => [i.path.join("."), i.message]));
      expect(byPath.lat).toBe("Latitude harus antara -90 dan 90");
      expect(byPath.lng).toBe("Longitude harus antara -180 dan 180");
    }
  });

  it("accepts the boundary values and ordinary coordinates", () => {
    expect(createCampusSchema.safeParse({ name: "K", lat: "-90", lng: "180" }).success).toBe(true);
    expect(createCampusSchema.safeParse({ name: "K", lat: -6.2, lng: 106.8 }).success).toBe(true);
  });

  it("rejects non-numeric coordinates with an Indonesian message", () => {
    const res = createCampusSchema.safeParse({ name: "K", lat: "abc" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe("Harus berupa angka");
  });

  it("update: same bounds, omitted stays omitted, null/blank clears", () => {
    expect(updateCampusSchema.safeParse({ lat: 91 }).success).toBe(false);
    expect(updateCampusSchema.safeParse({ lng: -181 }).success).toBe(false);
    expect(updateCampusSchema.parse({ status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(updateCampusSchema.parse({ lat: null, lng: "" })).toEqual({ lat: null, lng: null });
  });

  it("radiusMeters: optional, coerced from a string, bounded 10-1000 integers", () => {
    expect(createCampusSchema.parse({ name: "K" }).radiusMeters).toBeUndefined();
    expect(createCampusSchema.parse({ name: "K", radiusMeters: "" }).radiusMeters).toBeUndefined();
    expect(createCampusSchema.parse({ name: "K", radiusMeters: "75" }).radiusMeters).toBe(75);
    expect(createCampusSchema.parse({ name: "K", radiusMeters: 10 }).radiusMeters).toBe(10);
    expect(createCampusSchema.parse({ name: "K", radiusMeters: 1000 }).radiusMeters).toBe(1000);
    for (const bad of [9, 1001, 0, -5, 50.5, "abc"]) {
      expect(createCampusSchema.safeParse({ name: "K", radiusMeters: bad }).success).toBe(false);
    }
    const res = updateCampusSchema.safeParse({ radiusMeters: 5 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0].message).toBe("Radius minimal 10 meter");
    expect(updateCampusSchema.parse({ radiusMeters: "120" })).toEqual({ radiusMeters: 120 });
    // PUT { status } must not touch the radius.
    expect(updateCampusSchema.parse({ status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
  });
});

it("rejects whitespace campus update names", () => {
  expect(updateCampusSchema.safeParse({ name: "   " }).success).toBe(false);
});
