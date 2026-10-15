import { describe, it, expect, vi, beforeEach } from "vitest";

const { auditCreate } = vi.hoisted(() => ({ auditCreate: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { auditLog: { create: auditCreate }, program: { findMany: vi.fn() } } }));

import { AUTO_WAIVE_NOTE, createFeeSnapshot, repriceUnpaidFee } from "./fee-snapshot";

const PROGRAMS = [
  { id: "p-kb", code: "KB", name: "KB", enrollmentFee: 500_000 },
  { id: "p-dc", code: "DCARE", name: "Day Care", enrollmentFee: 200_000 },
  { id: "p-free", code: "FREE", name: "Gratis", enrollmentFee: 0 },
];

function fakeTx() {
  const feeCreate = vi.fn();
  const tx = {
    enrollmentFee: { create: feeCreate, findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    program: { findMany: vi.fn().mockResolvedValue(PROGRAMS) },
    auditLog: { create: auditCreate },
    $executeRaw: vi.fn(),
  };
  return { tx: tx as never, feeCreate, raw: tx };
}

beforeEach(() => vi.clearAllMocks());

describe("createFeeSnapshot", () => {
  it("snapshots program + Day Care add-on as an UNPAID row with no discount", async () => {
    const { tx, feeCreate } = fakeTx();
    const out = await createFeeSnapshot(tx, { tenantId: "t-1", applicationId: "a-1", programs: PROGRAMS, programId: "p-kb", dcareAddon: true });
    expect(out).toEqual({ baseAmount: 700_000, amount: 700_000, status: "UNPAID" });
    expect(feeCreate).toHaveBeenCalledWith({
      data: { tenantId: "t-1", applicationId: "a-1", baseAmount: 700_000, discountPercent: 0, amount: 700_000, status: "UNPAID" },
    });
  });

  it.each([
    ["a free program", "p-free"],
    ["no program", null],
    ["an unknown program", "p-nope"],
  ])("writes nothing for %s", async (_l, programId) => {
    const { tx, feeCreate } = fakeTx();
    expect(await createFeeSnapshot(tx, { tenantId: "t-1", applicationId: "a-1", programs: PROGRAMS, programId, dcareAddon: false })).toBeNull();
    expect(feeCreate).not.toHaveBeenCalled();
  });
});

describe("repriceUnpaidFee", () => {
  const unpaid = {
    status: "UNPAID", method: null, baseAmount: 500_000, discountPercent: 20, discountReason: "Yatim", amount: 400_000,
    paidAt: null, note: null, linkError: null, lastCheckedAt: null, paymentUrl: "https://x", sessionExpiresAt: new Date(Date.now() + 1000),
  };

  it("recomputes over the active fees keeping the staff percent", async () => {
    const { tx, raw } = fakeTx();
    raw.enrollmentFee.findFirst.mockResolvedValue({ id: "f-1" });
    raw.enrollmentFee.findUnique.mockResolvedValue(unpaid);
    raw.enrollmentFee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...unpaid, ...data }));
    const out = await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-kb", dcareAddon: true, actorId: "u-1" });
    expect(out.note).toBe("repriced");
    expect(out.fee).toMatchObject({ baseAmount: 700_000, amount: 560_000, discountPercent: 20 });
    expect(raw.enrollmentFee.findFirst.mock.calls[0][0].where).toEqual({ applicationId: "a-1", tenantId: "t-1" });
  });

  it("is a no-op with note 'none' when there is no fee", async () => {
    const { tx, raw } = fakeTx();
    raw.enrollmentFee.findFirst.mockResolvedValue(null);
    expect(await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-kb", dcareAddon: false, actorId: "u-1" })).toEqual({ note: "none", fee: null });
    expect(raw.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it("takes the advisory lock BEFORE reading the fee", async () => {
    const { tx, raw } = fakeTx();
    raw.enrollmentFee.findFirst.mockResolvedValue({ id: "f-1" });
    raw.enrollmentFee.findUnique.mockResolvedValue(unpaid);
    raw.enrollmentFee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...unpaid, ...data }));
    await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-kb", dcareAddon: true, actorId: "u-1" });
    expect(raw.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(raw.enrollmentFee.findUnique.mock.invocationCallOrder[0]);
    expect(raw.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(raw.enrollmentFee.update.mock.invocationCallOrder[0]);
  });

  it("leaves the fee alone for a retired program instead of waiving it", async () => {
    const { tx, raw } = fakeTx();
    raw.enrollmentFee.findFirst.mockResolvedValue({ id: "f-1" });
    raw.enrollmentFee.findUnique.mockResolvedValue(unpaid);
    const out = await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-retired", dcareAddon: false, actorId: "u-1" });
    expect(out.note).toBe("unchanged_inactive_program");
    expect(out.fee).toMatchObject({ status: "UNPAID", amount: 400_000 });
    expect(raw.enrollmentFee.update).not.toHaveBeenCalled();
  });

  it("reopens only a fee carrying the auto-waive note, and not when the price is still 0", async () => {
    const waived = { ...unpaid, status: "WAIVED", method: "WAIVED", baseAmount: 0, amount: 0, discountPercent: 0, note: AUTO_WAIVE_NOTE, paymentUrl: null, sessionExpiresAt: null };
    const { tx, raw } = fakeTx();
    raw.enrollmentFee.findFirst.mockResolvedValue({ id: "f-1" });
    raw.enrollmentFee.findUnique.mockResolvedValue(waived);
    raw.enrollmentFee.update.mockImplementation(async ({ data }: { data: object }) => ({ ...waived, ...data }));

    const stillFree = await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-free", dcareAddon: false, actorId: "u-1" });
    expect(stillFree.note).toBe("unchanged_waived");
    expect(raw.enrollmentFee.update).not.toHaveBeenCalled();

    const reopened = await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-kb", dcareAddon: false, actorId: "u-1" });
    expect(reopened.note).toBe("repriced");
    expect(reopened.fee).toMatchObject({ status: "UNPAID", amount: 500_000 });
    expect(raw.enrollmentFee.update.mock.calls[0][0].where).toEqual({ id: "f-1", tenantId: "t-1" });

    raw.enrollmentFee.findUnique.mockResolvedValue({ ...waived, note: "Anak guru" });
    const staffWaive = await repriceUnpaidFee(tx, { tenantId: "t-1", applicationId: "a-1", programId: "p-kb", dcareAddon: false, actorId: "u-1" });
    expect(staffWaive.note).toBe("unchanged_waived");
    expect(raw.enrollmentFee.update).toHaveBeenCalledTimes(1);
  });
});
