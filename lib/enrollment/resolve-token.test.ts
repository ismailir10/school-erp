import { describe, it, expect, vi } from "vitest";

// resolve-token.ts imports prisma (@/lib/db) at module load for the DB-backed
// resolver; the pure classifier under test needs no DB. Mock it so importing
// the module doesn't require DATABASE_URL.
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findUnique } } }));

import { classifyEnrollmentAccess, resolveEnrollmentAccess, resolveEnrollmentToken } from "./resolve-token";

const NOW = new Date("2026-06-23T00:00:00.000Z");

describe("classifyEnrollmentAccess", () => {
  it("NOT_FOUND for a missing row", () => {
    expect(classifyEnrollmentAccess(null, NOW)).toBe("NOT_FOUND");
  });

  it("OK for an unexpired INVITED row", () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    expect(classifyEnrollmentAccess({ id: "a", status: "INVITED", tokenExpiresAt: future }, NOW)).toBe("OK");
  });

  it("OK when INVITED and no expiry set", () => {
    expect(classifyEnrollmentAccess({ id: "a", status: "INVITED", tokenExpiresAt: null }, NOW)).toBe("OK");
  });

  it("EXPIRED for an INVITED row past its TTL", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(classifyEnrollmentAccess({ id: "a", status: "INVITED", tokenExpiresAt: past }, NOW)).toBe("EXPIRED");
  });

  it("SUBMITTED once past INVITED, regardless of expiry", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(classifyEnrollmentAccess({ id: "a", status: "SUBMITTED", tokenExpiresAt: past }, NOW)).toBe("SUBMITTED");
    expect(classifyEnrollmentAccess({ id: "a", status: "ACCEPTED", tokenExpiresAt: null }, NOW)).toBe("SUBMITTED");
  });
});

describe("classifyEnrollmentAccess — pay-first (PAYMENT_REQUIRED)", () => {
  const future = new Date(NOW.getTime() + 86_400_000);
  const past = new Date(NOW.getTime() - 1000);
  const row = (over: Record<string, unknown> = {}) => ({ id: "a", status: "INVITED", tokenExpiresAt: future as Date | null, ...over });

  it("an INVITED row whose fee is UNPAID must pay first", () => {
    expect(classifyEnrollmentAccess(row({ fee: { status: "UNPAID" } }), NOW)).toBe("PAYMENT_REQUIRED");
    expect(classifyEnrollmentAccess(row({ fee: { status: "UNPAID" }, tokenExpiresAt: null }), NOW)).toBe("PAYMENT_REQUIRED");
  });

  it.each(["PAID", "WAIVED"])("a %s fee opens the form", (status) => {
    expect(classifyEnrollmentAccess(row({ fee: { status } }), NOW)).toBe("OK");
  });

  it("no fee row (a formulir sent before pay-first, or a free program) opens the form", () => {
    expect(classifyEnrollmentAccess(row({ fee: null }), NOW)).toBe("OK");
    expect(classifyEnrollmentAccess(row(), NOW)).toBe("OK");
  });

  it("an expired token is EXPIRED even when a fee is owed (staff resend a fresh link)", () => {
    expect(classifyEnrollmentAccess(row({ fee: { status: "UNPAID" }, tokenExpiresAt: past }), NOW)).toBe("EXPIRED");
  });

  it("a row past INVITED is SUBMITTED whatever its fee says", () => {
    expect(classifyEnrollmentAccess(row({ status: "SUBMITTED", fee: { status: "UNPAID" } }), NOW)).toBe("SUBMITTED");
    expect(classifyEnrollmentAccess(row({ status: "REJECTED", fee: { status: "UNPAID" } }), NOW)).toBe("SUBMITTED");
  });

  it("a miss is NOT_FOUND", () => {
    expect(classifyEnrollmentAccess(null, NOW)).toBe("NOT_FOUND");
  });
});

describe("resolveEnrollmentAccess / resolveEnrollmentToken read the fee status in the same query", () => {
  const future = new Date(Date.now() + 86_400_000);

  it("access: selects the fee status and reports PAYMENT_REQUIRED + hasFee for an unpaid fee", async () => {
    findUnique.mockResolvedValue({ id: "a", tenantId: "t-1", status: "INVITED", tokenExpiresAt: future, fee: { status: "UNPAID" } });
    expect(await resolveEnrollmentAccess("tok", new Date())).toEqual({ access: "PAYMENT_REQUIRED", id: "a", tenantId: "t-1", hasFee: true });
    expect(findUnique.mock.calls[0][0].select.fee).toEqual({ select: { status: true } });
  });

  it("access: a settled fee is OK and still hasFee (program stays locked)", async () => {
    findUnique.mockResolvedValue({ id: "a", tenantId: "t-1", status: "INVITED", tokenExpiresAt: future, fee: { status: "PAID" } });
    expect(await resolveEnrollmentAccess("tok", new Date())).toMatchObject({ access: "OK", hasFee: true });
  });

  it("access: no fee row is OK with hasFee false; a miss is NOT_FOUND", async () => {
    findUnique.mockResolvedValue({ id: "a", tenantId: "t-1", status: "INVITED", tokenExpiresAt: future, fee: null });
    expect(await resolveEnrollmentAccess("tok", new Date())).toMatchObject({ access: "OK", hasFee: false });
    findUnique.mockResolvedValue(null);
    expect(await resolveEnrollmentAccess("nope", new Date())).toEqual({ access: "NOT_FOUND", id: null, tenantId: null, hasFee: false });
  });

  it("token: the same classification, and the fee never reaches `application` (it goes to the client component)", async () => {
    findUnique.mockResolvedValue({
      id: "a", tenantId: "t-1", status: "INVITED", childName: "", parentEmail: null, programId: "p", dcareAddon: false,
      tokenExpiresAt: future, studentData: {}, ayahData: {}, ibuData: {}, consentData: {}, documents: {}, fee: { status: "UNPAID" },
      admission: { status: "CANCELLED" },
    });
    const out = await resolveEnrollmentToken("tok", new Date());
    expect(out.access).toBe("PAYMENT_REQUIRED");
    expect(out.tenantId).toBe("t-1");
    expect(out.application).not.toHaveProperty("fee");
    expect(out.application).not.toHaveProperty("tenantId");
    // Only the lead's status rides along (for isFeeClosed), nothing of its contact data.
    expect(out.application?.admission).toEqual({ status: "CANCELLED" });
    expect(findUnique.mock.calls[0][0].select.admission).toEqual({ select: { status: true } });
    expect(findUnique.mock.calls[0][0].select.fee).toEqual({ select: { status: true } });
  });
});
