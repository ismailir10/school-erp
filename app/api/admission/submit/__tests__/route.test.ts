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
  childName: "Aisyah Putri",
  dateOfBirth: "2020-03-15",
  childGender: "P" as const,
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
  it("returns the existing inquiry for the same phone digits + name + DOB inside 10 minutes", async () => {
    admissionFindMany.mockResolvedValue([
      { id: "adm-other", parentPhone: "0899-0000-1111" },
      { id: "adm-existing", parentPhone: "0812-3456-7890" },
    ]);
    const res = await POST(
      req({ ...VALID, childName: "  aisyah putri ", parentPhone: "0812 3456 7890" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "adm-existing" });
    expect(admissionCreate).not.toHaveBeenCalled();
    expect(sendAdmissionSubmittedEmail).not.toHaveBeenCalled();

    const where = admissionFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe("tenant_annisaa");
    expect(where.dateOfBirth).toBe("2020-03-15");
    expect(where.childName).toEqual({ equals: "aisyah putri", mode: "insensitive" });
    const windowMs = Date.now() - where.createdAt.gte.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
    expect(windowMs).toBeLessThan(10 * 60_000 + 5000);
  });

  it("creates a new row when no recent row shares the phone digits", async () => {
    admissionFindMany.mockResolvedValue([{ id: "adm-other", parentPhone: "0899-0000-1111" }]);
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "adm-1" });
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });

  it("still creates the row when the duplicate lookup fails", async () => {
    admissionFindMany.mockRejectedValue(new Error("db down"));
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    expect(admissionCreate).toHaveBeenCalledTimes(1);
  });
});
