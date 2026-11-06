-- Theme gets an optional kelompok (TK A / TK B). NULL = shared by both.
-- Additive: existing rows stay NULL (shared), so behaviour is unchanged.
ALTER TABLE "Theme" ADD COLUMN "ageGroup" "AgeGroup";

-- Name uniqueness moves from per-semester to per-semester-per-kelompok.
-- NULLS NOT DISTINCT (Postgres 15+) keeps two shared themes from sharing a name.
DROP INDEX "Theme_tenantId_semesterId_name_key";
CREATE UNIQUE INDEX "Theme_tenantId_semesterId_ageGroup_name_key"
  ON "Theme"("tenantId", "semesterId", "ageGroup", "name") NULLS NOT DISTINCT;
