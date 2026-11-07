/**
 * Geofence for staff check-in (docs/cycles/2026-11-07-attendance-geofence-gate.md).
 *
 * A fix is "inside" when the distance to the nearest campus, reduced by the
 * reported GPS accuracy (capped at ACCURACY_CAP_METERS so a 2 km fix never
 * passes), is within that campus's radius.
 */

export const ACCURACY_CAP_METERS = 100;
export const DEFAULT_RADIUS_METERS = 50;

export type GeoPoint = { lat: number; lng: number; accuracy?: number | null };

export type GeofenceCampus = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
};

export type GeofenceResult =
  | { skipped: true }
  | {
      skipped?: false;
      inside: boolean;
      /** Rounded metres to the nearest campus; null when no location was given. */
      distanceMeters: number | null;
      nearestCampus: { id: string; name: string };
    };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function evaluateGeofence(
  location: GeoPoint | null,
  campuses: GeofenceCampus[],
): GeofenceResult {
  // Prisma Decimal columns arrive as Decimal objects; Number() handles both.
  const pinned = campuses
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({ campus: c, lat: Number(c.lat), lng: Number(c.lng) }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  if (pinned.length === 0) return { skipped: true };

  if (!location) {
    // No fix: report the first pinned campus so the UI can still name one.
    const first = pinned[0].campus;
    return { inside: false, distanceMeters: null, nearestCampus: { id: first.id, name: first.name } };
  }

  let best = pinned[0];
  let bestDistance = Infinity;
  for (const p of pinned) {
    const d = haversineMeters(location.lat, location.lng, p.lat, p.lng);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }

  const allowance = Math.min(Math.max(location.accuracy ?? 0, 0), ACCURACY_CAP_METERS);
  const radius = best.campus.radiusMeters ?? DEFAULT_RADIUS_METERS;
  return {
    inside: bestDistance - allowance <= radius,
    distanceMeters: Math.round(bestDistance),
    nearestCampus: { id: best.campus.id, name: best.campus.name },
  };
}
