import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { tenantFindFirst, admissionCreate, admissionUpdate, admissionFindMany, programFindFirst, detectSibling, sendAdmissionSubmittedEmail } =
  vi.hoisted(() => ({
    tenantFindFirst: vi.fn(),
    admissionCreate: vi.fn(),
    admissionUpdate: vi.fn(),
    admissionFindMany: vi.fn(),
    programFindFirst: vi.fn(),
    detectSibling: vi.fn(),
    sendAdmissionSubmittedEmail: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant: { findFirst: tenantFindFirst },
    admission: { create: admissionCreate, update: admissionUpdate, findMany: admissionFindMany },
    program: { findFirst: programFindFirst },
  },
}));
vi.mock("@/lib/admission/sibling-detect", () => ({ detectSibling }));
vi.mock("@/lib/email/admission-submitted", () => ({ sendAdmissionSubmittedEmail }));

import { POST } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";

const VALID = {
  parentName: "Ibu Fatimah",
  parentPhone: "081234567890",
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admission/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  tenantFindFirst.mockResolvedValue({ id: "tenant_annisaa" });
  admissionCreate.mockResolvedValue({ id: "adm-1" });
  admissionFindMany.mockResolvedValue([]);
  detectSibling.mockResolvedValue(null);
  sendAdmissionSubmittedEmail.mockResolvedValue({ sent: true });
});

describe("POST /api/admission/submit — programId tenant guard", () => {
  it("persists a prefixed programId that belongs to the resolved tenant", async () => {
    programFindFirst.mockResolvedValue({ id: "program_ab57fd0432e25d5b3013" });
    const res = await POST(req({ ...VALID, programId: "program_ab57fd0432e25d5b3013" }));
    expect(res.status).toBe(201);
    expect(admissionCreate.mock.calls[0][0].data.programId).toBe("program_ab57fd0432e25d5b3013");
  });

  it("drops a programId that does not belong to the resolved tenant (IDOR guard)", async () => {
    programFindFirst.mockResolvedValue(null);
    const res = await POST(req({ ...VALID, programId: "program_from-another-tenant" }));
    expect(res.status).toBe(201);
    expect(admissionCreate.mock.calls[0][0].data.programId).toBeNull();
  });

  it("stores null when programId is omitted", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(admissionCreate.mock.calls[0][0].data.programId).toBeNull();
    expect(programFindFirst).not.toHaveBeenCalled();
  });
});

describe("POST /api/admission/submit — short lead", () => {
  it("creates a Baru website row from a parent name and a phone only", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "adm-1" });
    const data = admissionCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: "tenant_annisaa",
      parentName: "Ibu Fatimah",
      parentPhone: "081234567890",
      childName: "",
      dateOfBirth: null,
      childGender: null,
      parentEmail: null,
      source: "WEBSITE",
    });
    expect(data.status).toBeUndefined();
  });

  it("stores the child and relationship when the family filled them in", async () => {
    const res = await POST(
      req({
        ...VALID,
        parentRelationship: "AYAH",
        childName: "Aisyah Putri",
        dateOfBirth: "2021-03-15",
        childGender: "P",
        notes: "Ingin tahu biaya",
      }),
    );
    expect(res.status).toBe(201);
    expect(admissionCreate.mock.calls[0][0].data).toMatchObject({
      parentRelationship: "AYAH",
      childName: "Aisyah Putri",
      dateOfBirth: "2021-03-15",
      childGender: "P",
      notes: "Ingin tahu biaya",
    });
  });

  it("accepts an email as the only contact and sends the confirmation to it", async () => {
    const res = await POST(req({ parentName: "Ibu Fatimah", parentEmail: "fatimah@example.com" }));
    expect(res.status).toBe(201);
    expect(admissionCreate.mock.calls[0][0].data.parentPhone).toBeNull();
    expect(sendAdmissionSubmittedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_annisaa", to: "fatimah@example.com", childName: "" }),
    );
  });

  it("sends the confirmation to an address at most twice a day, but still answers 201", async () => {
    const email = { parentName: "Ibu Fatimah", parentEmail: "Fatimah@Example.com" };
    const statuses: number[] = [];
    for (const parentName of ["Ibu Fatimah", "Ibu Fatimah 2", "Ibu Fatimah 3"]) {
      statuses.push((await POST(req({ ...email, parentName }))).status);
    }
    expect(statuses).toEqual([201, 201, 201]);
    expect(admissionCreate).toHaveBeenCalledTimes(3);
    expect(sendAdmissionSubmittedEmail).toHaveBeenCalledTimes(2);
  });

  it("counts the email limit per address, not per submission", async () => {
    await POST(req({ parentName: "A", parentEmail: "a@example.com" }));
    await POST(req({ parentName: "B", parentEmail: "b@example.com" }));
    expect(sendAdmissionSubmittedEmail).toHaveBeenCalledTimes(2);
  });

  it("sends no email when the family left it blank", async () => {
    await POST(req(VALID));
    expect(sendAdmissionSubmittedEmail).not.toHaveBeenCalled();
  });

  it("rejects a submission with no contact and creates nothing", async () => {
    const res = await POST(req({ parentName: "Ibu Fatimah", childName: "Aisyah" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields.contact).toMatch(/minimal satu/i);
    expect(admissionCreate).not.toHaveBeenCalled();
  });

  it("runs sibling detection on every contact the family gave", async () => {
    detectSibling.mockResolvedValue({ parentId: "parent-1", matchReason: "PHONE" });
    const res = await POST(req({ ...VALID, parentWhatsapp: "0899 0000 1111" }));
    expect(res.status).toBe(201);
    expect(detectSibling).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant_annisaa", parentPhone: "081234567890", parentWhatsapp: "0899 0000 1111" }),
      expect.anything(),
    );
    expect(admissionUpdate).toHaveBeenCalledWith({
      where: { id: "adm-1" },
      data: { detectedParentId: "parent-1" },
    });
  });

  it("still answers 201 when sibling detection fails", async () => {
    detectSibling.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
  });
});

describe("POST /api/admission/submit — implausible birth date (PUBX-2)", () => {
  it.each([
    ["2035-01-01", /masa depan/],
    ["1900-01-01", /maksimal 8 tahun/],
  ])("rejects %s with an Indonesian message and creates nothing", async (dob, message) => {
    const res = await POST(req({ ...VALID, dateOfBirth: dob }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields.dateOfBirth).toMatch(message);
    expect(admissionCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admission/submit — duplicate submission (PUBX-2)", () => {
  const recent = (over: Record<string, unknown> = {}) => ({
    id: "adm-existing",
    parentName: "Ibu Fatimah",
    childName: "",
    parentPhone: "0812-3456-7890",
    parentWhatsapp: null,
    parentEmail: null,
    ...over,
  });

  it("returns the existing inquiry for the same name + phone digits inside 10 minutes", async () => {
    admissionFindMany.mockResolvedValue([
      recent({ id: "adm-other", parentPhone: "0899-0000-1111" }),
      recent(),
    ]);
    const res = await POST(req({ ...VALID, parentName: "  IBU fatimah ", parentPhone: "0812 3456 7890" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "adm-existing" });
    expect(admissionCreate).not.toHaveBeenCalled();
    expect(sendAdmissionSubmittedEmail).not.toHaveBeenCalled();

    const where = admissionFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("tenant_annisaa");
    expect(where.source).toBe("WEBSITE");
    // No name filter in SQL: ILIKE would treat "%" / "_" as wildcards.
    expect(where.parentName).toBeUndefined();
    const windowMs = Date.now() - where.createdAt.gte.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(windowMs).toBeLessThan(10 * 60_000 + 5000);
  });

  it("matches on email alone, case-insensitively", async () => {
    admissionFindMany.mockResolvedValue([recent({ parentPhone: null, parentEmail: "Fatimah@Example.com" })]);
    const res = await POST(req({ parentName: "Ibu Fatimah", parentEmail: "fatimah@example.com" }));
    expect(await res.json()).toEqual({ id: "adm-existing" });
    expect(admissionCreate).not.toHaveBeenCalled();
  });

  it("matches a WhatsApp number against the stored phone", async () => {
    admissionFindMany.mockResolvedValue([recent()]);
    const res = await POST(req({ parentName: "Ibu Fatimah", parentWhatsapp: "0812 3456 7890" }));
    expect(await res.json()).toEqual({ id: "adm-existing" });
  });

  it("creates a new row when no recent row shares a contact", async () => {
    admissionFindMany.mockResolvedValue([recent({ parentPhone: "0899-0000-1111" })]);
    const res = await POST(req(VALID));
    expect(await res.json()).toEqual({ id: "adm-1" });
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });

  it("does not merge a second child of the same parent", async () => {
    admissionFindMany.mockResolvedValue([recent({ childName: "Aisyah Putri" })]);
    const res = await POST(req({ ...VALID, childName: "Umar Putra" }));
    expect(await res.json()).toEqual({ id: "adm-1" });
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });

  it("merges when the child name matches, ignoring case and spacing", async () => {
    admissionFindMany.mockResolvedValue([recent({ childName: "Aisyah Putri" })]);
    const res = await POST(req({ ...VALID, childName: "  aisyah putri " }));
    expect(await res.json()).toEqual({ id: "adm-existing" });
  });

  it("creates a new row when the resubmit adds a child name the earlier row lacks (data is kept)", async () => {
    admissionFindMany.mockResolvedValue([recent({ childName: "" })]);
    const res = await POST(req({ ...VALID, childName: "Aisyah Putri" }));
    expect(await res.json()).toEqual({ id: "adm-1" });
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });

  it("merges a resubmit without a child name into an earlier row that has one", async () => {
    admissionFindMany.mockResolvedValue([recent({ childName: "Aisyah Putri" })]);
    const res = await POST(req(VALID));
    expect(await res.json()).toEqual({ id: "adm-existing" });
    expect(admissionCreate).not.toHaveBeenCalled();
  });

  it("does not match a different parent who shares the phone", async () => {
    admissionFindMany.mockResolvedValue([recent({ parentName: "Pak Umar" })]);
    const res = await POST(req(VALID));
    expect(await res.json()).toEqual({ id: "adm-1" });
  });

  it.each(["%", "_", "Ibu %", "I_u Fatimah"])(
    "treats parentName %j literally — it never matches another family's row",
    async (name) => {
      admissionFindMany.mockResolvedValue([recent()]);
      const res = await POST(req({ ...VALID, parentName: name }));
      expect(await res.json()).toEqual({ id: "adm-1" });
      expect(admissionCreate).toHaveBeenCalledTimes(1);
    },
  );

  it("still creates the row when the duplicate lookup fails", async () => {
    admissionFindMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admission/submit — rate limit", () => {
  it("answers 429 with Retry-After after 5 requests from one IP", async () => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await POST(req(VALID));
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
    expect(last!.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await last!.json()).toEqual({ error: "rate_limited" });
  });
});
