-- Sentra + Putaran (docs/cycles/2026-11-06-sentra-rotation.md).
--
-- Sentra become per-campus data (replacing the fixed LearningCenter list as the
-- source for Sentra Harian), with guru sentra and a putaran (rotation) grid that
-- says which class visits which sentra on which school day.
--
-- Additive only: five new tables, one nullable column + FK on AssessmentEntry
-- (the existing `center` column and unique key are untouched), and one data
-- insert that gives every existing campus the 8 legacy sentra so Sentra Harian
-- looks the same on day one. No existing row is changed or deleted.

-- AlterTable
ALTER TABLE "AssessmentEntry" ADD COLUMN     "sentraId" TEXT;

-- CreateTable
CREATE TABLE "Sentra" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legacyCenter" "LearningCenter",
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sentra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentraTeacher" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sentraId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentraTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentraRotation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campusId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "cycleDays" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SentraRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentraRotationClass" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "classSectionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SentraRotationClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentraRotationSlot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "dayIndex" INTEGER NOT NULL,
    "classSectionId" TEXT NOT NULL,
    "sentraId" TEXT NOT NULL,

    CONSTRAINT "SentraRotationSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sentra_tenantId_campusId_status_idx" ON "Sentra"("tenantId", "campusId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sentra_campusId_name_key" ON "Sentra"("campusId", "name");

-- CreateIndex
CREATE INDEX "SentraTeacher_tenantId_employeeId_idx" ON "SentraTeacher"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SentraTeacher_sentraId_employeeId_key" ON "SentraTeacher"("sentraId", "employeeId");

-- CreateIndex
CREATE INDEX "SentraRotation_tenantId_campusId_idx" ON "SentraRotation"("tenantId", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "SentraRotation_academicYearId_campusId_name_key" ON "SentraRotation"("academicYearId", "campusId", "name");

-- CreateIndex
CREATE INDEX "SentraRotationClass_classSectionId_idx" ON "SentraRotationClass"("classSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SentraRotationClass_rotationId_classSectionId_key" ON "SentraRotationClass"("rotationId", "classSectionId");

-- CreateIndex
CREATE INDEX "SentraRotationSlot_tenantId_sentraId_idx" ON "SentraRotationSlot"("tenantId", "sentraId");

-- CreateIndex
CREATE INDEX "SentraRotationSlot_classSectionId_idx" ON "SentraRotationSlot"("classSectionId");

-- CreateIndex
CREATE UNIQUE INDEX "SentraRotationSlot_rotationId_dayIndex_classSectionId_key" ON "SentraRotationSlot"("rotationId", "dayIndex", "classSectionId");

-- CreateIndex
CREATE INDEX "AssessmentEntry_sentraId_idx" ON "AssessmentEntry"("sentraId");

-- AddForeignKey
ALTER TABLE "AssessmentEntry" ADD CONSTRAINT "AssessmentEntry_sentraId_fkey" FOREIGN KEY ("sentraId") REFERENCES "Sentra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sentra" ADD CONSTRAINT "Sentra_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraTeacher" ADD CONSTRAINT "SentraTeacher_sentraId_fkey" FOREIGN KEY ("sentraId") REFERENCES "Sentra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraTeacher" ADD CONSTRAINT "SentraTeacher_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotation" ADD CONSTRAINT "SentraRotation_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotation" ADD CONSTRAINT "SentraRotation_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotationClass" ADD CONSTRAINT "SentraRotationClass_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "SentraRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotationClass" ADD CONSTRAINT "SentraRotationClass_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotationSlot" ADD CONSTRAINT "SentraRotationSlot_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "SentraRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotationSlot" ADD CONSTRAINT "SentraRotationSlot_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentraRotationSlot" ADD CONSTRAINT "SentraRotationSlot_sentraId_fkey" FOREIGN KEY ("sentraId") REFERENCES "Sentra"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant-scoped tables: RLS on, service_role passthrough, matching every other
-- tenant-scoped table in this schema (scripts/verify-rls-coverage.sh enforces
-- that both statements exist).
ALTER TABLE "Sentra" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sentra_service_all ON "Sentra"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

ALTER TABLE "SentraTeacher" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sentrateacher_service_all ON "SentraTeacher"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

ALTER TABLE "SentraRotation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sentrarotation_service_all ON "SentraRotation"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

ALTER TABLE "SentraRotationClass" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sentrarotationclass_service_all ON "SentraRotationClass"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

ALTER TABLE "SentraRotationSlot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY sentrarotationslot_service_all ON "SentraRotationSlot"
    AS PERMISSIVE FOR ALL TO service_role USING (true);

-- Day-one data: every campus gets the 8 legacy sentra (mirrors lib/sentra/legacy.ts).
INSERT INTO "Sentra" ("id", "tenantId", "campusId", "name", "legacyCenter", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c."id", l."name", l."legacyCenter"::"LearningCenter", l."sortOrder", CURRENT_TIMESTAMP
FROM "Campus" c
CROSS JOIN (VALUES
    ('Ibadah', 'WORSHIP', 1),
    ('Bahan Alam', 'NATURAL_MATERIALS', 2),
    ('Seni', 'ART', 3),
    ('Memasak', 'COOKING', 4),
    ('Main Peran', 'ROLE_PLAY', 5),
    ('Balok', 'BLOCKS', 6),
    ('Persiapan', 'PREPARATION', 7),
    ('Area', 'AREA', 8)
) AS l("name", "legacyCenter", "sortOrder")
ON CONFLICT ("campusId", "name") DO NOTHING;
