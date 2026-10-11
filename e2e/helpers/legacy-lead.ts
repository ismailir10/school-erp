import { Client } from "pg";

/**
 * Legacy lead fixtures.
 *
 * Since cycle 2026-10-11-pendaftaran-simplify the API only writes Baru (INQUIRY) and
 * Batal (CANCELLED): the old visit steps can no longer be reached through a PUT. Rows
 * stored before that cycle still hold them, and the contract is that they READ as Baru
 * and keep working (nothing is rewritten). The only way to get such a row is to write
 * the stored status the way the old app did, so this goes straight to the database.
 *
 * The same local-database guard as playwright.config.ts: these specs run against a
 * disposable Postgres, never a shared one.
 */
function localDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Legacy-lead fixture needs DATABASE_URL pointing at a local Postgres (got host "${host || "none"}"). ` +
        "Export it in the shell that runs Playwright.",
    );
  }
  return url;
}

/** Store a lead the way the pre-simplify app did (VISIT_SCHEDULED / VISITED / ADMITTED). */
export async function storeLegacyLeadStatus(
  admissionId: string,
  status: "VISIT_SCHEDULED" | "VISITED" | "ADMITTED",
): Promise<void> {
  const client = new Client({ connectionString: localDatabaseUrl() });
  await client.connect();
  try {
    const res = await client.query(`UPDATE "Admission" SET status = $1 WHERE id = $2`, [
      status,
      admissionId,
    ]);
    if (res.rowCount !== 1) throw new Error(`Admission ${admissionId} not found`);
  } finally {
    await client.end();
  }
}
