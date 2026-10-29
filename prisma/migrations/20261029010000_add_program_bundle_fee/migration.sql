-- ProgramBundleFee (Harga paket sekolah + daycare) — docs/cycles/2026-10-29-school-daycare-bundle-price.md
--
-- One price for the whole "school + daycare" bundle of a fee component, per school program x daycare
-- program x academic year. The billing builder uses it instead of summing the two programs' fees when
-- a student's billed placements include both programs. Clearing a price sets status to INACTIVE.
--
-- Additive only: one new table, no ALTER on existing ones.

CREATE TABLE "ProgramBundleFee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "schoolProgramId" TEXT NOT NULL,
    "daycareProgramId" TEXT NOT NULL,
    "feeComponentId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramBundleFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramBundleFee_pair_year_component_key"
    ON "ProgramBundleFee"("schoolProgramId", "daycareProgramId", "academicYearId", "feeComponentId");
CREATE INDEX "ProgramBundleFee_tenantId_academicYearId_status_idx"
    ON "ProgramBundleFee"("tenantId", "academicYearId", "status");

ALTER TABLE "ProgramBundleFee" ADD CONSTRAINT "ProgramBundleFee_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramBundleFee" ADD CONSTRAINT "ProgramBundleFee_academicYearId_fkey"
    FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramBundleFee" ADD CONSTRAINT "ProgramBundleFee_schoolProgramId_fkey"
    FOREIGN KEY ("schoolProgramId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramBundleFee" ADD CONSTRAINT "ProgramBundleFee_daycareProgramId_fkey"
    FOREIGN KEY ("daycareProgramId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramBundleFee" ADD CONSTRAINT "ProgramBundleFee_feeComponentId_fkey"
    FOREIGN KEY ("feeComponentId") REFERENCES "FeeComponentDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: service_role (Prisma) full access; app-layer filters carry tenantId.
ALTER TABLE "ProgramBundleFee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY programbundlefee_service_all ON "ProgramBundleFee"
    AS PERMISSIVE FOR ALL TO service_role USING (true);
