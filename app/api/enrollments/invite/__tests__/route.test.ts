import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  admissionFindUnique, enrollmentCreate, enrollmentUpdateMany, enrollmentUpdate, enrollmentTxFindUnique, enrollmentFindUnique,
  feeCreate, feeFindFirst, feeFindUnique, feeUpdate, programFindFirst, programFindMany, sendInvite, getSession, isAdminRole, recordAudit,
} = vi.hoisted(() => ({
  admissionFindUnique: vi.fn(),
  enrollmentCreate: vi.fn(),
  enrollmentUpdateMany: vi.fn(),
  enrollmentUpdate: vi.fn(),
  enrollmentTxFindUnique: vi.fn(),
  enrollmentFindUnique: vi.fn(),
  feeCreate: vi.fn(),
  feeFindFirst: vi.fn(),
  feeFindUnique: vi.fn(),
  feeUpdate: vi.fn(),
  programFindFirst: vi.fn(),
  programFindMany: vi.fn(),
  sendInvite: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = {
    enrollmentApplication: { create: enrollmentCreate, updateMany: enrollmentUpdateMany, update: enrollmentUpdate, findUnique: enrollmentTxFindUnique },
    enrollmentFee: { create: feeCreate, findFirst: feeFindFirst, findUnique: feeFindUnique, update: feeUpdate },
    program: { findMany: programFindMany },
    $executeRaw: vi.fn(),
  };
  return {
    prisma: {
      admission: { findUnique: admissionFindUnique },
      enrollmentApplication: { findUnique: enrollmentFindUnique },
      program: { findFirst: programFindFirst, findMany: programFindMany },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
vi.mock("@/lib/audit", () => ({ recordAudit }));

vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/email/enrollment-invite", () => ({ sendEnrollmentInviteEmail: sendInvite }));

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PROGRAM = "c" + "a".repeat(24);
const OTHER = "c" + "b".repeat(24);
const DCARE = "c" + "d".repeat(24);
const FREE = "c" + "f".repeat(24);
const ACTIVE_PROGRAMS = [
  { id: PROGRAM, code: "KB", name: "Kelompok Bermain", enrollmentFee: 500_000 },
  { id: OTHER, code: "TK", name: "Taman Kanak-kanak", enrollmentFee: 800_000 },
  { id: DCARE, code: "DCARE", name: "Day Care", enrollmentFee: 200_000 },
  { id: FREE, code: "FREE", name: "Gratis", enrollmentFee: 0 },
];

// One in-memory pendaftaran fee row behind the transaction mock.
let feeRow: Record<string, unknown> | null;
const fullFee = (over: Record<string, unknown> = {}) => ({
  id: "fee-1",
  status: "UNPAID",
  method: null,
  baseAmount: 500_000,
  discountPercent: 0,
  discountReason: null,
  amount: 500_000,
  paidAt: null,
  note: null,
  linkError: null,
  lastCheckedAt: null,
  paymentUrl: "https://doku.example/pay/old",
  sessionExpiresAt: new Date(Date.now() + 86_400_000),
  ...over,
});

const noFeesEdit = { id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] };
/** An INVITED application, as `admission.enrollmentApplication` reports it. */
const invited = (over: Record<string, unknown> = {}) => ({ id: "ea-1", status: "INVITED", programId: PROGRAM, dcareAddon: false, fee: null, ...over });

function admission(overrides: Record<string, unknown> = {}) {
  return {
    id: "adm-1",
    tenantId: "t-1",
    childName: "Aisyah",
    childGender: "P",
    dateOfBirth: "2021-03-15",
    parentName: "Ibu Fatimah",
    parentPhone: "081234567890",
    parentWhatsapp: null,
    parentEmail: "fatimah@test.com",
    parentRelationship: "IBU",
    programId: PROGRAM,
    status: "INQUIRY",
    studentId: null,
    enrollmentApplication: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  enrollmentCreate.mockResolvedValue({ id: "ea-1", accessToken: "tok-xyz" });
  enrollmentUpdateMany.mockResolvedValue({ count: 1 });
  enrollmentUpdate.mockResolvedValue({});
  sendInvite.mockResolvedValue({ sent: true });
  programFindFirst.mockResolvedValue({ id: PROGRAM });
  programFindMany.mockResolvedValue(ACTIVE_PROGRAMS);
  feeRow = null;
  feeCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    feeRow = fullFee({ ...data, paymentUrl: null, sessionExpiresAt: null });
    return feeRow;
  });
  feeFindFirst.mockImplementation(async ({ where }: { where: { status?: string } }) =>
    feeRow && (!where.status || where.status === feeRow.status) ? feeRow : null,
  );
  feeFindUnique.mockImplementation(async () => feeRow);
  feeUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    feeRow = { ...feeRow, ...data };
    return feeRow;
  });
  enrollmentTxFindUnique.mockResolvedValue({ programId: PROGRAM, dcareAddon: false });
});

describe("POST /api/enrollments/invite", () => {
  it("denies an admissions read-only custom admin before loading the admission", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(403);
    expect(admissionFindUnique).not.toHaveBeenCalled();
  });

  it("403 when not an admin", async () => {
    isAdminRole.mockReturnValue(false);
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(403);
    expect(admissionFindUnique).not.toHaveBeenCalled();
  });

  it("400 when admissionId missing", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("404 when admission not found or cross-tenant", async () => {
    admissionFindUnique.mockResolvedValue(admission({ tenantId: "other-tenant" }));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(404);
    expect(enrollmentCreate).not.toHaveBeenCalled();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("404 when the admission does not exist", async () => {
    admissionFindUnique.mockResolvedValue(null);
    expect((await POST(req({ admissionId: "nope" }))).status).toBe(404);
  });

  it("a lead with no email still gets a form link: 200, no email sent, hasEmail false", async () => {
    admissionFindUnique.mockResolvedValue(admission({ parentEmail: null }));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ id: "ea-1", emailed: false, hasEmail: false });
    expect(json.formUrl).toContain("/pendaftaran/tok-xyz");
    expect(sendInvite).not.toHaveBeenCalled();
    expect(enrollmentCreate.mock.calls[0][0].data.parentEmail).toBeNull();
  });

  it("treats a whitespace-only email as no email", async () => {
    admissionFindUnique.mockResolvedValue(admission({ parentEmail: "   " }));
    const json = await (await POST(req({ admissionId: "adm-1" }))).json();
    expect(json.hasEmail).toBe(false);
    expect(sendInvite).not.toHaveBeenCalled();
    expect(enrollmentCreate.mock.calls[0][0].data.parentEmail).toBeNull();
  });

  it("reports hasEmail true but emailed false when the send fails", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    sendInvite.mockResolvedValue({ sent: false, error: "bounced" });
    const json = await (await POST(req({ admissionId: "adm-1" }))).json();
    expect(json).toMatchObject({ emailed: false, hasEmail: true });
  });

  it("a lead with no child data yet gets an application with nothing blank prefilled", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ childName: "", dateOfBirth: null, childGender: null, programId: null }),
    );
    // The program is chosen in the send dialog, not on the lead.
    expect((await POST(req({ admissionId: "adm-1", programId: PROGRAM }))).status).toBe(200);
    const create = enrollmentCreate.mock.calls[0][0].data;
    expect(create.childName).toBe("");
    expect(create.studentData).toEqual({});
    expect(create.programId).toBe(PROGRAM);
  });

  it("copies the child data that is filled", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentCreate.mock.calls[0][0].data.studentData).toEqual({
      childName: "Aisyah",
      dateOfBirth: "2021-03-15",
      childGender: "P",
    });
  });

  it.each([
    ["AYAH", "ayahData", "ibuData"],
    ["IBU", "ibuData", "ayahData"],
  ])("relationship %s prefills only the matching block (name, phone, email)", async (rel, filled, empty) => {
    admissionFindUnique.mockResolvedValue(admission({ parentRelationship: rel }));
    await POST(req({ admissionId: "adm-1" }));
    const create = enrollmentCreate.mock.calls[0][0].data;
    expect(create[filled]).toEqual({
      name: "Ibu Fatimah",
      phone: "081234567890",
      email: "fatimah@test.com",
    });
    expect(create[empty]).toBeUndefined();
  });

  it.each([["WALI"], [null], ["OTHER"]])("relationship %s prefills neither parent block", async (rel) => {
    admissionFindUnique.mockResolvedValue(admission({ parentRelationship: rel }));
    await POST(req({ admissionId: "adm-1" }));
    const create = enrollmentCreate.mock.calls[0][0].data;
    expect(create.ayahData).toBeUndefined();
    expect(create.ibuData).toBeUndefined();
  });

  it("without an email the prefilled parent block carries no email", async () => {
    admissionFindUnique.mockResolvedValue(admission({ parentEmail: null, parentRelationship: "AYAH" }));
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentCreate.mock.calls[0][0].data.ayahData.email).toBeUndefined();
  });

  it("resending an INVITED application refreshes the token and expiry, nothing else", async () => {
    admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: { id: "ea-1", status: "INVITED" } }));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    expect(enrollmentCreate).not.toHaveBeenCalled();
    const { where, data } = enrollmentUpdateMany.mock.calls[0][0];
    // The INVITED check rides in the UPDATE's WHERE, scoped to the tenant.
    expect(where).toEqual({ admissionId: "adm-1", tenantId: "t-1", status: "INVITED" });
    expect(Object.keys(data).sort()).toEqual(["accessToken", "tokenExpiresAt"]);
    expect(data.tokenExpiresAt).toBeInstanceOf(Date);
    expect((await res.json()).id).toBe("ea-1");
    expect(recordAudit.mock.calls[0][0].action).toBe("resend_invite");
  });

  it("writes an audit row with flags only, never the link or contact details", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    await POST(req({ admissionId: "adm-1" }));
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [entry, tx] = recordAudit.mock.calls[0];
    expect(entry).toMatchObject({
      tenantId: "t-1",
      actorId: "u-1",
      entity: "EnrollmentApplication",
      entityId: "ea-1",
      action: "invite",
      after: { admissionId: "adm-1", hasEmail: true },
    });
    expect(tx).toBeDefined();
    const dumped = JSON.stringify(entry);
    expect(dumped).not.toContain("tok-xyz");
    expect(dumped).not.toContain("fatimah@test.com");
    expect(dumped).not.toContain("081234567890");
  });

  it.each([
    ["cancelled", { status: "CANCELLED" }],
    ["already a student", { studentId: "stu-1" }],
  ])("409 LEAD_CLOSED when the lead is %s", async (_label, over) => {
    admissionFindUnique.mockResolvedValue(admission(over));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("LEAD_CLOSED");
    expect(json.message).toMatch(/tidak bisa dikirim/);
    expect(enrollmentCreate).not.toHaveBeenCalled();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("a cross-tenant cancelled lead is still a 404, not a 409", async () => {
    admissionFindUnique.mockResolvedValue(admission({ tenantId: "other", status: "CANCELLED" }));
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(404);
  });

  it("409 ALREADY_IN_PROGRESS when the parent submitted between our read and the write (count 0)", async () => {
    admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: { id: "ea-1", status: "INVITED" } }));
    enrollmentUpdateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_IN_PROGRESS");
    expect(recordAudit).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  describe("two sends racing to create the first application", () => {
    const unique = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

    it("refreshes the winner's application when it is still INVITED", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      enrollmentCreate.mockRejectedValueOnce(unique());
      enrollmentFindUnique.mockResolvedValue({ id: "ea-9", status: "INVITED", tenantId: "t-1" });
      const res = await POST(req({ admissionId: "adm-1" }));
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe("ea-9");
      expect(enrollmentUpdateMany.mock.calls[0][0].where.status).toBe("INVITED");
    });

    it("409 when the winner's application has moved on", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      enrollmentCreate.mockRejectedValueOnce(unique());
      enrollmentFindUnique.mockResolvedValue({ id: "ea-9", status: "SUBMITTED", tenantId: "t-1" });
      const res = await POST(req({ admissionId: "adm-1" }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("ALREADY_IN_PROGRESS");
      expect(enrollmentUpdateMany).not.toHaveBeenCalled();
    });

    it("rethrows any other database error", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      enrollmentCreate.mockRejectedValueOnce(new Error("connection lost"));
      await expect(POST(req({ admissionId: "adm-1" }))).rejects.toThrow("connection lost");
    });
  });

  it("409 when the application is already past INVITED", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ enrollmentApplication: { id: "ea-1", status: "SUBMITTED" } }),
    );
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_IN_PROGRESS");
    expect(enrollmentCreate).not.toHaveBeenCalled();
    expect(enrollmentUpdateMany).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("prefills No. HP from the WhatsApp number when the inquiry has no phone", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: null, parentWhatsapp: "081999000111" }),
    );
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
    expect(enrollmentCreate.mock.calls[0][0].data.ayahData.phone).toBe("081999000111");
  });

  it("falls back to WhatsApp when the phone is a blank string", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: "", parentWhatsapp: "081999000111" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentCreate.mock.calls[0][0].data.ayahData.phone).toBe("081999000111");
  });

  it("leaves No. HP unset when neither phone nor WhatsApp is present", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: null, parentWhatsapp: "" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentCreate.mock.calls[0][0].data.ayahData.phone).toBeUndefined();
  });

  it("parentPhone still wins when both phone and WhatsApp are set", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: "081234567890", parentWhatsapp: "081999000111" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentCreate.mock.calls[0][0].data.ayahData.phone).toBe("081234567890");
  });

  it("creates/refreshes the application, prefills the IBU block, and sends the email", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("ea-1");
    expect(json).not.toHaveProperty("sent");
    expect(json.emailed).toBe(true);
    expect(json.hasEmail).toBe(true);
    expect(json.formUrl).toContain("/pendaftaran/tok-xyz");

    const created = enrollmentCreate.mock.calls[0][0].data;
    expect(created.status).toBe("INVITED");
    expect(created.parentEmail).toBe("fatimah@test.com");
    expect(created.tenantId).toBe("t-1");
    // IBU relationship → ibuData prefilled, ayahData left undefined
    expect(created.ibuData.name).toBe("Ibu Fatimah");
    expect(created.ayahData).toBeUndefined();
    expect(typeof created.accessToken).toBe("string");

    // email got the tokenized form url
    const emailArg = sendInvite.mock.calls[0][0];
    expect(emailArg.to).toBe("fatimah@test.com");
    expect(emailArg.formUrl).toContain("/pendaftaran/tok-xyz");
  });

  it("still returns 200 when the email send throws (best-effort)", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    sendInvite.mockRejectedValue(new Error("resend down"));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).emailed).toBe(false);
  });

  it("rate-limits repeated invites (429 after the per-minute cap)", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await POST(req({ admissionId: "adm-1" }))).status;
    }
    expect(last).toBe(429);
  });
});

describe("POST /api/enrollments/invite — pay-first: program, Day Care and the fee", () => {
  const unpaidFee = (over: Record<string, unknown> = {}) => fullFee(over);

  describe("first send", () => {
    it("stores program + Day Care and creates the UNPAID fee in the same transaction, priced from the active program fees", async () => {
      admissionFindUnique.mockResolvedValue(admission({ programId: null }));
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(res.status).toBe(200);

      const created = enrollmentCreate.mock.calls[0][0].data;
      expect(created).toMatchObject({ tenantId: "t-1", programId: PROGRAM, dcareAddon: true, status: "INVITED" });
      // 500.000 program + 200.000 Day Care add-on; the client sends no amount.
      expect(feeCreate.mock.calls[0][0].data).toEqual({
        tenantId: "t-1",
        applicationId: "ea-1",
        baseAmount: 700_000,
        discountPercent: 0,
        amount: 700_000,
        status: "UNPAID",
      });
      const json = await res.json();
      expect(json).toMatchObject({ id: "ea-1", emailed: true, hasEmail: true, fee: { status: "UNPAID", baseAmount: 700_000, amount: 700_000, discountPercent: 0 } });
      expect(json).not.toHaveProperty("feeNote");
      // Staff view only: no gateway link or id.
      expect(JSON.stringify(json.fee)).not.toMatch(/paymentUrl|gatewaySessionId|doku\.example/);
    });

    it("falls back to the lead's own program when the body names none, and a Day Care add-on is off by default", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      const json = await (await POST(req({ admissionId: "adm-1" }))).json();
      expect(enrollmentCreate.mock.calls[0][0].data).toMatchObject({ programId: PROGRAM, dcareAddon: false });
      expect(json.fee.amount).toBe(500_000);
    });

    it("the body's program wins over the lead's", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindFirst.mockResolvedValue({ id: OTHER });
      const json = await (await POST(req({ admissionId: "adm-1", programId: OTHER }))).json();
      expect(enrollmentCreate.mock.calls[0][0].data.programId).toBe(OTHER);
      expect(json.fee.amount).toBe(800_000);
    });

    it("a free program creates no fee row: fee is null and the form opens straight away", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindFirst.mockResolvedValue({ id: FREE });
      const res = await POST(req({ admissionId: "adm-1", programId: FREE }));
      expect(res.status).toBe(200);
      expect(feeCreate).not.toHaveBeenCalled();
      expect((await res.json()).fee).toBeNull();
      expect(enrollmentCreate).toHaveBeenCalledTimes(1);
    });

    it("a free program with the Day Care add-on is priced at the add-on alone (the fee maths is unchanged)", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindFirst.mockResolvedValue({ id: FREE });
      const json = await (await POST(req({ admissionId: "adm-1", programId: FREE, dcareAddon: true }))).json();
      expect(json.fee).toMatchObject({ status: "UNPAID", amount: 200_000 });
    });

    it("needs only admissions.edit (no fees.edit) to create the fee", async () => {
      getSession.mockResolvedValue(noFeesEdit);
      admissionFindUnique.mockResolvedValue(admission());
      expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
      expect(feeCreate).toHaveBeenCalledTimes(1);
    });

    it("the invite email and its arguments are unchanged by the fee", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      await POST(req({ admissionId: "adm-1", dcareAddon: true }));
      expect(Object.keys(sendInvite.mock.calls[0][0]).sort()).toEqual(["appUrl", "childName", "formUrl", "parentName", "tenantId", "to"]);
    });

    it("audit carries flags and ids only: feeCreated, feeRepriced, feeId", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      await POST(req({ admissionId: "adm-1" }));
      const [entry] = recordAudit.mock.calls[0];
      expect(entry).toMatchObject({
        action: "invite",
        after: { admissionId: "adm-1", hasEmail: true, feeCreated: true, feeRepriced: false, feeId: "fee-1" },
      });
      expect(JSON.stringify(entry)).not.toMatch(/tok-xyz|fatimah@test\.com|081234567890|700000|500000/);
    });

    it("a free program audits feeCreated false and no fee id", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindFirst.mockResolvedValue({ id: FREE });
      await POST(req({ admissionId: "adm-1", programId: FREE }));
      expect(recordAudit.mock.calls[0][0].after).toMatchObject({ feeCreated: false, feeRepriced: false, feeId: null });
    });
  });

  describe("program validation", () => {
    const programError = async (res: Response, message: string) => {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Validasi gagal", errors: [{ field: "programId", message }] });
      expect(enrollmentCreate).not.toHaveBeenCalled();
      expect(enrollmentUpdateMany).not.toHaveBeenCalled();
      expect(feeCreate).not.toHaveBeenCalled();
      expect(sendInvite).not.toHaveBeenCalled();
    };

    it("400 'Pilih program dulu.' when neither the body nor the lead has a program", async () => {
      admissionFindUnique.mockResolvedValue(admission({ programId: null }));
      await programError(await POST(req({ admissionId: "adm-1" })), "Pilih program dulu.");
    });

    it("a blank or null programId in the body means 'not chosen' (and falls back to the lead's)", async () => {
      admissionFindUnique.mockResolvedValue(admission({ programId: null }));
      await programError(await POST(req({ admissionId: "adm-1", programId: "" })), "Pilih program dulu.");
      await programError(await POST(req({ admissionId: "adm-1", programId: null })), "Pilih program dulu.");
    });

    it("400 when the program is not one of this school's (another tenant's id)", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindFirst.mockResolvedValue(null);
      await programError(await POST(req({ admissionId: "adm-1", programId: OTHER })), "Program tidak ditemukan");
      expect(programFindFirst.mock.calls[0][0].where).toEqual({ id: OTHER, tenantId: "t-1" });
    });

    it("400 when the program is retired (not in the ACTIVE fee list), so it can never price at 0", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      programFindMany.mockResolvedValue(ACTIVE_PROGRAMS.filter((p) => p.id !== PROGRAM));
      await programError(await POST(req({ admissionId: "adm-1" })), "Program ini sudah tidak aktif. Pilih program lain.");
      expect(programFindMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", status: "ACTIVE" });
    });

    it("400 in the repo's validation shape for a programId of the wrong type, a non-boolean dcareAddon and a missing admissionId", async () => {
      admissionFindUnique.mockResolvedValue(admission());
      for (const [payload, field] of [
        [{ admissionId: "adm-1", programId: 42 }, "programId"],
        [{ admissionId: "adm-1", dcareAddon: "yes" }, "dcareAddon"],
        [{}, "admissionId"],
      ] as const) {
        const res = await POST(req(payload));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Validasi gagal");
        expect(json.errors.map((e: { field: string }) => e.field)).toContain(field);
      }
      expect(enrollmentCreate).not.toHaveBeenCalled();
    });

    it("another school's lead is still a 404, before any program lookup", async () => {
      admissionFindUnique.mockResolvedValue(admission({ tenantId: "other-tenant" }));
      expect((await POST(req({ admissionId: "adm-1", programId: PROGRAM }))).status).toBe(404);
      expect(programFindFirst).not.toHaveBeenCalled();
    });

    it("LEAD_CLOSED still wins for a cancelled lead, before the program is looked at", async () => {
      admissionFindUnique.mockResolvedValue(admission({ status: "CANCELLED", programId: null }));
      const res = await POST(req({ admissionId: "adm-1" }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("LEAD_CLOSED");
    });
  });

  describe("resend while INVITED", () => {
    beforeEach(() => {
      admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: invited({ fee: { status: "UNPAID" } }) }));
      feeRow = unpaidFee();
    });

    it("reprices an UNPAID fee when Day Care is added, keeping the staff discount, and stores the choice", async () => {
      feeRow = unpaidFee({ discountPercent: 20, discountReason: "Yatim", amount: 400_000 });
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(res.status).toBe(200);
      const json = await res.json();
      // 700.000 base, 20% off.
      expect(json.fee).toMatchObject({ status: "UNPAID", baseAmount: 700_000, discountPercent: 20, amount: 560_000 });
      expect(json.feeNote).toBe("repriced");
      expect(enrollmentUpdate.mock.calls[0][0]).toEqual({ where: { id: "ea-1", tenantId: "t-1" }, data: { programId: PROGRAM, dcareAddon: true } });
      expect(feeCreate).not.toHaveBeenCalled();
      // The amount moved, so the stale payment link is dropped.
      expect(feeUpdate.mock.calls[0][0].data).toMatchObject({ paymentUrl: null, sessionExpiresAt: null });
      expect(recordAudit.mock.calls.map(([e]) => e.action)).toEqual(["fee.reprice", "resend_invite"]);
      expect(recordAudit.mock.calls[1][0].after).toMatchObject({ feeCreated: false, feeRepriced: true, feeId: "fee-1" });
    });

    it("a resend that changes nothing still refreshes the token and keeps the link when the price is the same", async () => {
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: false }));
      expect(res.status).toBe(200);
      expect(enrollmentUpdateMany.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ accessToken: expect.any(String), tokenExpiresAt: expect.any(Date) }),
      );
      expect(enrollmentUpdate).not.toHaveBeenCalled();
      expect(feeUpdate.mock.calls[0][0].data).not.toHaveProperty("paymentUrl");
      expect((await res.json()).fee).toMatchObject({ amount: 500_000, linkActive: true });
    });

    it("a resend naming no program keeps the application's own (set in 'Ubah data'), not the lead's", async () => {
      admissionFindUnique.mockResolvedValue(
        admission({ programId: PROGRAM, enrollmentApplication: invited({ programId: OTHER, fee: { status: "UNPAID" } }) }),
      );
      feeRow = unpaidFee({ baseAmount: 800_000, amount: 800_000 });
      programFindFirst.mockResolvedValue({ id: OTHER });
      const json = await (await POST(req({ admissionId: "adm-1" }))).json();
      expect(json.fee.amount).toBe(800_000);
      expect(enrollmentUpdate).not.toHaveBeenCalled();
    });

    it("403 with the same message as the staff PATCH when program or Day Care changes without fees.edit; nothing is written", async () => {
      getSession.mockResolvedValue(noFeesEdit);
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Mengubah program mengubah biaya pendaftaran; butuh izin keuangan." });
      expect(enrollmentUpdateMany).not.toHaveBeenCalled();
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(sendInvite).not.toHaveBeenCalled();
      programFindFirst.mockResolvedValue({ id: OTHER });
      expect((await POST(req({ admissionId: "adm-1", programId: OTHER }))).status).toBe(403);
    });

    it("without fees.edit an unchanged resend of an UNPAID fee is fine", async () => {
      getSession.mockResolvedValue(noFeesEdit);
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: false }));
      expect(res.status).toBe(200);
      expect(enrollmentUpdateMany).toHaveBeenCalledTimes(1);
    });

    it("re-checks under the lock: a stale pre-read cannot let someone without fees.edit reprice an UNPAID fee", async () => {
      getSession.mockResolvedValue(noFeesEdit);
      // The pre-read matched the request (so the early 403 did not fire); the locked read differs.
      admissionFindUnique.mockResolvedValue(
        admission({ enrollmentApplication: invited({ dcareAddon: true, fee: { status: "UNPAID" } }) }),
      );
      enrollmentTxFindUnique.mockResolvedValue({ programId: PROGRAM, dcareAddon: false });
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(res.status).toBe(403);
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it("an UNPAID fee whose program was retired is refused with a 400 (rolled back), never priced at 0", async () => {
      programFindMany.mockResolvedValue(ACTIVE_PROGRAMS.filter((p) => p.id !== PROGRAM));
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: false }));
      expect(res.status).toBe(400);
      expect((await res.json()).errors).toEqual([{ field: "programId", message: "Program ini sudah tidak aktif. Pilih program lain." }]);
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(sendInvite).not.toHaveBeenCalled();
    });

    it("a PAID fee is untouched: no reprice, no second fee, and the application keeps what it was priced for", async () => {
      admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: invited({ fee: { status: "PAID" } }) }));
      feeRow = unpaidFee({ status: "PAID", paidAt: new Date("2026-10-11T01:00:00Z"), method: "DOKU" });
      const res = await POST(req({ admissionId: "adm-1", programId: OTHER, dcareAddon: true }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.fee).toMatchObject({ status: "PAID", amount: 500_000 });
      expect(json.feeNote).toBe("unchanged_paid");
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(feeCreate).not.toHaveBeenCalled();
      expect(enrollmentUpdate).not.toHaveBeenCalled();
      // The link is still refreshed and the lead still gets it.
      expect(enrollmentUpdateMany).toHaveBeenCalledTimes(1);
      expect(json.formUrl).toContain("/pendaftaran/");
      expect(sendInvite).toHaveBeenCalledTimes(1);
    });

    it("a PAID fee is untouched even for someone without fees.edit (nothing to reprice, so no 403)", async () => {
      getSession.mockResolvedValue(noFeesEdit);
      admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: invited({ fee: { status: "PAID" } }) }));
      feeRow = unpaidFee({ status: "PAID" });
      expect((await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }))).status).toBe(200);
      expect(feeUpdate).not.toHaveBeenCalled();
    });

    it("a fee waived by staff is untouched, and the application keeps its program and Day Care", async () => {
      admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: invited({ fee: { status: "WAIVED" } }) }));
      feeRow = unpaidFee({ status: "WAIVED", method: "WAIVED", note: "Anak guru" });
      const json = await (await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }))).json();
      expect(json.fee).toMatchObject({ status: "WAIVED", amount: 500_000 });
      expect(json.feeNote).toBe("unchanged_waived");
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(feeCreate).not.toHaveBeenCalled();
      expect(enrollmentUpdate).not.toHaveBeenCalled();
    });

    describe("legacy: no fee row (sent before pay-first, or a free program)", () => {
      beforeEach(() => {
        admissionFindUnique.mockResolvedValue(admission({ programId: null, enrollmentApplication: invited({ programId: null }) }));
        feeRow = null;
      });

      it.each([
        ["with no body program at all", { admissionId: "adm-1" }],
        ["with a program and Day Care in the body", { admissionId: "adm-1", programId: OTHER, dcareAddon: true }],
        ["with a program that is not even this school's", { admissionId: "adm-1", programId: "c" + "9".repeat(24) }],
      ])("only refreshes the link: no fee, no program or Day Care write, no program required (%s)", async (_n, payload) => {
        programFindFirst.mockResolvedValue(null);
        programFindMany.mockResolvedValue([]);
        const res = await POST(req(payload));
        expect(res.status).toBe(200);
        expect(enrollmentUpdateMany.mock.calls[0][0]).toEqual({
          where: { admissionId: "adm-1", tenantId: "t-1", status: "INVITED" },
          data: { accessToken: expect.any(String), tokenExpiresAt: expect.any(Date) },
        });
        expect(feeCreate).not.toHaveBeenCalled();
        expect(feeFindFirst).not.toHaveBeenCalled();
        expect(enrollmentUpdate).not.toHaveBeenCalled();
        // The program was never looked at.
        expect(programFindFirst).not.toHaveBeenCalled();
        expect(programFindMany).not.toHaveBeenCalled();
        const json = await res.json();
        expect(json.fee).toBeNull();
        expect(json).not.toHaveProperty("feeNote");
        expect(json.formUrl).toContain("/pendaftaran/");
        expect(sendInvite).toHaveBeenCalledTimes(1);
        expect(recordAudit.mock.calls[0][0]).toMatchObject({ action: "resend_invite", after: { feeCreated: false, feeRepriced: false, feeId: null } });
      });

      it("the INVITED guard still applies: 409 when the parent submitted in between", async () => {
        enrollmentUpdateMany.mockResolvedValue({ count: 0 });
        expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(409);
      });
    });

    it("a PAID or WAIVED fee stays resendable even though its program was retired or is not even sent", async () => {
      for (const status of ["PAID", "WAIVED"]) {
        vi.clearAllMocks();
        enrollmentUpdateMany.mockResolvedValue({ count: 1 });
        sendInvite.mockResolvedValue({ sent: true });
        admissionFindUnique.mockResolvedValue(admission({ programId: null, enrollmentApplication: invited({ fee: { status } }) }));
        feeRow = unpaidFee({ status, method: status === "PAID" ? "DOKU" : "WAIVED" });
        programFindMany.mockResolvedValue(ACTIVE_PROGRAMS.filter((p) => p.id !== PROGRAM)); // retired since
        programFindFirst.mockResolvedValue(null);
        const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM }));
        expect(res.status).toBe(200);
        expect((await res.json()).fee).toMatchObject({ status });
        expect(programFindFirst).not.toHaveBeenCalled();
        expect(feeUpdate).not.toHaveBeenCalled();
        expect(enrollmentUpdate).not.toHaveBeenCalled();
      }
    });

    it("the INVITED guard still wins: a parent who submitted in between gets 409 and no fee is touched", async () => {
      enrollmentUpdateMany.mockResolvedValue({ count: 0 });
      const res = await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("ALREADY_IN_PROGRESS");
      expect(feeUpdate).not.toHaveBeenCalled();
      expect(feeCreate).not.toHaveBeenCalled();
    });

    it("every fee write is tenant-scoped", async () => {
      await POST(req({ admissionId: "adm-1", programId: PROGRAM, dcareAddon: true }));
      expect(feeFindFirst.mock.calls.every(([arg]) => arg.where.tenantId === "t-1")).toBe(true);
      expect(feeUpdate.mock.calls.every(([arg]) => arg.where.tenantId === "t-1")).toBe(true);
    });
  });
});
