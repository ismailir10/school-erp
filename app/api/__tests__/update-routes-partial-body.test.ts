/**
 * Data-integrity cycle 2026-09-29 (CORE-1 / X-2, DRV-1, HR-7): a partial PUT
 * must only write the keys the client sent. Zod 4 applies `.default()` inside
 * `.partial()`, so status-only toggles used to reset admission `source`, journal
 * `order`, and employee bank/BPJS columns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth";

const db = vi.hoisted(() => ({
  admission: { findFirst: vi.fn(), update: vi.fn() },
  studentJournalCategory: { findUnique: vi.fn(), update: vi.fn() },
  studentJournalIndicator: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  employee: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  user: { findFirst: vi.fn() },
  campus: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true, remaining: 10 }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));

import { getSession } from "@/lib/auth";
import { PUT as admissionPut } from "../admissions/[id]/route";
import { PUT as categoryPut } from "../student-journal/categories/[id]/route";
import { PUT as indicatorPut } from "../student-journal/indicators/[id]/route";
import { PUT as employeePut } from "../employees/[id]/route";

const ADMIN: SessionUser = {
  id: "u1",
  email: "a@t.local",
  name: "Admin",
  role: "SUPER_ADMIN",
  tenantId: "t-1",
  employeeId: null,
  parentId: null,
  permissions: [],
  customRoleCode: null,
};

function put(body: unknown) {
  return new Request("http://localhost/api/x/1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}
const params = { params: Promise.resolve({ id: "id-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(ADMIN);
});

describe("PUT /api/admissions/[id]", () => {
  beforeEach(() => {
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ admission: db.admission, auditLog: { create: vi.fn() } }),
    );
  });

  it("status-only body writes only the status (source and contacts untouched; CORE-1 / X-2)", async () => {
    const existing = {
      id: "id-1",
      tenantId: "t-1",
      status: "INQUIRY",
      source: "WHATSAPP",
      childName: "Aisyah",
      parentName: "Ibu",
    };
    db.admission.findFirst.mockResolvedValue(existing);
    db.admission.update.mockImplementation(async ({ data }) => ({ ...existing, ...data }));

    const res = await admissionPut(put({ status: "VISIT_SCHEDULED" }), params);
    expect(res.status).toBe(200);
    expect(db.admission.update.mock.calls[0][0].data).toEqual({ status: "VISIT_SCHEDULED" });
  });

  it("source is not client-writable: a source in the body is ignored and nothing is written", async () => {
    const existing = { id: "id-1", tenantId: "t-1", status: "INQUIRY", source: "WHATSAPP" };
    db.admission.findFirst.mockResolvedValue(existing);
    const res = await admissionPut(put({ source: "REFERRAL" }), params);
    expect(res.status).toBe(200);
    expect(db.admission.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/student-journal/categories/[id]", () => {
  it("status-only toggle does not write order (DRV-1)", async () => {
    db.studentJournalCategory.findUnique.mockResolvedValue({
      id: "id-1",
      order: 4,
      template: { tenantId: "t-1" },
    });
    db.studentJournalCategory.update.mockResolvedValue({ id: "id-1", order: 4, status: "ACTIVE" });

    const res = await categoryPut(put({ status: "ACTIVE" }), params);
    expect(res.status).toBe(200);
    const data = db.studentJournalCategory.update.mock.calls[0][0].data;
    expect(data).toEqual({ status: "ACTIVE" });
    expect("order" in data).toBe(false);
  });

  it("deactivating (transaction path) does not write order either", async () => {
    db.studentJournalCategory.findUnique.mockResolvedValue({
      id: "id-1",
      order: 4,
      template: { tenantId: "t-1" },
    });
    db.$transaction.mockImplementation(async (fn) => fn(db));
    db.studentJournalCategory.update.mockResolvedValue({ id: "id-1" });
    db.studentJournalIndicator.updateMany.mockResolvedValue({ count: 0 });

    await categoryPut(put({ status: "INACTIVE" }), params);
    expect(db.studentJournalCategory.update.mock.calls[0][0].data).toEqual({ status: "INACTIVE" });
  });
});

describe("PUT /api/student-journal/indicators/[id]", () => {
  it("status-only toggle does not write order (DRV-1)", async () => {
    db.studentJournalIndicator.findUnique.mockResolvedValue({
      id: "id-1",
      categoryId: "cat-1",
      order: 3,
      category: { template: { tenantId: "t-1" } },
    });
    db.studentJournalIndicator.update.mockResolvedValue({ id: "id-1" });

    const res = await indicatorPut(put({ status: "INACTIVE" }), params);
    expect(res.status).toBe(200);
    expect(db.studentJournalIndicator.update.mock.calls[0][0].data).toEqual({ status: "INACTIVE" });
  });
});

describe("PUT /api/employees/[id]", () => {
  beforeEach(() => {
    db.employee.findUnique.mockResolvedValue({ id: "id-1", tenantId: "t-1", email: "old@t.local" });
    db.employee.findFirst.mockResolvedValue(null);
    db.user.findFirst.mockResolvedValue(null);
    db.employee.update.mockResolvedValue({ id: "id-1" });
  });

  it("email-only body does not wipe formalName/noHp/bank/bpjs (HR-7)", async () => {
    const res = await employeePut(put({ email: "new@t.local" }), params);
    expect(res.status).toBe(200);
    const data = db.employee.update.mock.calls[0][0].data;
    expect(data.email).toBe("new@t.local");
    for (const k of ["formalName", "noHp", "bankName", "bankAccountNo", "bpjsEnrolled"]) {
      expect(data[k], k).toBeUndefined();
    }
  });

  it("explicit blank / null still clears nullable columns", async () => {
    await employeePut(put({ noHp: "", formalName: null, bpjsEnrolled: false }), params);
    const data = db.employee.update.mock.calls[0][0].data;
    expect(data.noHp).toBeNull();
    expect(data.formalName).toBeNull();
    expect(data.bpjsEnrolled).toBe(false);
  });
});
