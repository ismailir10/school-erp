ALTER TABLE "Tenant" ADD COLUMN "enrollmentRequiredDocuments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
