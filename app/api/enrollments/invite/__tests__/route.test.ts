import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { admissionFindUnique, enrollmentUpsert, sendInvite, getSession, isAdminRole } = vi.hoisted(() => ({
  admissionFindUnique: vi.fn(),
  enrollmentUpsert: vi.fn(),
  sendInvite: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    admission: { findUnique: admissionFindUnique },
    enrollmentApplication: { upsert: enrollmentUpsert },
  },
}));

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
    programId: "c" + "a".repeat(24),
    enrollmentApplication: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SUPER_ADMIN" });
  isAdminRole.mockReturnValue(true);
  enrollmentUpsert.mockResolvedValue({ id: "ea-1", accessToken: "tok-xyz" });
  sendInvite.mockResolvedValue({ sent: true });
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
    expect(enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("422 NO_EMAIL when the inquiry has no parent email", async () => {
    admissionFindUnique.mockResolvedValue(admission({ parentEmail: null }));
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("NO_EMAIL");
    expect(enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("409 when the application is already past INVITED", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ enrollmentApplication: { id: "ea-1", status: "SUBMITTED" } }),
    );
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALREADY_IN_PROGRESS");
    expect(enrollmentUpsert).not.toHaveBeenCalled();
  });

  it("prefills No. HP from the WhatsApp number when the inquiry has no phone", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: null, parentWhatsapp: "081999000111" }),
    );
    expect((await POST(req({ admissionId: "adm-1" }))).status).toBe(200);
    expect(enrollmentUpsert.mock.calls[0][0].create.ayahData.phone).toBe("081999000111");
  });

  it("falls back to WhatsApp when the phone is a blank string", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: "", parentWhatsapp: "081999000111" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentUpsert.mock.calls[0][0].create.ayahData.phone).toBe("081999000111");
  });

  it("leaves No. HP unset when neither phone nor WhatsApp is present", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: null, parentWhatsapp: "" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentUpsert.mock.calls[0][0].create.ayahData.phone).toBeUndefined();
  });

  it("parentPhone still wins when both phone and WhatsApp are set", async () => {
    admissionFindUnique.mockResolvedValue(
      admission({ parentRelationship: "AYAH", parentPhone: "081234567890", parentWhatsapp: "081999000111" }),
    );
    await POST(req({ admissionId: "adm-1" }));
    expect(enrollmentUpsert.mock.calls[0][0].create.ayahData.phone).toBe("081234567890");
  });

  it("creates/refreshes the application, prefills the IBU block, and sends the email", async () => {
    admissionFindUnique.mockResolvedValue(admission());
    const res = await POST(req({ admissionId: "adm-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("ea-1");
    expect(json.sent).toBe(true);
    expect(json.formUrl).toContain("/pendaftaran/tok-xyz");

    const upsertArg = enrollmentUpsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ admissionId: "adm-1" });
    expect(upsertArg.create.status).toBe("INVITED");
    expect(upsertArg.create.parentEmail).toBe("fatimah@test.com");
    expect(upsertArg.create.tenantId).toBe("t-1");
    // IBU relationship → ibuData prefilled, ayahData left undefined
    expect(upsertArg.create.ibuData.name).toBe("Ibu Fatimah");
    expect(upsertArg.create.ayahData).toBeUndefined();
    expect(typeof upsertArg.create.accessToken).toBe("string");
    expect(upsertArg.update.accessToken).toBeTruthy();

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
    expect((await res.json()).sent).toBe(false);
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
