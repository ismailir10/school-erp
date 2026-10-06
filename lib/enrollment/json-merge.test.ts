import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeRaw } = vi.hoisted(() => ({ executeRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $executeRaw: executeRaw } }));

import { mergeJsonKey, removeJsonFields, writeConsentPreservingSignatures } from "./json-merge";

// $executeRaw receives a Prisma.Sql — `.sql` has $n placeholders, `.values` the bound params.
function lastSql(): { sql: string; values: unknown[] } {
  const arg = executeRaw.mock.calls.at(-1)![0] as { sql: string; values: unknown[] };
  return { sql: arg.sql.replace(/\s+/g, " "), values: arg.values };
}

beforeEach(() => {
  vi.clearAllMocks();
  executeRaw.mockResolvedValue(1);
});

describe("mergeJsonKey", () => {
  it("adds the INVITED guard when requireInvited, and binds every value", async () => {
    const ok = await mergeJsonKey("ea-1", "consentData", "ayah", { signatureToken: "t" }, { requireInvited: true });
    expect(ok).toBe(true);
    const { sql, values } = lastSql();
    expect(sql).toContain(`UPDATE "EnrollmentApplication"`);
    expect(sql).toContain(`"consentData"`);
    expect(sql).toContain("AND status = 'INVITED'");
    expect(sql).toContain(`"updatedAt" = now()`);
    expect(values).toContain("ea-1");
    expect(values).toContain("ayah");
    expect(values).toContain(JSON.stringify({ signatureToken: "t" }));
    // user-supplied strings never appear in the SQL text
    expect(sql).not.toContain("ea-1");
    expect(sql).not.toContain("signatureToken");
  });

  it("omits the status guard when requireInvited is false", async () => {
    await mergeJsonKey("ea-1", "documents", "kk", { receivedPhysical: true }, { requireInvited: false });
    const { sql } = lastSql();
    expect(sql).toContain(`"documents"`);
    expect(sql).not.toContain("status = 'INVITED'");
  });

  it("returns false when no row matched", async () => {
    executeRaw.mockResolvedValue(0);
    expect(await mergeJsonKey("ea-1", "documents", "kk", {}, { requireInvited: true })).toBe(false);
  });

  it("refuses a column outside the whitelist", async () => {
    await expect(
      mergeJsonKey("ea-1", 'consentData"; DROP TABLE x; --' as never, "k", {}, { requireInvited: true }),
    ).rejects.toThrow(/Unsupported JSON column/);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("removeJsonFields", () => {
  it("binds the field list and honours the status guard", async () => {
    const ok = await removeJsonFields("ea-1", "documents", "akta", ["fileToken", "fileName"], { requireInvited: true });
    expect(ok).toBe(true);
    const { sql, values } = lastSql();
    expect(sql).toContain("AND status = 'INVITED'");
    expect(sql).toContain("jsonb_typeof");
    expect(values).toContainEqual(["fileToken", "fileName"]);
  });

  it("returns false on 0 rows", async () => {
    executeRaw.mockResolvedValue(0);
    expect(await removeJsonFields("ea-1", "documents", "akta", ["fileToken"], { requireInvited: true })).toBe(false);
  });
});

describe("writeConsentPreservingSignatures", () => {
  it("always guards on INVITED and carries stored tokens over", async () => {
    const incoming = { agreed: true, ayah: { name: "A" }, ibu: { name: "B" } };
    expect(await writeConsentPreservingSignatures("ea-1", incoming)).toBe(true);
    const { sql, values } = lastSql();
    expect(sql).toContain("AND status = 'INVITED'");
    expect(sql).toContain(`"consentData" -> 'ayah' -> 'signatureToken'`);
    expect(sql).toContain(`"consentData" -> 'ibu' -> 'signatureToken'`);
    expect(values).toContain(JSON.stringify(incoming));
  });

  it("returns false on 0 rows", async () => {
    executeRaw.mockResolvedValue(0);
    expect(await writeConsentPreservingSignatures("ea-1", { ayah: {}, ibu: {} })).toBe(false);
  });
});
