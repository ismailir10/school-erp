-- Cycle 2026-10-17 payment-link-reminders (T4).
-- Bookkeeping for the WhatsApp reminder queue: when an admin last opened a reminder for
-- the invoice, which admin (a User id, a plain actor id like createdBy, not an FK), and
-- how many times. The app only opens WhatsApp, so this records "diingatkan", not
-- "terkirim". Additive, nullable (count defaults to 0), no backfill: invoices reminded
-- before this have no history to restore.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "lastRemindedAt" TIMESTAMP(3),
ADD COLUMN "lastRemindedBy" TEXT,
ADD COLUMN "remindCount" INTEGER NOT NULL DEFAULT 0;
