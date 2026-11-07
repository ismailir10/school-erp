import { describe, it, expect } from "vitest";
import { evaluateGeofence, haversineMeters } from "../geofence";

const campus = { id: "c1", name: "Taman Aster", lat: -6.2, lng: 106.8, radiusMeters: 50 };
// ~0.001 deg latitude ≈ 111 m
const at = (dLat: number, accuracy?: number) => ({ lat: -6.2 + dLat, lng: 106.8, accuracy });

describe("haversineMeters", () => {
  it("is 0 for the same point and ~111 m per 0.001 deg latitude", () => {
    expect(haversineMeters(-6.2, 106.8, -6.2, 106.8)).toBe(0);
    expect(haversineMeters(-6.2, 106.8, -6.199, 106.8)).toBeGreaterThan(110);
    expect(haversineMeters(-6.2, 106.8, -6.199, 106.8)).toBeLessThan(112);
  });
});

describe("evaluateGeofence", () => {
  it("skips when no campus has coordinates", () => {
    expect(evaluateGeofence(at(0), [{ ...campus, lat: null, lng: null }])).toEqual({ skipped: true });
    expect(evaluateGeofence(null, [])).toEqual({ skipped: true });
  });

  it("is inside at the pin", () => {
    const r = evaluateGeofence(at(0), [campus]);
    expect(r).toMatchObject({ inside: true, distanceMeters: 0, nearestCampus: { id: "c1", name: "Taman Aster" } });
  });

  it("is outside beyond the radius", () => {
    const r = evaluateGeofence(at(0.001), [campus]);
    expect(r).toMatchObject({ inside: false, distanceMeters: 111 });
  });

  it("lets accuracy widen the radius", () => {
    expect(evaluateGeofence(at(0.001, 70), [campus])).toMatchObject({ inside: true });
  });

  it("caps the accuracy allowance at 100 m", () => {
    // ~222 m away, claimed accuracy 2000 m: allowance 100 → 122 > 50
    expect(evaluateGeofence(at(0.002, 2000), [campus])).toMatchObject({ inside: false });
  });

  it("respects a per-campus radius", () => {
    expect(evaluateGeofence(at(0.001), [{ ...campus, radiusMeters: 150 }])).toMatchObject({ inside: true });
  });

  it("picks the nearest pinned campus and ignores unpinned ones", () => {
    const far = { id: "c2", name: "Far", lat: -6.3, lng: 106.9, radiusMeters: 50 };
    const unpinned = { id: "c3", name: "None", lat: null, lng: null, radiusMeters: 50 };
    const r = evaluateGeofence(at(0.0001), [far, unpinned, campus]);
    expect(r).toMatchObject({ inside: true, nearestCampus: { id: "c1" } });
  });

  it("treats a missing location as outside with null distance", () => {
    expect(evaluateGeofence(null, [campus])).toEqual({
      inside: false,
      distanceMeters: null,
      nearestCampus: { id: "c1", name: "Taman Aster" },
    });
  });

  it("accepts Decimal-like coordinates", () => {
    const dec = { ...campus, lat: { toString: () => "-6.2", valueOf: () => -6.2 } as unknown as number, lng: 106.8 };
    expect(evaluateGeofence(at(0), [dec])).toMatchObject({ inside: true });
  });
});
