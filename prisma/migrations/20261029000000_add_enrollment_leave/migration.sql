-- EnrollmentLeave (Cuti siswa) — docs/cycles/2026-10-29-student-enrollment-leave.md
--
-- An admin pauses billing for one enrollment for whole months ("YYYY-MM", inclusive).
-- The bulk billing run skips an enrollment while an ACTIVE leave covers its month.
-- Cancel-only: status flips to INACTIVE with cancelledBy/cancelledAt, rows are never deleted.
--
-- Additive only: one new table, no ALTER on existing ones.

CREATE TABLE "EnrollmentLeave" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "EnrollmentLeave_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EnrollmentLeave_tenantId_status_idx"
    ON "EnrollmentLeave"("tenantId", "status");
CREATE INDEX "EnrollmentLeave_enrollmentId_status_idx"
    ON "EnrollmentLeave"("enrollmentId", "status");
CREATE INDEX "EnrollmentLeave_studentId_idx"
    ON "EnrollmentLeave"("studentId");

ALTER TABLE "EnrollmentLeave" ADD CONSTRAINT "EnrollmentLeave_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentLeave" ADD CONSTRAINT "EnrollmentLeave_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentLeave" ADD CONSTRAINT "EnrollmentLeave_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: service_role (Prisma) full access; app-layer filters carry tenantId.
ALTER TABLE "EnrollmentLeave" ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollmentleave_service_all ON "EnrollmentLeave"
    AS PERMISSIVE FOR ALL TO service_role USING (true);
