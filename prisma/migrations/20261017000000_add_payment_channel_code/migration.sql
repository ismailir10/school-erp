-- Cycle 2026-10-17 expired-link-overdue (T5).
-- The gateway rail a payment came in on (DOKU `channel.id`, e.g. VIRTUAL_ACCOUNT_BCA),
-- so the invoice and the ledger can say "Virtual Account BCA" instead of one generic
-- label for every DOKU payment. Additive, nullable, no backfill: payments made before
-- this keep the generic label.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "channelCode" TEXT;
