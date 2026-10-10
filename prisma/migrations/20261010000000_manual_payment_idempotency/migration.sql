-- Nullable fields preserve existing manual and gateway payments.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Payment" ADD COLUMN "requestHash" TEXT;
CREATE UNIQUE INDEX "Payment_invoiceId_idempotencyKey_key" ON "Payment"("invoiceId", "idempotencyKey");
