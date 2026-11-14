ALTER TABLE "Invoice" ADD COLUMN "manualRequestKey" TEXT, ADD COLUMN "manualRequestHash" TEXT;
CREATE UNIQUE INDEX "Invoice_tenantId_manualRequestKey_key" ON "Invoice"("tenantId", "manualRequestKey");
