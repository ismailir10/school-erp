-- StudentJournalDayMark — "Hari tanpa buku penghubung"
-- (docs/cycles/2026-10-27-journal-no-entry-day.md).
--
-- One row marks a whole class-day as not using the buku penghubung on purpose
-- (swimming, an outing) and carries the short keterangan the wali reads in that
-- day's column. Existing StudentJournalEntry rows on that day are left alone.
--
-- Additive only: one new table, no ALTER on any existing table, no backfill.

CREATE TABLE "StudentJournalDayMark" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "classSectionId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "markedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentJournalDayMark_pkey" PRIMARY KEY ("id")
);

-- One mark per class per date; the upsert on save keys off this.
CREATE UNIQUE INDEX "StudentJournalDayMark_classSectionId_date_key"
    ON "StudentJournalDayMark"("classSectionId", "date");

CREATE INDEX "StudentJournalDayMark_tenantId_classSectionId_date_idx"
    ON "StudentJournalDayMark"("tenantId", "classSectionId", "date");

-- Tenant-scoped table: RLS on, service_role passthrough, matching every other
-- tenant-scoped table in this schema (scripts/verify-rls-coverage.sh enforces
-- that both statements exist).
ALTER TABLE "StudentJournalDayMark" ENABLE ROW LEVEL SECURITY;
CREATE POLICY studentjournaldaymark_service_all ON "StudentJournalDayMark"
    AS PERMISSIVE FOR ALL TO service_role USING (true);
