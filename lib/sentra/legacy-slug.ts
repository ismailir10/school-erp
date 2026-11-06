import { ALL_LEARNING_CENTERS, type LearningCenterKey } from "@/lib/format";

/**
 * Old Sentra Harian URLs were `/teacher/assessments/center/worship` (lowercase
 * enum value). Returns the enum key for such a slug, else null (the segment is
 * then treated as a Sentra id).
 */
export function legacyCenterFromSlug(slug: string): LearningCenterKey | null {
  if (slug !== slug.toLowerCase()) return null;
  const upper = slug.toUpperCase();
  return (ALL_LEARNING_CENTERS as ReadonlyArray<string>).includes(upper)
    ? (upper as LearningCenterKey)
    : null;
}
