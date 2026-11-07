-- Geofenced staff check-in (docs/cycles/2026-11-07-attendance-geofence-gate.md).
--
-- Additive only: one defaulted column on Campus and nine nullable/defaulted
-- columns on AttendanceRecord. Existing rows default to approvalStatus
-- 'APPROVED' and source 'SELF', so payroll and history are unchanged.

-- AlterTable
ALTER TABLE "Campus" ADD COLUMN     "radiusMeters" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "checkInAccuracy" INTEGER,
ADD COLUMN     "checkInNote" TEXT,
ADD COLUMN     "distanceMeters" INTEGER,
ADD COLUMN     "nearestCampusId" TEXT,
ADD COLUMN     "recordedBy" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SELF';

-- CreateIndex
CREATE INDEX "AttendanceRecord_approvalStatus_idx" ON "AttendanceRecord"("approvalStatus");
