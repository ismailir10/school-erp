import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

const { findUnique, updateMany, programFindFirst, queryRaw, transaction } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  programFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

// The submit route runs read → validate → flip inside ONE interactive
// transaction (row lock first). The mock hands the callback the same client.
vi.mock("@/lib/db", () => {
  const client = {
    enrollmentApplication: { findUnique, updateMany },
    program: { findFirst: programFindFirst },
    $queryRaw: queryRaw,
    $transaction: transaction,
  };
  return { prisma: client };
});

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const future = new Date(Date.now() + 86_400_000);
const ctx = { params: Promise.resolve({ token: "tok" }) };

function validBody() {
  return {
    programId: "c" + "a".repeat(24),
    dcareAddon: false,
    studentData: {
      childName: "Aisyah Putri",
      childGender: "P",
      birthPlace: "Bekasi",
      dateOfBirth: "2021-03-15",
      agama: "ISLAM",
      kewarganegaraan: "WNI",
    },
    ayahData: { name: "Bapak Ahmad" },
    ibuData: { name: "Ibu Fatimah" },
    consentData: {
      agreed: true,
      version: CONSENT_VERSION,
      ayah: { name: "Bapak Ahmad", signatureToken: "supabase:v1:enrollment/a/ayah-signature-1.png" },
      ibu: { name: "Ibu Fatimah", signatureToken: "supabase:v1:enrollment/a/ibu-signature-2.png" },
    },
  };
}

function req(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/token/tok/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DB_AYAH = "supabase:v1:enrollment/a/ayah-signature-db.png";
const DB_IBU = "supabase:v1:enrollment/a/ibu-signature-db.png";

/** resolve looks up by accessToken; the signature overlay reads the row by id. */
function mockRow(consentData: unknown) {
  findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) =>
    arg.where.accessToken
      ? { id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" }
      : { consentData },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  queryRaw.mockResolvedValue([{ id: "a" }]);
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    const { prisma } = await import("@/lib/db");
    return cb(prisma);
  });
  mockRow({ ayah: { signatureToken: DB_AYAH }, ibu: { signatureToken: DB_IBU } });
  updateMany.mockResolvedValue({ count: 1 });
  programFindFirst.mockResolvedValue({ id: "c" + "a".repeat(24) }); // program owned by tenant
});

describe("POST /api/enrollments/token/[token]/submit", () => {
  it("422 on validation failure (missing required field)", async () => {
    const b = validBody();
    b.studentData.childName = "";
    const res = await POST(req(b), ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(json.fields["studentData.childName"]).toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("flips INVITED→SUBMITTED, stamps signedAt, and persists blobs", async () => {
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(201);
    expect((await res.json())).toEqual({ ok: true, id: "a" });
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "a", status: "INVITED" });
    expect(arg.data.status).toBe("SUBMITTED");
    expect(arg.data.submittedAt).toBeInstanceOf(Date);
    expect(arg.data.childName).toBe("Aisyah Putri");
    expect(arg.data.consentData.ayah.signedAt).toBeTruthy();
    expect(arg.data.consentData.ibu.signedAt).toBeTruthy();
  });

  it("409 when the row was already submitted (resolve guard)", async () => {
    findUnique.mockResolvedValue({ id: "a", status: "SUBMITTED", tokenExpiresAt: future });
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("409 when the INVITED→SUBMITTED race is lost (updateMany count 0)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(409);
  });

  it("404 for an unknown token", async () => {
    findUnique.mockResolvedValue(null);
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(404);
  });

  it("submits successfully with a prefixed (non-cuid) programId that belongs to the tenant", async () => {
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    const b = { ...validBody(), programId: "program_ab57fd0432e25d5b3013" };
    const res = await POST(req(b), ctx);
    expect(res.status).toBe(201);
    expect(updateMany.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("422 when the chosen program is not in the application's tenant (IDOR guard)", async () => {
    programFindFirst.mockResolvedValue(null);
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields.programId).toBe("Program tidak valid");
    expect(updateMany).not.toHaveBeenCalled();
  });

  describe("signature tokens come from the DB row", () => {
    function bodyWithoutTokens() {
      const b = validBody();
      delete (b.consentData.ayah as { signatureToken?: string }).signatureToken;
      delete (b.consentData.ibu as { signatureToken?: string }).signatureToken;
      return b;
    }

    it("201 when the body carries no tokens but the row has both; written consentData uses the DB tokens", async () => {
      const res = await POST(req(bodyWithoutTokens()), ctx);
      expect(res.status).toBe(201);
      const consent = updateMany.mock.calls[0][0].data.consentData;
      expect(consent.ayah.signatureToken).toBe(DB_AYAH);
      expect(consent.ibu.signatureToken).toBe(DB_IBU);
      expect(consent.ayah.signedAt).toBeTruthy();
    });

    it("201 even when the body has no ayah/ibu blocks at all (names still required)", async () => {
      const b = validBody() as { consentData: Record<string, unknown> };
      delete b.consentData.ayah;
      delete b.consentData.ibu;
      const res = await POST(req(b), ctx);
      // names are required by the schema, so this is a field error, not a crash
      expect(res.status).toBe(422);
      expect((await res.json()).fields["consentData.ayah.name"]).toBeTruthy();
    });

    it("client-sent tokens are always overwritten by the stored ones", async () => {
      const b = validBody();
      b.consentData.ayah.signatureToken = "supabase:v1:enrollment/a/ayah-signature-FORGED.png";
      const res = await POST(req(b), ctx);
      expect(res.status).toBe(201);
      const consent = updateMany.mock.calls[0][0].data.consentData;
      expect(consent.ayah.signatureToken).toBe(DB_AYAH);
      expect(JSON.stringify(consent)).not.toContain("FORGED");
    });

    it("a client-sent token cannot stand in for a signature the row lacks → 422", async () => {
      mockRow({ ayah: { signatureToken: DB_AYAH } }); // ibu never signed
      const res = await POST(req(validBody()), ctx); // body still claims an ibu token
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("validation_failed");
      expect(json.fields["consentData.ibu.signatureToken"]).toBeTruthy();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("422 when the row has no consentData at all", async () => {
      mockRow(null);
      const res = await POST(req(bodyWithoutTokens()), ctx);
      expect(res.status).toBe(422);
      const fields = (await res.json()).fields;
      expect(fields["consentData.ayah.signatureToken"]).toBeTruthy();
      expect(fields["consentData.ibu.signatureToken"]).toBeTruthy();
    });

    it("does not touch `documents`", async () => {
      await POST(req({ ...validBody(), documents: { akta: { fileToken: "evil" } } }), ctx);
      expect(JSON.stringify(updateMany.mock.calls[0][0])).not.toContain("evil");
      expect("documents" in updateMany.mock.calls[0][0].data).toBe(false);
    });
  });
});

describe("POST /submit — transaction + row lock", () => {
  it("takes the row lock FOR UPDATE before reading the stored tokens, all inside one transaction", async () => {
    const order: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      order.push(`lock:${strings.join("?").includes("FOR UPDATE")}`);
      return [{ id: "a" }];
    });
    const realImpl = findUnique.getMockImplementation()!;
    findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) => {
      if (!arg.where.accessToken) order.push("read-consent");
      return realImpl(arg);
    });
    updateMany.mockImplementation(async () => {
      order.push("flip");
      return { count: 1 };
    });
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["lock:true", "read-consent", "flip"]);
  });

  it("404 when the locked row has vanished (nothing written)", async () => {
    queryRaw.mockResolvedValue([]);
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("validation failures and lost races return their usual codes from inside the transaction", async () => {
    const b = validBody();
    b.studentData.childName = "";
    expect((await POST(req(b), ctx)).status).toBe(422);
    updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(req(validBody()), ctx)).status).toBe(409);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("a thrown error inside the transaction propagates (so the DB rolls back)", async () => {
    updateMany.mockRejectedValue(new Error("db down"));
    await expect(POST(req(validBody()), ctx)).rejects.toThrow("db down");
  });
});

