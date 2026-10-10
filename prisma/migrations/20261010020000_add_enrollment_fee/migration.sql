-- Cycle 2026-10-10 pendaftaran-fee-payment (T1).
-- Per-program pendaftaran fee + a 1:1 EnrollmentFee record that tracks the
-- parent's payment (DOKU) or the staff settlement (cash / transfer / waiver).
-- Additive: one defaulted column and one new table. Program.enrollmentFee is 0
-- everywhere on deploy, so no application is charged until staff set amounts.

-- AlterTable
ALTER TABLE "Program" ADD COLUMN "enrollmentFee" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EnrollmentFee" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "baseAmount" DECIMAL(15,2) NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "method" TEXT,
    "paymentId" TEXT,
    "gatewaySessionId" TEXT,
    "paymentUrl" TEXT,
    "linkError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "markedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnrollmentFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentFee_applicationId_key" ON "EnrollmentFee"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentFee_paymentId_key" ON "EnrollmentFee"("paymentId");

-- CreateIndex
CREATE INDEX "EnrollmentFee_tenantId_status_idx" ON "EnrollmentFee"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "EnrollmentFee" ADD CONSTRAINT "EnrollmentFee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentFee" ADD CONSTRAINT "EnrollmentFee_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "EnrollmentApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: service-role-only, mirrors EnrollmentApplication. The public token routes
-- gate on the unguessable accessToken; admin routes gate on requireAdmin +
-- session.tenantId. No JWT caller ever reads this table directly.
ALTER TABLE "EnrollmentFee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY enrollmentfee_service_all ON "EnrollmentFee" AS PERMISSIVE FOR ALL TO service_role USING (true);
