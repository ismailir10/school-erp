import type { LearningCenterKey } from "@/lib/format";

/**
 * The old fixed learning-center list as per-campus Sentra rows. The migration
 * (20261106000000_add_sentra) inserts these for every existing campus; the seed
 * reuses them. Keep the three in sync.
 */
export const LEGACY_SENTRA: ReadonlyArray<{
  name: string;
  legacyCenter: LearningCenterKey;
  sortOrder: number;
}> = [
  { name: "Ibadah", legacyCenter: "WORSHIP", sortOrder: 1 },
  { name: "Bahan Alam", legacyCenter: "NATURAL_MATERIALS", sortOrder: 2 },
  { name: "Seni", legacyCenter: "ART", sortOrder: 3 },
  { name: "Memasak", legacyCenter: "COOKING", sortOrder: 4 },
  { name: "Main Peran", legacyCenter: "ROLE_PLAY", sortOrder: 5 },
  { name: "Balok", legacyCenter: "BLOCKS", sortOrder: 6 },
  { name: "Persiapan", legacyCenter: "PREPARATION", sortOrder: 7 },
  { name: "Area", legacyCenter: "AREA", sortOrder: 8 },
];
