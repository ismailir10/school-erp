import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, getSession, isAdminRole, programFindFirst, mergeJsonKey, eventFindMany } = vi.hoisted(() => ({
  mergeJsonKey: vi.fn(),
  eventFindMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  programFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: { findUnique, update },
    program: { findFirst: programFindFirst },
    webhookEvent: { findMany: eventFindMany },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/enrollment/json-merge", () => ({ mergeJsonKey }));

import { GET, PATCH } from "../route";

const ctx = (id = "ea-1") => ({ params: Promise.resolve({ id }) });
function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/enrollments/ea-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  update.mockResolvedValue({ id: "ea-1", status: "UNDER_REVIEW" });
  mergeJsonKey.mockResolvedValue(true);
  eventFindMany.mockResolvedValue([]);
});

describe("GET /api/enrollments/[id]", () => {
  it("denies custom finance and HR admins before reading an application", async () => {
    for (const permissions of [["invoices.view"], ["hr.view", "payroll.view"]]) {
      getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions });
      const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
      expect(res.status).toBe(403);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("allows an admissions read-only custom admin", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "ea-1", canEdit: false });
  });

  it("returns documents as per-item state and never leaks a storage token", async () => {
    findUnique.mockResolvedValue({
      id: "ea-1",
      tenantId: "t-1",
      status: "SUBMITTED",
      documents: {
        akta: {
          fileToken: "supabase:v1:enrollment/ea-1/doc-akta-0123456789abcdef.pdf",
          fileName: "akta.pdf",
          mimeType: "application/pdf",
          size: 10,
          uploadedAt: "2026-10-06T01:00:00.000Z",
        },
        kk: { receivedPhysical: true, receivedAt: "2026-10-06T02:00:00.000Z" },
      },
    });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("fileToken");
    expect(text).not.toContain("supabase:v1");
    const json = JSON.parse(text);
    expect(json.documents.akta).toMatchObject({ hasFile: true, fileName: "akta.pdf", receivedPhysical: false });
    expect(json.documents.kk).toMatchObject({ hasFile: false, receivedPhysical: true });
    expect(findUnique.mock.calls[0][0].select.documents).toBe(true);
  });

  it("returns an empty documents object when none are stored", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", documents: null });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect((await res.json()).documents).toEqual({});
  });

  it("403 for non-admin", async () => {
    isAdminRole.mockReturnValue(false);
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(403);
  });

  it("404 cross-tenant", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(404);
  });

  it("returns the application", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED" });
    const res = await GET(new NextRequest("http://localhost/api/enrollments/ea-1"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "ea-1", canEdit: true });
  });
});

describe("PATCH /api/enrollments/[id]", () => {
  it("requires admissions.edit even when the custom admin can read", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx());
    expect(res.status).toBe(403);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("allows admissions.edit for a custom admin without widening tenant scope", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.edit"] });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx())).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("409 when already converted", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    const res = await PATCH(patchReq({ status: "REJECTED" }), ctx());
    expect(res.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it("allows a valid transition SUBMITTED → UNDER_REVIEW", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW" }), ctx());
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.status).toBe("UNDER_REVIEW");
  });

  it("rejects an illegal transition REJECTED → ACCEPTED", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "REJECTED", studentId: null });
    const res = await PATCH(patchReq({ status: "ACCEPTED" }), ctx());
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("edits blobs and mirrors childName", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ studentData: { childName: "  Budi  " } }), ctx());
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.childName).toBe("Budi");
    expect(data.studentData).toEqual({ childName: "  Budi  " });
  });

  it("400 on empty patch body", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({}), ctx());
    expect(res.status).toBe(400);
  });

  it("accepts a prefixed (non-cuid) programId that belongs to the tenant", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    const res = await PATCH(patchReq({ programId: "program_ab57fd0432e25d5b3013" }), ctx());
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("400 when the chosen program is not in the admin's tenant (IDOR guard)", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    programFindFirst.mockResolvedValue(null);
    const res = await PATCH(patchReq({ programId: "program_from-another-tenant" }), ctx());
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enrollments/[id] — documentsReceived", () => {
  it("ticks a document on a converted application when it is the only field", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    const res = await PATCH(patchReq({ documentsReceived: { kk: true, akta: false } }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "ea-1", status: "ACCEPTED" });
    expect(update).not.toHaveBeenCalled(); // nothing but documents to write
    expect(mergeJsonKey).toHaveBeenCalledTimes(2);
    const [id, col, key, patch, opts] = mergeJsonKey.mock.calls[0];
    expect([id, col, key, opts]).toEqual(["ea-1", "documents", "kk", { requireInvited: false }]);
    expect(patch.receivedPhysical).toBe(true);
    expect(typeof patch.receivedAt).toBe("string");
    expect(mergeJsonKey.mock.calls[1][3]).toEqual({ receivedPhysical: false, receivedAt: null });
  });

  it("409 on a converted application when documentsReceived rides with any other field", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    for (const extra of [{ status: "REJECTED" }, { dcareAddon: true }, { studentData: { childName: "X" } }]) {
      const res = await PATCH(patchReq({ documentsReceived: { kk: true }, ...extra }), ctx());
      expect(res.status).toBe(409);
    }
    expect(mergeJsonKey).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("400 for an unknown document key, converted or not, and writes nothing", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ documentsReceived: { passport: true } }), ctx())).status).toBe(400);
    expect((await PATCH(patchReq({ documentsReceived: { kk: true, __proto__x: true } }), ctx())).status).toBe(400);
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "ACCEPTED", studentId: "s-1" });
    expect((await PATCH(patchReq({ documentsReceived: { passport: true } }), ctx())).status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("400 for non-boolean values", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    expect((await PATCH(patchReq({ documentsReceived: { kk: "yes" } }), ctx())).status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("combines with other fields on an unconverted application", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null });
    const res = await PATCH(patchReq({ status: "UNDER_REVIEW", documentsReceived: { ktp_ayah: true } }), ctx());
    expect(res.status).toBe(200);
    expect(mergeJsonKey).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toEqual({ status: "UNDER_REVIEW" });
    expect(await res.json()).toEqual({ id: "ea-1", status: "UNDER_REVIEW" });
  });

  it("does not write documents when another field fails validation (no partial write)", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "REJECTED", studentId: null });
    const res = await PATCH(patchReq({ status: "ACCEPTED", documentsReceived: { kk: true } }), ctx());
    expect(res.status).toBe(400);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });

  it("requires admissions.edit and the same tenant", async () => {
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    expect((await PATCH(patchReq({ documentsReceived: { kk: true } }), ctx())).status).toBe(403);
    getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "other", status: "ACCEPTED", studentId: "s-1" });
    expect((await PATCH(patchReq({ documentsReceived: { kk: true } }), ctx())).status).toBe(404);
    expect(mergeJsonKey).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enrollments/[id] — consentData never touches signatures", () => {
  const TOK_A = "supabase:v1:enrollment/ea-1/ayah-signature-0123456789abcdef.png";
  const TOK_I = "supabase:v1:enrollment/ea-1/ibu-signature-0123456789abcdef.png";
  const stored = {
    agreed: true,
    ayah: { name: "Bapak", signatureToken: TOK_A, signedAt: "2026-10-01T00:00:00.000Z" },
    ibu: { name: "Ibu", signatureToken: TOK_I, signedAt: "2026-10-01T00:00:00.000Z" },
  };

  it("drops client-sent signatureToken/signedAt and carries the stored ones over", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: stored });
    const res = await PATCH(
      patchReq({
        consentData: {
          agreed: true,
          ayah: { name: "Bapak Edit", signatureToken: "FORGED", signedAt: "2000-01-01" },
          ibu: { name: "Ibu Edit", signatureToken: "" },
        },
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const consent = update.mock.calls[0][0].data.consentData;
    expect(consent.ayah).toEqual({ name: "Bapak Edit", signatureToken: TOK_A, signedAt: "2026-10-01T00:00:00.000Z" });
    expect(consent.ibu).toEqual({ name: "Ibu Edit", signatureToken: TOK_I, signedAt: "2026-10-01T00:00:00.000Z" });
    expect(JSON.stringify(consent)).not.toContain("FORGED");
  });

  it("cannot clear a signature by omitting ayah/ibu, and cannot invent one when none is stored", async () => {
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: stored });
    await PATCH(patchReq({ consentData: { agreed: true } }), ctx());
    const kept = update.mock.calls[0][0].data.consentData;
    expect(kept.ayah.signatureToken).toBe(TOK_A);
    expect(kept.ibu.signatureToken).toBe(TOK_I);

    update.mockClear();
    findUnique.mockResolvedValue({ id: "ea-1", tenantId: "t-1", status: "SUBMITTED", studentId: null, consentData: null });
    await PATCH(patchReq({ consentData: { ayah: { name: "A", signatureToken: "FORGED" } } }), ctx());
    const none = update.mock.calls[0][0].data.consentData;
    expect(none.ayah).toEqual({ name: "A" });
    expect(none.ibu).toEqual({});
  });
});

describe("GET /api/enrollments/[id] — pendaftaran fee", () => {
  const editor = { id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] };
  const viewer = { id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] };
  const get = () => GET(new NextRequest("https://talib.example/api/enrollments/ea-1"), ctx());

  const feeRow = (over: Record<string, unknown> = {}) => ({
    status: "UNPAID",
    method: null,
    baseAmount: "300000",
    discountPercent: 0,
    discountReason: null,
    amount: "300000",
    paidAt: null,
    note: null,
    linkError: null,
    lastCheckedAt: null,
    paymentUrl: "https://doku.example/pay/SECRET-LINK",
    sessionExpiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  const app = (over: Record<string, unknown> = {}) => ({
    id: "ea-1",
    tenantId: "t-1",
    accessToken: "SECRET-TOKEN",
    status: "SUBMITTED",
    childName: "Aisyah",
    ayahData: {},
    ibuData: {},
    admission: { id: "a-1", parentName: "Siti", parentPhone: null, parentWhatsapp: "0812-3456-7890", parentRelationship: "IBU" },
    fee: feeRow(),
    ...over,
  });

  it("returns the fee for staff as numbers, without any gateway link or id", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app());
    const body = await (await get()).json();

    expect(body.fee).toMatchObject({ status: "UNPAID", baseAmount: 300_000, amount: 300_000, discountPercent: 0, linkActive: true });
    const text = JSON.stringify(body);
    expect(text).not.toContain("SECRET-LINK");
    expect(text).not.toMatch(/paymentUrl|gatewaySessionId|sessionExpiresAt|paymentId/);
    // The credential is never sent on its own.
    expect(body.accessToken).toBeUndefined();
  });

  it("reports that the parent holds a live link only while it still works", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ fee: feeRow({ sessionExpiresAt: new Date(Date.now() - 1000) }) }));
    expect((await (await get()).json()).fee.linkActive).toBe(false);
    findUnique.mockResolvedValue(app({ fee: feeRow({ paymentUrl: null, sessionExpiresAt: null }) }));
    expect((await (await get()).json()).fee.linkActive).toBe(false);
  });

  it("an editor gets the parent's form link; the WhatsApp link is never built here (it carries the token)", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app());
    const body = await (await get()).json();

    expect(body.followUp).toEqual({ formUrl: "https://talib.example/pendaftaran/SECRET-TOKEN", canRemind: true });
    const text = JSON.stringify(body);
    expect(text).not.toContain("wa.me");
    expect(text).not.toContain("waUrl");
  });

  it("canRemind is false (button disabled) when there is no number to message, but the link is still offered", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ admission: { id: "a-1", parentName: "Siti", parentPhone: "123", parentWhatsapp: null } }));
    const { followUp } = await (await get()).json();
    expect(followUp.canRemind).toBe(false);
    expect(followUp.formUrl).toContain("/pendaftaran/");
  });

  it("falls back to the Ibu's phone from the form when the inquiry had none", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(
      app({ admission: { id: "a-1", parentName: "Siti", parentPhone: null, parentWhatsapp: null }, ibuData: { phone: "0813-9999-0000" } }),
    );
    expect((await (await get()).json()).followUp.canRemind).toBe(true);
  });

  it.each(["PAID", "WAIVED"])("no follow-up for a %s fee", async (status) => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ fee: feeRow({ status }) }));
    expect((await (await get()).json()).followUp).toBeNull();
  });

  it("a REJECTED application gets no follow-up (its pay link is closed), but still shows the fee", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ status: "REJECTED" }));
    const body = await (await get()).json();
    expect(body.followUp).toBeNull();
    expect(body.fee.status).toBe("UNPAID");
  });

  it("a read-only viewer sees the fee but never the form link or the token", async () => {
    getSession.mockResolvedValue(viewer);
    findUnique.mockResolvedValue(app());
    const body = await (await get()).json();
    expect(body.fee.status).toBe("UNPAID");
    expect(body.followUp).toBeNull();
    expect(JSON.stringify(body)).not.toContain("SECRET-TOKEN");
  });

  it("an application with no fee has fee: null, no follow-up, no problems and no event lookup", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ fee: null }));
    const body = await (await get()).json();
    expect(body.fee).toBeNull();
    expect(body.followUp).toBeNull();
    expect(body.feeProblems).toEqual([]);
    expect(eventFindMany).not.toHaveBeenCalled();
  });

  it("reads the fee with the staff select (id for the lookup; no gateway ids)", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app());
    await get();
    const select = findUnique.mock.calls[0][0].select;
    expect(select.fee.select).toMatchObject({ id: true, status: true, amount: true, baseAmount: true });
    expect(select.fee.select.paymentId).toBeUndefined();
    expect(select.fee.select.gatewaySessionId).toBeUndefined();
  });

  it("never returns the fee row id or the token on their own", async () => {
    getSession.mockResolvedValue(editor);
    findUnique.mockResolvedValue(app({ fee: feeRow({ id: "fee-1" }) }));
    const body = await (await get()).json();
    expect(body.fee.id).toBeUndefined();
    expect(body.accessToken).toBeUndefined();
  });

  describe("feePermissions", () => {
    const FINANCE = ["admissions.view", "admissions.edit", "payments.record", "fees.edit"];
    const perms = async (permissions: string[]) => {
      getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions });
      findUnique.mockResolvedValue(app());
      return (await (await get()).json()).feePermissions;
    };

    it("finance staff may record a payment and adjust the fee", async () => {
      expect(await perms(FINANCE)).toEqual({ recordPayment: true, adjust: true });
    });
    it("an admissions editor without finance keys may do neither", async () => {
      expect(await perms(["admissions.view", "admissions.edit"])).toEqual({ recordPayment: false, adjust: false });
    });
    it("payments.record alone allows recording but not adjusting", async () => {
      expect(await perms(["admissions.view", "admissions.edit", "payments.record"])).toEqual({ recordPayment: true, adjust: false });
    });
    it("fees.edit alone allows adjusting but not recording", async () => {
      expect(await perms(["admissions.view", "admissions.edit", "fees.edit"])).toEqual({ recordPayment: false, adjust: true });
    });
    it("finance keys without admissions.edit give nothing (the route requires both)", async () => {
      expect(await perms(["admissions.view", "payments.record", "fees.edit"])).toEqual({ recordPayment: false, adjust: false });
    });
  });

  describe("feeProblems (payments the processor refused to credit)", () => {
    const withEvents = async (events: { errorMessage: string }[], feeOver: Record<string, unknown> = {}, session = editor) => {
      getSession.mockResolvedValue(session);
      findUnique.mockResolvedValue(app({ fee: feeRow({ id: "fee-1", ...feeOver }) }));
      eventFindMany.mockResolvedValue(events);
      return (await (await get()).json()).feeProblems as { code: string; message: string }[];
    };

    it("looks events up by the FEE id, errors only", async () => {
      await withEvents([]);
      expect(eventFindMany.mock.calls[0][0].where).toEqual({ invoiceId: "fee-1", status: "ERROR" });
    });

    it("explains a wrong-amount payment with both amounts while the fee is still owed", async () => {
      const problems = await withEvents([{ errorMessage: "AMOUNT_MISMATCH;expected=240000;got=300000" }], { amount: "240000" });
      expect(problems).toHaveLength(1);
      expect(problems[0].code).toBe("AMOUNT_MISMATCH");
      expect(problems[0].message).toContain("Rp 300.000");
      expect(problems[0].message).toContain("Rp 240.000");
    });

    it("hides a wrong-amount payment once staff settled the fee", async () => {
      expect(await withEvents([{ errorMessage: "AMOUNT_MISMATCH;expected=240000;got=300000" }], { status: "PAID" })).toEqual([]);
    });

    it("keeps a second payment and money on a waived fee: a refund is owed whatever happened since", async () => {
      const dup = await withEvents([{ errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" }], { status: "PAID" });
      expect(dup.map((p) => p.code)).toEqual(["DUPLICATE_PAYMENT_AFTER_PAID"]);
      const waived = await withEvents([{ errorMessage: "PAID_ON_WAIVED_FEE" }], { status: "WAIVED" });
      expect(waived.map((p) => p.code)).toEqual(["PAID_ON_WAIVED_FEE"]);
    });

    it("lists each kind once however many events there are", async () => {
      const problems = await withEvents([
        { errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" },
        { errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" },
      ], { status: "PAID" });
      expect(problems).toHaveLength(1);
    });

    it("read-only viewers see the problems too", async () => {
      const problems = await withEvents([{ errorMessage: "DUPLICATE_PAYMENT_AFTER_PAID" }], { status: "PAID" }, viewer);
      expect(problems).toHaveLength(1);
    });
  });
});

