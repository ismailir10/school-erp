/**
 * One reading of a stored pendaftaran address. The JSON blobs hold eight
 * optional string keys per address (`studentData.address`, `ayahData.address`,
 * `ibuData.address`); the staff formulir view, the parent's Tinjau step and the
 * Student / Parent address text made on convert all go through `formatAddress`,
 * so they cannot drift.
 *
 * Pure and client-safe (no server imports). Old blobs lack `kelurahan`,
 * `kotaKab` and `provinsi`; a missing key is simply skipped, so an old address
 * reads exactly as it did before those keys existed.
 */

/** Reading order, street to region, kode pos last. `rtRw` is joined as stored. */
const JOIN_ORDER = ["perumahan", "blokCluster", "rtRw", "kelurahan", "kecamatan", "kotaKab", "provinsi", "kodePos"] as const;

/**
 * "Jl. Mawar, Blok A, 01/02, Citarum, Bandung Wetan, Kota Bandung, Jawa Barat, 40115",
 * or null when there is nothing to show. Tolerates anything (null, arrays, numbers).
 */
export function formatAddress(address: unknown): string | null {
  if (!address || typeof address !== "object" || Array.isArray(address)) return null;
  const a = address as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of JOIN_ORDER) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  return parts.join(", ") || null;
}
