-- Cycle 2026-10-16 payment-return-check (T1).
-- Stamped by every payment reconcile. Throttles the parent-triggered status
-- check (atomic claim) and lets the nightly sweep rotate least-recently-checked
-- first. Additive, nullable: no backfill; NULL sorts first, so every existing
-- invoice is polled before any already-checked one.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "paymentCheckedAt" TIMESTAMP(3);
