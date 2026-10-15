import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { CONSENT_VERSION } from "@/lib/enrollment/consent-clauses";

const { findUnique, updateMany, programFindFirst, programFindMany, feeCreate, queryRaw, transaction, tenantFindUnique, repriceUnpaidFee } =
  vi.hoisted(() => ({
    repriceUnpaidFee: vi.fn(),
    findUnique: vi.fn(),
    tenantFindUnique: vi.fn(),
    updateMany: vi.fn(),
    programFindFirst: vi.fn(),
    programFindMany: vi.fn(),
    feeCreate: vi.fn(),
    queryRaw: vi.fn(),
    transaction: vi.fn(),
  }));

// The submit route runs read → validate → flip inside ONE interactive
// transaction (row lock first). The mock hands the callback the same client.
vi.mock("@/lib/db", () => {
  const client = {
    enrollmentApplication: { findUnique, updateMany },
    program: { findFirst: programFindFirst, findMany: programFindMany },
    enrollmentFee: { create: feeCreate },
    tenant: { findUnique: tenantFindUnique },
    $queryRaw: queryRaw,
    $transaction: transaction,
  };
  return { prisma: client };
});

// An existing fee is repriced by the helper staff's "Ubah data" uses; its maths and its
// PAID / WAIVED rules have their own tests, so it is stubbed here to prove the route
// delegates to it under the row lock and shapes the 201 body from its answer.
vi.mock("@/lib/enrollment/fee-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/enrollment/fee-snapshot")>()),
  repriceUnpaidFee,
}));

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
function mockRow(consentData: unknown, documents: unknown = null) {
  findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) =>
    arg.where.accessToken
      ? { id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" }
      : { consentData, documents },
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
  tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] }); // nothing required by default
  updateMany.mockResolvedValue({ count: 1 });
  programFindFirst.mockResolvedValue({ id: "c" + "a".repeat(24) }); // program owned by tenant
  // The chosen program is ACTIVE with no fee by default → no payment step.
  programFindMany.mockResolvedValue([{ id: "c" + "a".repeat(24), code: "KB", name: "KB", enrollmentFee: 0 }]);
  feeCreate.mockResolvedValue({ id: "fee-1" });
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
    expect((await res.json())).toEqual({ ok: true, id: "a", fee: null });
    expect(feeCreate).not.toHaveBeenCalled();
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
    programFindMany.mockResolvedValue([{ id: "program_ab57fd0432e25d5b3013", code: "KB", name: "KB", enrollmentFee: 0 }]);
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

describe("POST /submit — single parent / wali (R2-P-10)", () => {
  function onlyIbuBody() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payload is mutated freely
    const b = validBody() as Record<string, any>;
    b.ayahData = { name: "draft yang dibuang" };
    b.consentData.onlyParent = "ibu";
    b.consentData.ayah = { name: "Draft Ayah" }; // autosaved name of the waived parent
    return b;
  }

  it("201 with only the ibu's name and signature; the waived ayah has no data and no signer block", async () => {
    mockRow({ ibu: { signatureToken: DB_IBU } }); // ayah never signed
    const res = await POST(req(onlyIbuBody()), ctx);
    expect(res.status).toBe(201);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.ayahData).toEqual({});
    expect(data.ibuData.name).toBe("Ibu Fatimah");
    expect(data.consentData.onlyParent).toBe("ibu");
    expect(data.consentData.ibu.signatureToken).toBe(DB_IBU);
    expect(data.consentData.ibu.signedAt).toBeTruthy();
    expect(data.consentData.ayah).toBeUndefined();
  });

  // What the real form sends: both blocks always present, the skipped parent's one
  // blank (or half-typed and invalid). This used to be rejected with 422
  // "Nama wajib diisi" for a parent who was skipped on purpose.
  it.each([
    ["ibu", "ayahData", { name: "", phone: "", email: "", address: { perumahan: "" } }],
    ["ibu", "ayahData", { name: "Bapak", phone: "abc", email: "bukan-email" }],
    ["ayah", "ibuData", { name: "", phone: "", email: "", address: { perumahan: "" } }],
  ] as const)("201 when %s fills alone and the skipped %s arrives blank or invalid", async (only, waivedKey, block) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payload is mutated freely
    const b = validBody() as Record<string, any>;
    b.consentData.onlyParent = only;
    b[waivedKey] = block;
    const res = await POST(req(b), ctx);
    expect(res.status).toBe(201);
    const data = updateMany.mock.calls[0][0].data;
    expect(data[waivedKey]).toEqual({});
    expect(data[only === "ibu" ? "ibuData" : "ayahData"].name).toBeTruthy();
  });

  it("a stored signature of the waived parent does not resurface", async () => {
    // default mockRow holds BOTH tokens, e.g. ayah signed before being waived
    const res = await POST(req(onlyIbuBody()), ctx);
    expect(res.status).toBe(201);
    const consent = updateMany.mock.calls[0][0].data.consentData;
    expect(consent.ayah).toBeUndefined();
    expect(JSON.stringify(consent)).not.toContain(DB_AYAH);
  });

  it("422 when the filling parent has not signed, even though the waived one is skipped", async () => {
    mockRow({ ayah: { signatureToken: DB_AYAH } }); // only the waived parent signed
    const res = await POST(req(onlyIbuBody()), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields["consentData.ibu.signatureToken"]).toBeTruthy();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("422 when the filling parent's name is blank", async () => {
    mockRow({ ibu: { signatureToken: DB_IBU } });
    const b = onlyIbuBody();
    b.ibuData.name = "";
    const res = await POST(req(b), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields["ibuData.name"]).toBe("Nama wajib diisi");
  });

  it("without the flag both parents are still required (422 names the missing ayah)", async () => {
    const b = onlyIbuBody();
    delete b.consentData.onlyParent;
    delete b.ayahData;
    const res = await POST(req(b), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields["ayahData.name"]).toBe("Nama wajib diisi");
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


describe("POST /submit — required documents", () => {
  const SIGS = { ayah: { signatureToken: DB_AYAH }, ibu: { signatureToken: DB_IBU } };
  const uploaded = (extra: Record<string, unknown> = {}) => ({
    fileToken: "supabase:v1:enrollment/a/doc-kk-1.pdf",
    fileName: "kk.pdf",
    mimeType: "application/pdf",
    size: 10,
    uploadedAt: "2026-10-06T01:00:00.000Z",
    ...extra,
  });

  it("nothing required → unchanged (201 with no documents at all)", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: [] });
    mockRow(SIGS, null);
    expect((await POST(req(validBody()), ctx)).status).toBe(201);
  });

  it("looks the requirement up by the application's tenant, inside the transaction", async () => {
    await POST(req(validBody()), ctx);
    expect(tenantFindUnique.mock.calls[0][0].where).toEqual({ id: "t-1" });
  });

  it("required + missing → 422 naming the labels in form order; nothing written", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk", "akta"] });
    mockRow(SIGS, { kk: uploaded() , surat_sehat: uploaded() });
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(json.fields.documents).toBe("Berkas wajib belum diunggah: Akta kelahiran anak");
    expect(json.missingDocuments).toEqual(["akta"]);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("lists every missing label when several are absent", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["akta", "kk"] });
    mockRow(SIGS, null);
    const json = await (await POST(req(validBody()), ctx)).json();
    expect(json.fields.documents).toBe("Berkas wajib belum diunggah: Akta kelahiran anak, Kartu Keluarga (KK)");
    expect(json.missingDocuments).toEqual(["akta", "kk"]);
  });

  it("required + uploaded → 201", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk", "akta"] });
    mockRow(SIGS, { kk: uploaded(), akta: uploaded({ fileName: "akta.pdf" }) });
    expect((await POST(req(validBody()), ctx)).status).toBe(201);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("a physical-receipt tick alone does not satisfy a required document", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk"] });
    mockRow(SIGS, { kk: { receivedPhysical: true, receivedAt: "2026-10-06T01:00:00.000Z" } });
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(422);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("schema validation errors still win over the documents check", async () => {
    tenantFindUnique.mockResolvedValue({ enrollmentRequiredDocuments: ["kk"] });
    mockRow(SIGS, null);
    const b = validBody();
    b.studentData.childName = "";
    const json = await (await POST(req(b), ctx)).json();
    expect(json.fields["studentData.childName"]).toBeTruthy();
    expect(json.fields.documents).toBeUndefined();
    expect(json.missingDocuments).toBeUndefined();
  });
});

describe("pendaftaran fee (cycle 2026-10-10-pendaftaran-fee-payment)", () => {
  const PID = "c" + "a".repeat(24);
  const DC = "c" + "d".repeat(24);
  const fees = (kb: number, dc: number) => [
    { id: PID, code: "KB", name: "Kelompok Bermain", enrollmentFee: kb },
    { id: DC, code: "DCARE", name: "Day Care", enrollmentFee: dc },
  ];

  it("creates an UNPAID fee row for the chosen program's fee, in the same transaction", async () => {
    programFindMany.mockResolvedValue(fees(300000, 375000));
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: "a", fee: { baseAmount: 300000, amount: 300000, status: "UNPAID" } });
    expect(feeCreate).toHaveBeenCalledTimes(1);
    expect(feeCreate.mock.calls[0][0].data).toEqual({
      tenantId: "t-1",
      applicationId: "a",
      baseAmount: 300000,
      discountPercent: 0,
      amount: 300000,
      status: "UNPAID",
    });
    // Priced from the session tenant's ACTIVE programs only.
    expect(programFindMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", status: "ACTIVE" });
  });

  it("adds the Day Care fee when the add-on is ticked (pay both)", async () => {
    programFindMany.mockResolvedValue(fees(300000, 375000));
    const res = await POST(req({ ...validBody(), dcareAddon: true }), ctx);
    expect((await res.json()).fee).toEqual({ baseAmount: 675000, amount: 675000, status: "UNPAID" });
    expect(feeCreate.mock.calls[0][0].data.amount).toBe(675000);
  });

  it("ignores any amount the client sends — the server prices the application", async () => {
    programFindMany.mockResolvedValue(fees(300000, 375000));
    const res = await POST(req({ ...validBody(), fee: { amount: 1 }, amount: 1, enrollmentFee: 1 }), ctx);
    expect(res.status).toBe(201);
    expect(feeCreate.mock.calls[0][0].data.amount).toBe(300000);
  });

  it("no fee row and fee: null when the program's fee is 0", async () => {
    programFindMany.mockResolvedValue(fees(0, 375000));
    const res = await POST(req(validBody()), ctx);
    expect((await res.json()).fee).toBeNull();
    expect(feeCreate).not.toHaveBeenCalled();
  });

  it("no fee row when the lost-race guard returns 409 (flip happens first)", async () => {
    programFindMany.mockResolvedValue(fees(300000, 375000));
    updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(req(validBody()), ctx)).status).toBe(409);
    expect(feeCreate).not.toHaveBeenCalled();
  });

  it("422 and no flip when the chosen program is no longer ACTIVE (it would price at 0 and skip the fee)", async () => {
    // Owned by the tenant (programFindFirst) but absent from the ACTIVE list.
    programFindMany.mockResolvedValue([{ id: DC, code: "DCARE", name: "Day Care", enrollmentFee: 375000 }]);
    const res = await POST(req(validBody()), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields.programId).toBe("Program tidak valid");
    expect(updateMany).not.toHaveBeenCalled();
    expect(feeCreate).not.toHaveBeenCalled();
  });

  it("no fee row when validation fails", async () => {
    programFindMany.mockResolvedValue(fees(300000, 375000));
    const b = validBody();
    b.studentData.childName = "";
    expect((await POST(req(b), ctx)).status).toBe(422);
    expect(feeCreate).not.toHaveBeenCalled();
  });
});

describe("POST /submit — pay after the form: a fee row already left by pay-first (staging)", () => {
  const PID = "c" + "a".repeat(24);
  const OTHER = "c" + "b".repeat(24);
  const SIGS = { ayah: { signatureToken: DB_AYAH }, ibu: { signatureToken: DB_IBU } };

  /** `fee` is the row a formulir sent under pay-first already holds (what the locked read sees). */
  function mockFormulir(fee: { id: string } | null) {
    findUnique.mockImplementation(async (arg: { where: { accessToken?: string } }) =>
      arg.where.accessToken
        ? { id: "a", status: "INVITED", tokenExpiresAt: future, tenantId: "t-1" }
        : { consentData: SIGS, documents: null, fee },
    );
  }
  const view = (status: string, baseAmount: number, amount: number) => ({ status, baseAmount, amount });

  beforeEach(() => {
    mockFormulir({ id: "fee-1" });
    programFindMany.mockResolvedValue([
      { id: PID, code: "KB", name: "KB", enrollmentFee: 300_000 },
      { id: OTHER, code: "TK", name: "TK", enrollmentFee: 800_000 },
    ]);
  });

  it("an UNPAID fee never refuses the submit: it is repriced to the submitted program and Day Care, not duplicated", async () => {
    repriceUnpaidFee.mockResolvedValue({ note: "repriced", fee: view("UNPAID", 800_000, 800_000) });
    const res = await POST(req({ ...validBody(), programId: OTHER, dcareAddon: true }), ctx);
    expect(res.status).toBe(201);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: "SUBMITTED", programId: OTHER, dcareAddon: true });
    expect(repriceUnpaidFee).toHaveBeenCalledTimes(1);
    const [, input] = repriceUnpaidFee.mock.calls[0];
    expect(input).toMatchObject({ tenantId: "t-1", applicationId: "a", programId: OTHER, dcareAddon: true, actorId: "parent-form" });
    expect(feeCreate).not.toHaveBeenCalled();
    // The body carries the fee like a fresh one, so the thank-you card shows the pay panel.
    expect(await res.json()).toEqual({ ok: true, id: "a", fee: { baseAmount: 800_000, amount: 800_000, status: "UNPAID" } });
  });

  it("the submitted program is checked against the tenant's ACTIVE programs even though a fee exists", async () => {
    programFindMany.mockResolvedValue([{ id: PID, code: "KB", name: "KB", enrollmentFee: 300_000 }]);
    const res = await POST(req({ ...validBody(), programId: OTHER }), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).fields.programId).toBe("Program tidak valid");
    expect(programFindMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", status: "ACTIVE" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(repriceUnpaidFee).not.toHaveBeenCalled();
  });

  it.each([["PAID"], ["WAIVED"]])("a %s fee is left alone: the helper changes nothing and the body carries no fee", async (status) => {
    repriceUnpaidFee.mockResolvedValue({
      note: status === "PAID" ? "unchanged_paid" : "unchanged_waived",
      fee: view(status, 800_000, 800_000),
    });
    const res = await POST(req({ ...validBody(), programId: OTHER }), ctx);
    expect(res.status).toBe(201);
    expect(feeCreate).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, id: "a", fee: null });
  });

  it("a fee that the new program zeroes (closed as WAIVED) carries no fee: no pay panel for a free program", async () => {
    repriceUnpaidFee.mockResolvedValue({ note: "repriced", fee: view("WAIVED", 0, 0) });
    const res = await POST(req(validBody()), ctx);
    expect(await res.json()).toEqual({ ok: true, id: "a", fee: null });
  });

  it("an unchanged UNPAID fee (same program) still leads to the pay panel", async () => {
    repriceUnpaidFee.mockResolvedValue({ note: "repriced", fee: view("UNPAID", 300_000, 270_000) });
    const res = await POST(req(validBody()), ctx);
    expect((await res.json()).fee).toEqual({ baseAmount: 300_000, amount: 270_000, status: "UNPAID" });
  });

  it("no reprice (and no flip) when the submit loses the race: the repricing only follows a won flip", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(req(validBody()), ctx)).status).toBe(409);
    expect(repriceUnpaidFee).not.toHaveBeenCalled();
    expect(feeCreate).not.toHaveBeenCalled();
  });

  describe("no fee row (every form sent now): priced at submit", () => {
    beforeEach(() => mockFormulir(null));

    it("uses the program chosen in the form and creates the fee", async () => {
      const res = await POST(req({ ...validBody(), programId: PID, dcareAddon: false }), ctx);
      expect(res.status).toBe(201);
      expect(updateMany.mock.calls[0][0].data).toMatchObject({ programId: PID, dcareAddon: false });
      expect(repriceUnpaidFee).not.toHaveBeenCalled();
      expect(feeCreate).toHaveBeenCalledTimes(1);
      expect(feeCreate.mock.calls[0][0].data).toMatchObject({ applicationId: "a", amount: 300_000, status: "UNPAID" });
      expect(await res.json()).toEqual({ ok: true, id: "a", fee: { baseAmount: 300_000, amount: 300_000, status: "UNPAID" } });
    });

    it("a free program creates no fee and answers fee: null", async () => {
      programFindMany.mockResolvedValue([{ id: PID, code: "KB", name: "KB", enrollmentFee: 0 }]);
      const res = await POST(req(validBody()), ctx);
      expect(res.status).toBe(201);
      expect(feeCreate).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({ ok: true, id: "a", fee: null });
    });
  });
});
