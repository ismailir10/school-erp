-- Cycle 2026-10-10 pendaftaran-fee-payment (T5).
-- Remember when the stored gateway paymentUrl stops working, so the public /pay
-- route can hand the same link back until then instead of asking the gateway for
-- a second order under the same reference. Additive, nullable: no backfill, and
-- no EnrollmentFee row can hold a session yet (the table shipped one migration
-- earlier in this same cycle).

-- AlterTable
ALTER TABLE "EnrollmentFee" ADD COLUMN "sessionExpiresAt" TIMESTAMP(3);
