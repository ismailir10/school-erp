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

describe("classifyEnrollmentAccess — the fee never gates the form (pay after submit)", () => {
  const future = new Date(NOW.getTime() + 86_400_000);
  const past = new Date(NOW.getTime() - 1000);
  const row = (over: Record<string, unknown> = {}) => ({ id: "a", status: "INVITED", tokenExpiresAt: future as Date | null, ...over });

  it.each(["UNPAID", "PAID", "WAIVED"])("an INVITED row with a %s fee opens the form", (status) => {
    expect(classifyEnrollmentAccess(row({ fee: { status } }), NOW)).toBe("OK");
    expect(classifyEnrollmentAccess(row({ fee: { status }, tokenExpiresAt: null }), NOW)).toBe("OK");
  });

  it("no fee row opens the form", () => {
    expect(classifyEnrollmentAccess(row({ fee: null }), NOW)).toBe("OK");
    expect(classifyEnrollmentAccess(row(), NOW)).toBe("OK");
  });

  it("an expired token is EXPIRED whatever the fee says (staff resend a fresh link)", () => {
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

describe("resolveEnrollmentAccess / resolveEnrollmentToken", () => {
  const future = new Date(Date.now() + 86_400_000);

  it("access: an INVITED row with an UNPAID fee (sent under pay-first) is OK, and the fee is not even read", async () => {
    findUnique.mockResolvedValue({ id: "a", tenantId: "t-1", status: "INVITED", tokenExpiresAt: future, fee: { status: "UNPAID" } });
    expect(await resolveEnrollmentAccess("tok", new Date())).toEqual({ access: "OK", id: "a", tenantId: "t-1" });
    expect(findUnique.mock.calls[0][0].select).toEqual({ id: true, status: true, tokenExpiresAt: true, tenantId: true });
  });

  it("access: a miss is NOT_FOUND", async () => {
    findUnique.mockResolvedValue(null);
    expect(await resolveEnrollmentAccess("nope", new Date())).toEqual({ access: "NOT_FOUND", id: null, tenantId: null });
  });

  it("token: an UNPAID fee still opens the form, and neither fee nor tenantId reaches `application`", async () => {
    findUnique.mockResolvedValue({
      id: "a", tenantId: "t-1", status: "INVITED", childName: "", parentEmail: null, programId: "p", dcareAddon: false,
      tokenExpiresAt: future, studentData: {}, ayahData: {}, ibuData: {}, consentData: {}, documents: {}, fee: { status: "UNPAID" },
      admission: { status: "CANCELLED" },
    });
    const out = await resolveEnrollmentToken("tok", new Date());
    expect(out.access).toBe("OK");
    expect(out.tenantId).toBe("t-1");
    expect(out.application).not.toHaveProperty("tenantId");
    // Only the lead's status rides along (for isFeeClosed), nothing of its contact data.
    expect(out.application?.admission).toEqual({ status: "CANCELLED" });
    expect(findUnique.mock.calls[0][0].select.admission).toEqual({ select: { status: true } });
    expect(findUnique.mock.calls[0][0].select).not.toHaveProperty("fee");
  });
});
