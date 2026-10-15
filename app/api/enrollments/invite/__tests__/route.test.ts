import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  admissionFindUnique, enrollmentCreate, enrollmentUpdateMany, enrollmentFindUnique,
  feeCreate, feeFindFirst, feeUpdate, programFindFirst, sendInvite, getSession, isAdminRole, recordAudit,
} = vi.hoisted(() => ({
  admissionFindUnique: vi.fn(),
  enrollmentCreate: vi.fn(),
  enrollmentUpdateMany: vi.fn(),
  enrollmentFindUnique: vi.fn(),
  feeCreate: vi.fn(),
  feeFindFirst: vi.fn(),
  feeUpdate: vi.fn(),
  programFindFirst: vi.fn(),
  sendInvite: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  // The fee mocks exist only so a test can assert the invite never touches them (pay-after).
  const tx = {
    enrollmentApplication: { create: enrollmentCreate, updateMany: enrollmentUpdateMany },
    enrollmentFee: { create: feeCreate, findFirst: feeFindFirst, update: feeUpdate },
    $executeRaw: vi.fn(),
  };
  return {
    prisma: {
      admission: { findUnique: admissionFindUnique },
      enrollmentApplication: { findUnique: enrollmentFindUnique },
      program: { findFirst: programFindFirst },
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
  sendInvite.mockResolvedValue({ sent: true });
  // The lead's program is an active program of the school unless a test says otherwise.
  programFindFirst.mockResolvedValue({ id: PROGRAM });
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
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
    const create = enrollmentCreate.mock.calls[0][0].data;
    expect(create.childName).toBe("");
    expect(create.studentData).toEqual({});
    // No program on the lead: the parent picks it in the formulir.
    expect(create.programId).toBeNull();
    expect(programFindFirst).not.toHaveBeenCalled();
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
    // A resend does not look at programs or fees at all.
    expect(programFindFirst).not.toHaveBeenCalled();
    expect(feeCreate).not.toHaveBeenCalled();
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("a resend ignores a program in the body: the stored program and Day Care stay as they are", async () => {
    admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: { id: "ea-1", status: "INVITED" } }));
    const res = await POST(req({ admissionId: "adm-1", programId: OTHER, dcareAddon: true }));
    expect(res.status).toBe(200);
    expect(Object.keys(enrollmentUpdateMany.mock.calls[0][0].data).sort()).toEqual(["accessToken", "tokenExpiresAt"]);
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
    expect(entry.after).toEqual({ admissionId: "adm-1", hasEmail: true });
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
    expect(json.emailed).toBe(true);
    expect(json.hasEmail).toBe(true);
    expect(json.formUrl).toContain("/pendaftaran/tok-xyz");
    // Nothing about a fee: there is none yet (pay-after).
    expect(Object.keys(json).sort()).toEqual(["emailed", "formUrl", "hasEmail", "id"]);

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

describe("POST /api/enrollments/invite — pay-after: no program, no fee", () => {
  it("a first send creates no EnrollmentFee", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
    expect(feeCreate).not.toHaveBeenCalled();
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
  });

  it("ignores a programId and dcareAddon in the body (the parent chooses them in the formulir)", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    const res = await POST(req({ admissionId: "adm-1", programId: OTHER, dcareAddon: true }));
    expect(res.status).toBe(200);
    const created = enrollmentCreate.mock.calls[0][0].data;
    // The formulir starts on the LEAD's program, not the body's; Day Care is never preset.
    expect(created.programId).toBe(PROGRAM);
    expect(created.dcareAddon).toBe(false);
    expect(feeCreate).not.toHaveBeenCalled();
  });

  it("does not reject a malformed programId left in an old client's body", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    expect((await POST(req({ admissionId: "adm-1", programId: "not-a-cuid" }))).status).toBe(200);
  });

  it("suggests the lead's program only when it is an active program of this school", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    await POST(req({ admissionId: "adm-1" }));
    expect(programFindFirst.mock.calls[0][0].where).toEqual({ id: PROGRAM, tenantId: "t-1", status: "ACTIVE" });
    expect(enrollmentCreate.mock.calls[0][0].data.programId).toBe(PROGRAM);
  });

  it("starts the formulir with no program when the lead's program has been retired", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    programFindFirst.mockResolvedValue(null);
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
    expect(enrollmentCreate.mock.calls[0][0].data.programId).toBeNull();
  });

  it("a formulir sent under pay-first keeps its fee row on a resend: the link is refreshed, the fee is not read or moved", async () => {
    admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: { id: "ea-1", status: "INVITED", fee: { status: "UNPAID" } } }));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    expect(enrollmentUpdateMany).toHaveBeenCalledTimes(1);
    expect(feeCreate).not.toHaveBeenCalled();
    expect(feeFindFirst).not.toHaveBeenCalled();
    expect(feeUpdate).not.toHaveBeenCalled();
    expect(Object.keys(await res.json()).sort()).toEqual(["emailed", "formUrl", "hasEmail", "id"]);
  });

  it("a staff member without the finance key can send: the invite is no pricing decision any more", async () => {
    getSession.mockResolvedValue({ id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] });
    admissionFindUnique.mockResolvedValue(admission({ enrollmentApplication: { id: "ea-1", status: "INVITED" } }));
    expect((await POST(req({ admissionId: "adm-1", programId: OTHER }))).status).toBe(200);
  });
});
