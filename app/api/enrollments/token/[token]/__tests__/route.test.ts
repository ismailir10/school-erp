import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, updateMany: update, programFindFirst, writeConsent } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  programFindFirst: vi.fn(),
  writeConsent: vi.fn(),
}));

vi.mock("@/lib/enrollment/json-merge", () => ({ writeConsentPreservingSignatures: writeConsent }));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findUnique, updateMany: update },
    program: { findFirst: programFindFirst },
  },
}));

import { PATCH } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/token/tok", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ token: "tok" }) };
const future = new Date(Date.now() + 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  update.mockResolvedValue({ count: 1 });
  writeConsent.mockResolvedValue(true);
  programFindFirst.mockResolvedValue({ id: "c" + "a".repeat(24) });
});

describe("PATCH /api/enrollments/token/[token] (draft save)", () => {
  it("404 for an unknown token", async () => {
    findUnique.mockResolvedValue(null);
    const res = await PATCH(req({ studentData: { childName: "X" } }), ctx);
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("410 for an expired token", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: new Date(Date.now() - 1000) });
    const res = await PATCH(req({ studentData: {} }), ctx);
    expect(res.status).toBe(410);
  });

  it("409 when already submitted", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "SUBMITTED", tokenExpiresAt: future });
    const res = await PATCH(req({ studentData: {} }), ctx);
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves only the provided blobs and mirrors childName; Day Care goes in its own fee-guarded write", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    const res = await PATCH(req({ studentData: { childName: "  Aisyah  " }, dcareAddon: true }), ctx);
    expect(res.status).toBe(200);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "a", status: "INVITED" });
    expect(arg.data.studentData).toEqual({ childName: "  Aisyah  " });
    expect(arg.data.childName).toBe("Aisyah");
    expect("dcareAddon" in arg.data).toBe(false);
    expect("ayahData" in arg.data).toBe(false);
    expect(update.mock.calls[1][0]).toEqual({ where: { id: "a", status: "INVITED", fee: { is: null } }, data: { dcareAddon: true } });
  });

  it("normalizes empty programId to null", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    await PATCH(req({ programId: "" }), ctx);
    expect(update.mock.calls[0][0].data.programId).toBeNull();
    expect(update.mock.calls[0][0].where).toEqual({ id: "a", status: "INVITED", fee: { is: null } });
  });

  it("persists a prefixed (non-cuid) programId that belongs to the tenant", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    await PATCH(req({ programId: "program_ab57fd0432e25d5b3013" }), ctx);
    expect(update.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("drops (does not persist) a programId that fails the tenant-ownership check", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    programFindFirst.mockResolvedValue(null);
    const res = await PATCH(req({ programId: "program_from-another-tenant" }), ctx);
    expect(res.status).toBe(200);
    // Nothing left to write, so no update at all (and certainly no programId).
    expect(update).not.toHaveBeenCalled();
  });
});

describe("PATCH — consentData and signatures", () => {
  const invited = () =>
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });

  it("writes consentData through the signature-preserving helper, never via prisma.update", async () => {
    invited();
    const res = await PATCH(req({ consentData: { agreed: true, ayah: { name: "A" }, ibu: { name: "B" } } }), ctx);
    expect(res.status).toBe(200);
    expect(writeConsent).toHaveBeenCalledWith("a", { agreed: true, ayah: { name: "A" }, ibu: { name: "B" } });
    expect(update).not.toHaveBeenCalled(); // nothing else to write
  });

  it("strips the staff-recorded marker so a token holder cannot pre-seed it", async () => {
    invited();
    await PATCH(
      req({ consentData: { agreed: true, staffRecorded: true, note: "Disetujui langsung di sekolah", by: "u-1", at: "2026-10-11T00:00:00.000Z" } }),
      ctx,
    );
    expect(writeConsent.mock.calls[0][1]).toEqual({ agreed: true, ayah: {}, ibu: {} });
  });

  it("strips client-sent signatureToken/signedAt and forces ayah/ibu to objects", async () => {
    invited();
    await PATCH(
      req({
        consentData: {
          agreed: false,
          ayah: { name: "A", signatureToken: "", signedAt: "2020-01-01" },
          ibu: "not-an-object",
        },
      }),
      ctx,
    );
    const [, incoming] = writeConsent.mock.calls[0];
    expect(incoming).toEqual({ agreed: false, ayah: { name: "A" }, ibu: {} });
    expect(JSON.stringify(incoming)).not.toContain("signatureToken");
  });

  it("keeps the single-parent flag (R2-P-10) in the saved consent blob so resume can restore it", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: false, onlyParent: "ibu", ayah: { name: "" }, ibu: { name: "Siti" } } }), ctx);
    expect(writeConsent.mock.calls[0][1]).toEqual({
      agreed: false,
      onlyParent: "ibu",
      ayah: { name: "" },
      ibu: { name: "Siti" },
    });
  });

  it("creates ayah/ibu objects when the client sends consentData without them", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: true } }), ctx);
    expect(writeConsent.mock.calls[0][1]).toEqual({ agreed: true, ayah: {}, ibu: {} });
  });

  it("409 and no other write when the INVITED-guarded consent write matches no row", async () => {
    invited();
    writeConsent.mockResolvedValue(false);
    const res = await PATCH(req({ consentData: { agreed: true }, dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("still updates the remaining fields alongside consentData", async () => {
    invited();
    await PATCH(req({ consentData: { agreed: true }, dcareAddon: true }), ctx);
    expect(writeConsent).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ dcareAddon: true });
    expect("consentData" in update.mock.calls[0][0].data).toBe(false);
  });

  it("skips prisma.update entirely for an empty patch", async () => {
    invited();
    const res = await PATCH(req({}), ctx);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
    expect(writeConsent).not.toHaveBeenCalled();
  });

  it("ignores a client-sent `documents` key (zod strips it; documents are never written here)", async () => {
    invited();
    const res = await PATCH(req({ documents: { akta: { fileToken: "evil" } }, dcareAddon: true }), ctx);
    expect(res.status).toBe(200);
    expect(JSON.stringify(update.mock.calls[0][0])).not.toContain("evil");
    expect("documents" in update.mock.calls[0][0].data).toBe(false);
    // a body with ONLY documents degrades to a no-op
    update.mockClear();
    await PATCH(req({ documents: { akta: { fileToken: "evil" } } }), ctx);
    expect(update).not.toHaveBeenCalled();
    expect(writeConsent).not.toHaveBeenCalled();
  });

  it("409 ALREADY_SUBMITTED when the INVITED-guarded update matches no row", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" });
    update.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_SUBMITTED");
  });
});

describe("PATCH — pay-first gate and the program lock", () => {
  const row = (fee: { status: string } | null) => ({ id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1", fee });

  it("409 PAYMENT_REQUIRED while the fee is UNPAID, and nothing at all is written", async () => {
    findUnique.mockResolvedValue(row({ status: "UNPAID" }));
    const res = await PATCH(
      req({ studentData: { childName: "Aisyah" }, consentData: { agreed: true }, dcareAddon: true, programId: "c" + "a".repeat(24) }),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PAYMENT_REQUIRED", message: "Bayar biaya formulir dulu supaya formulir bisa diisi." });
    expect(update).not.toHaveBeenCalled();
    expect(writeConsent).not.toHaveBeenCalled();
    expect(programFindFirst).not.toHaveBeenCalled();
  });

  it.each([["PAID"], ["WAIVED"]])("a %s fee lets the draft save through", async (status) => {
    findUnique.mockResolvedValue(row({ status }));
    const res = await PATCH(req({ studentData: { childName: "Aisyah" } }), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.studentData).toEqual({ childName: "Aisyah" });
  });

  it("no fee row (sent before pay-first) saves as before, program and Day Care included", async () => {
    findUnique.mockResolvedValue(row(null));
    await PATCH(req({ programId: "c" + "a".repeat(24), dcareAddon: true }), ctx);
    expect(update.mock.calls[0][0].data).toEqual({ programId: "c" + "a".repeat(24), dcareAddon: true });
  });

  it.each([["PAID"], ["WAIVED"]])("once a %s fee exists, programId and dcareAddon in the draft are ignored (locked)", async (status) => {
    findUnique.mockResolvedValue(row({ status }));
    const res = await PATCH(
      req({ programId: "c" + "a".repeat(24), dcareAddon: true, studentData: { childName: "Aisyah" }, ayahData: { name: "Ahmad" } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("programId");
    expect(data).not.toHaveProperty("dcareAddon");
    // The rest of the draft is saved, and the program is not even looked up.
    expect(data.studentData).toEqual({ childName: "Aisyah" });
    expect(data.ayahData).toEqual({ name: "Ahmad" });
    expect(programFindFirst).not.toHaveBeenCalled();
  });

  it("a locked draft that carries only program / Day Care writes nothing", async () => {
    findUnique.mockResolvedValue(row({ status: "PAID" }));
    const res = await PATCH(req({ programId: "", dcareAddon: false }), ctx);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("PATCH — a staff resend that created the fee after the access check", () => {
  const open = { id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1", fee: null };

  // First read = the token lookup (no fee yet); later reads = the re-check after a guarded write matched nothing.
  const raced = (after: { status: string; fee: { status: string } | null }) =>
    findUnique.mockResolvedValueOnce(open).mockResolvedValue(after);

  it("program and Day Care are written only while no fee exists: the guarded write matches nothing and the stale draft is dropped", async () => {
    raced({ status: "INVITED", fee: { status: "PAID" } });
    update.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ programId: "c" + "a".repeat(24), dcareAddon: true }), ctx);
    expect(update.mock.calls[0][0].where).toEqual({ id: "a", status: "INVITED", fee: { is: null } });
    // Locked by a settled fee: nothing to save, and nothing wrong to report.
    expect(res.status).toBe(200);
  });

  it("…and when that fee is still owed the parent is told to pay first", async () => {
    raced({ status: "INVITED", fee: { status: "UNPAID" } });
    update.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("PAYMENT_REQUIRED");
  });

  it("…and a form that was submitted meanwhile is ALREADY_SUBMITTED", async () => {
    raced({ status: "SUBMITTED", fee: { status: "PAID" } });
    update.mockResolvedValue({ count: 0 });
    const res = await PATCH(req({ dcareAddon: true }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_SUBMITTED");
  });

  it("the rest of the draft is not held back by the program guard", async () => {
    findUnique.mockResolvedValue(open);
    await PATCH(req({ studentData: { childName: "Aisyah" }, dcareAddon: true }), ctx);
    expect(update.mock.calls[0][0].where).toEqual({ id: "a", status: "INVITED" });
    expect(update.mock.calls[0][0].data).not.toHaveProperty("dcareAddon");
  });
});
