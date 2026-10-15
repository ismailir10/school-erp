import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

// The parent submit must price through the SAME helper staff's "Tandai formulir
// masuk" uses, so the two can never disagree. The helper is stubbed here to prove
// the route delegates (and returns its result); its maths has its own tests.
const { createFeeSnapshot, findUnique, updateMany, programFindMany, programFindFirst, queryRaw, tenantFindUnique } = vi.hoisted(() => ({
  createFeeSnapshot: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  programFindMany: vi.fn(),
  programFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("@/lib/enrollment/fee-snapshot", () => ({ createFeeSnapshot }));
vi.mock("@/lib/db", () => {
  const client = {
    enrollmentApplication: { findUnique, updateMany },
    program: { findFirst: programFindFirst, findMany: programFindMany },
    tenant: { findUnique: tenantFindUnique },
    $queryRaw: queryRaw,
    $transaction: async (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { prisma: client };
});

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const PROGRAM = "c" + "a".repeat(24);
const body = {
  programId: PROGRAM,
  dcareAddon: true,
  studentData: { childName: "Aisyah Putri", childGender: "P", birthPlace: "Bekasi", dateOfBirth: "2021-03-15", agama: "ISLAM", kewarganegaraan: "WNI" },
  ayahData: { name: "Bapak Ahmad" },
  ibuData: { name: "Ibu Fatimah" },
  consentData: {
    agreed: true,
    version: CONSENT_VERSION,
    ayah: { name: "Bapak Ahmad", signatureToken: "supabase:v1:enrollment/a/ayah-signature-1.png" },
    ibu: { name: "Ibu Fatimah", signatureToken: "supabase:v1:enrollment/a/ibu-signature-2.png" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  queryRaw.mockResolvedValue([{ id: "a" }]);
  findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) =>
    arg.where.accessToken
      ? { id: "a", status: "INVITED", tokenExpiresAt: new Date(Date.now() + 86_400_000), tenantId: "t-1" }
      : { consentData: { ayah: { signatureToken: "x" }, ibu: { signatureToken: "y" } }, documents: null },
  );
  tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
  updateMany.mockResolvedValue({ count: 1 });
  programFindFirst.mockResolvedValue({ id: PROGRAM });
  programFindMany.mockResolvedValue([{ id: PROGRAM, code: "KB", name: "KB", enrollmentFee: 300_000 }]);
});

describe("parent submit uses the shared fee snapshot helper", () => {
  it("hands it the tenant's active programs and the submitted choice, and returns its snapshot", async () => {
    createFeeSnapshot.mockResolvedValue({ baseAmount: 300_000, amount: 300_000, status: "UNPAID" });
    const res = await POST(
      new NextRequest("http://localhost/api/enrollments/token/tok/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ token: "tok" }) },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: "a", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" } });
    expect(createFeeSnapshot).toHaveBeenCalledTimes(1);
    const [, input] = createFeeSnapshot.mock.calls[0];
    expect(input).toEqual({
      tenantId: "t-1",
      applicationId: "a",
      programs: [{ id: PROGRAM, code: "KB", name: "KB", enrollmentFee: 300_000 }],
      programId: PROGRAM,
      dcareAddon: true,
    });
  });
});
