-- Cycle 2026-10-23 reminder-template.
-- The school's own text for the unpaid-invoice WhatsApp reminder, edited by admins in
-- Pengaturan. Null means "use the built-in message", so existing schools see no change.
-- Additive, nullable, no backfill.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "invoiceReminderTemplate" TEXT;
