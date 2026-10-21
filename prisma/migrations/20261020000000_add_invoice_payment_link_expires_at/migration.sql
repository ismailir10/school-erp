-- Cycle 2026-10-20 payment-link-expiry-display (T1).
-- When the invoice's CURRENT payment link stops working: the expiry the app
-- requested from the gateway, saved with the link. Additive, nullable, no
-- default, no backfill: links made before this ships keep NULL ("not recorded")
-- until they are next replaced. Cleared wherever the link is cleared.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "paymentLinkExpiresAt" TIMESTAMP(3);
