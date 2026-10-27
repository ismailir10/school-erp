import { describe, it, expect, vi, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
// Regression for the 2026-09-23 production incident (docs/cycles/
// 2026-09-23-guardian-primary-fix.md). Creating a student's first guardian
// through the dossier's "Tambah wali baru" path used to send an explicit
// `isPrimary: false` on the CREATE payload, which defeated the server's
// `isPrimary ?? priorGuardianCount === 0` default (FIND-010). The junction
// row landed non-primary, the manual invoice raised for that student got
// `parentId: null`, and the DOKU Checkout session had no `customerEmail` /
// `customerName` to reach the family — both rows had to be hand-patched with
// SQL. T1 fixed the client (`guardianCreatePayload` omits the key unless the
// Switch is on); this spec proves the fix holds across the whole chain —
// guardian create → manual invoice → payment-gateway session — and that the
// OLD client body would have failed it.
// ──────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// `vi.mock("@/lib/db", ...)` below is hoisted above this file's top-level
// statements by Vitest, so any variable its factory closes over (`state`,
// `dbFake`) must itself be created inside `vi.hoisted` — otherwise the
// factory runs against a `const` that hasn't been initialised yet (TDZ).
const { state, dbFake } = vi.hoisted(() => {
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }

  const state = {
    students: [] as Array<{ id: string; tenantId: string; name: string; status: string }>,
    parents: [] as Array<{
      id: string;
      tenantId: string;
      name: string;
      email: string | null;
      phone: string | null;
      whatsapp: string | null;
      nik: string | null;
    }>,
    guardians: [] as Array<{
      id: string;
      studentId: string;
      parentId: string;
      relationship: string;
      isPrimary: boolean;
      status: string;
      childOrder: number | null;
    }>,
    enrollments: [] as Array<{ studentId: string; status: string; tenantId: string }>,
    feeComponents: [] as Array<{ id: string; tenantId: string; isEnabled: boolean; label: string }>,
    invoices: [] as Row[],
    invoiceLines: [] as Row[],
    parentSeq: 0,
    guardianSeq: 0,
    invoiceSeq: 0,
    lineSeq: 0,
    numberSeq: 0,
  };

  // ── in-memory Prisma fake ──────────────────────────────────────────────
  // Covers only the calls the three handlers under test actually make. Every
  // where-clause that matters to the invariant being proven — `isPrimary:
  // true`, `status: "ACTIVE"`, `studentId` — is applied against the
  // in-memory rows via `matches()`, not stubbed to a canned value, so a
  // handler that forgot the filter would fail the test.
  const dbFake = {
  student: {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const s = state.students.find((s) => matches(s, where));
      return s ? { ...s } : null;
    }),
  },
  employee: {
    findFirst: vi.fn(async () => null),
  },
  parent: {
    upsert: vi.fn(async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = where.tenantId_email as { tenantId: string; email: string };
      const found = state.parents.find((p) => p.tenantId === key.tenantId && p.email === key.email);
      if (found) {
        Object.assign(found, update);
        return { ...found };
      }
      const row = { id: `p-${++state.parentSeq}`, ...create } as (typeof state.parents)[number];
      state.parents.push(row);
      return { ...row };
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `p-${++state.parentSeq}`, ...data } as (typeof state.parents)[number];
      state.parents.push(row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const p = state.parents.find((p) => matches(p, where));
      return p ? { id: p.id } : null;
    }),
    findMany: vi.fn(async () => []),
  },
  studentGuardian: {
    count: vi.fn(async ({ where }: { where: Row }) =>
      state.guardians.filter((g) => matches(g, where)).length,
    ),
    findFirst: vi.fn(async ({ where, select }: { where: Row; select?: Row }) => {
      const g = state.guardians.find((g) => matches(g, where));
      if (!g) return null;
      if (select?.parentId) return { parentId: g.parentId };
      return { ...g };
    }),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data, include }: { data: Row; include?: Row }) => {
      const row = {
        id: `sg-${++state.guardianSeq}`,
        studentId: data.studentId as string,
        parentId: data.parentId as string,
        relationship: data.relationship as string,
        isPrimary: Boolean(data.isPrimary ?? false),
        childOrder: (data.childOrder as number | null | undefined) ?? null,
        status: "ACTIVE",
      };
      state.guardians.push(row);
      const result: Row = { ...row };
      if (include?.parent) {
        result.parent = state.parents.find((p) => p.id === row.parentId) ?? null;
      }
      return result;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const g of state.guardians) {
        if (matches(g, where)) {
          Object.assign(g, data);
          count++;
        }
      }
      return { count };
    }),
  },
  studentEnrollment: {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const cs = where.classSection as { tenantId?: string } | undefined;
      const found = state.enrollments.find(
        (e) =>
          e.studentId === where.studentId &&
          e.status === where.status &&
          (cs?.tenantId === undefined || e.tenantId === cs.tenantId),
      );
      return found ? { studentId: found.studentId } : null;
    }),
  },
  feeComponentDef: {
    findMany: vi.fn(async ({ where }: { where: Row }) => {
      const idFilter = where.id as { in: string[] };
      return state.feeComponents
        .filter(
          (f) =>
            idFilter.in.includes(f.id) &&
            f.tenantId === where.tenantId &&
            f.isEnabled === where.isEnabled,
        )
        .map((f) => ({ id: f.id, label: f.label }));
    }),
  },
  invoice: {
    create: vi.fn(async ({ data, select }: { data: Row; select?: Row }) => {
      const { lines, ...rest } = data as Row & { lines?: { create: Row[] } };
      const row: Row = {
        id: `inv-${++state.invoiceSeq}`,
        ...rest,
        totalPaid: 0,
        xenditPaymentUrl: null,
        xenditSessionId: null,
        paymentLinkError: null,
        sentAt: null,
      };
      state.invoices.push(row);
      if (lines?.create) {
        for (const l of lines.create) {
          state.invoiceLines.push({ id: `il-${++state.lineSeq}`, invoiceId: row.id, ...l });
        }
      }
      if (select?.id) return { id: row.id };
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where, include }: { where: Row; include?: Row }) => {
      const inv = state.invoices.find((i) => i.id === where.id);
      if (!inv) return null;
      const result: Row = { ...inv };
      if (include?.lines) {
        result.lines = state.invoiceLines.filter((l) => l.invoiceId === inv.id);
      }
      if (include?.student) {
        const student = state.students.find((s) => s.id === inv.studentId);
        const studentResult: Row | null = student ? { ...student } : null;
        const studentInclude = (include.student as Row).include as Row | undefined;
        const guardianSpec = studentInclude?.guardians as Row | undefined;
        if (studentResult && guardianSpec) {
          let guardians = state.guardians.filter((g) => g.studentId === student!.id);
          if (guardianSpec.where) {
            guardians = guardians.filter((g) => matches(g, guardianSpec.where as Row));
          }
          if (typeof guardianSpec.take === "number") {
            guardians = guardians.slice(0, guardianSpec.take);
          }
          const guardianInclude = guardianSpec.include as Row | undefined;
          let guardianRows: Row[] = guardians;
          if (guardianInclude?.parent) {
            guardianRows = guardians.map((g) => ({
              ...g,
              parent: state.parents.find((p) => p.id === g.parentId) ?? null,
            }));
          }
          studentResult.guardians = guardianRows;
        }
        result.student = studentResult;
      }
      return result;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const inv = state.invoices.find((i) => i.id === where.id);
      if (inv) Object.assign(inv, data);
      return inv ? { ...inv } : null;
    }),
    // The payment-session helper claims the invoice and persists the link through conditional
    // `updateMany`s (cycle 2026-10-17-payment-link-on-demand); evaluate just those shapes.
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const test = (inv: Row, w: Row): boolean =>
        Object.entries(w).every(([key, cond]) => {
          if (key === "OR") return (cond as Row[]).some((o) => test(inv, o));
          const v = inv[key];
          if (cond === null) return v === null || v === undefined;
          if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
          if (typeof cond === "object") {
            const c = cond as Row;
            if ("notIn" in c) return !(c.notIn as unknown[]).includes(v);
            if ("lt" in c) return v instanceof Date && v.getTime() < (c.lt as Date).getTime();
            if ("lte" in c) return v instanceof Date && v.getTime() <= (c.lte as Date).getTime();
          }
          return v === cond;
        });
      const inv = state.invoices.find((i) => i.id === where.id);
      if (!inv || !test(inv, where)) return { count: 0 };
      Object.assign(inv, data);
      return { count: 1 };
    }),
  },
    $queryRaw: vi.fn(async () => [{ lastNumber: ++state.numberSeq }]),
    $transaction: vi.fn(async (cb: unknown) => {
      if (typeof cb === "function") return (cb as (tx: typeof dbFake) => unknown)(dbFake);
      return null;
    }),
  };

  return { state, dbFake };
});

function resetState() {
  state.students = [{ id: "s1", tenantId: "t1", name: "Anak Testing", status: "ACTIVE" }];
  state.parents = [];
  state.guardians = [];
  state.enrollments = [{ studentId: "s1", status: "ACTIVE", tenantId: "t1" }];
  state.feeComponents = [{ id: "fc-1", tenantId: "t1", isEnabled: true, label: "SPP" }];
  state.invoices = [];
  state.invoiceLines = [];
  state.parentSeq = 0;
  state.guardianSeq = 0;
  state.invoiceSeq = 0;
  state.lineSeq = 0;
  state.numberSeq = 0;
}

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => adminSession()) };
});

vi.mock("@/lib/db", () => ({ prisma: dbFake }));

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
// POST /api/invoices audits the created invoice inside its transaction; the fake has no auditLog table.
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
// The guardian routes evict the parent-children cache; stub it (parent-helpers builds unstable_cache at import).
vi.mock("@/lib/parent-helpers", () => ({ invalidateParentChildren: vi.fn() }));

// The gateway is the only boundary mocked for the payment-session leg — the
// rest of `createPaymentSessionForInvoice` (expiry, retry, guardian lookup)
// runs for real against the fake Prisma above.
const createSession = vi.fn();
vi.mock("@/lib/payments/registry", () => ({
  getGateway: () => ({ id: "test-gateway", createSession }),
}));

function adminSession() {
  return {
    id: "u1",
    role: "SCHOOL_ADMIN" as const,
    tenantId: "t1",
    email: "admin@example.com",
    name: "Admin",
    employeeId: null,
    parentId: null,
    permissions: ["invoices.create", "students.edit"] as string[],
    customRoleCode: null,
  };
}

import { POST as postGuardian } from "../students/[id]/guardians/route";
import { POST as postInvoice } from "../invoices/route";
import { createPaymentSessionForInvoice } from "@/lib/payments/session";
import {
  guardianCreatePayload,
  EMPTY_GUARDIAN_FORM,
  type GuardianForm,
} from "@/components/admin/guardian-edit-dialog";

function postGuardianReq(body: Row) {
  const req = new Request("http://localhost/api/students/s1/guardians", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return postGuardian(req as never, { params: Promise.resolve({ id: "s1" }) });
}

function postInvoiceReq(body: Row) {
  const req = new Request("http://localhost:3000/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return postInvoice(req as never);
}

const invoiceBody = {
  studentId: "s1",
  periodLabel: "Oktober 2026",
  dueDate: "2026-10-31",
  lines: [{ feeComponentId: "fc-1", amount: 500_000 }],
};

beforeEach(() => {
  resetState();
  createSession.mockReset();
  createSession.mockResolvedValue({
    id: "gw-session-1",
    paymentUrl: "https://pay.example.test/session-1",
    status: "PENDING",
    expiresAt: new Date().toISOString(),
  });
});

describe("guardianCreatePayload — the T1 client fix", () => {
  it("omits isPrimary from the CREATE payload built the way the dossier now does", () => {
    const form: GuardianForm = {
      ...EMPTY_GUARDIAN_FORM,
      name: "Siti Aminah",
      relationship: "IBU",
      email: "siti@example.test",
      phone: "081234567890",
    };
    const payload = guardianCreatePayload(form) as Row;
    expect(payload).not.toHaveProperty("isPrimary");
  });
});

describe("guardian create -> manual invoice -> payment session (2026-09-23 chain)", () => {
  it("first guardian via the fixed client payload becomes primary, bills to that parent, and reaches them by email", async () => {
    const form: GuardianForm = {
      ...EMPTY_GUARDIAN_FORM,
      name: "Siti Aminah",
      relationship: "IBU",
      email: "siti@example.test",
      phone: "081234567890",
    };
    const body = { ...guardianCreatePayload(form), confirmNew: true };
    expect(body).not.toHaveProperty("isPrimary");

    // Step 1+2: create the student's first guardian for real, through the
    // create-new-parent branch of POST /api/students/[id]/guardians.
    const guardianRes = await postGuardian(
      new Request("http://localhost/api/students/s1/guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(guardianRes.status).toBe(201);
    const guardianJson = await guardianRes.json();
    expect(guardianJson.isPrimary).toBe(true);
    expect(state.guardians).toHaveLength(1);
    expect(state.guardians[0]).toMatchObject({ isPrimary: true, status: "ACTIVE" });
    const parentId = state.guardians[0].parentId;
    expect(state.parents.find((p) => p.id === parentId)).toMatchObject({
      name: "Siti Aminah",
      email: "siti@example.test",
    });

    // Step 3: raise a manual invoice for the same student.
    const invoiceRes = await postInvoiceReq(invoiceBody);
    expect(invoiceRes.status).toBe(201);
    expect(state.invoices).toHaveLength(1);
    expect(state.invoices[0].parentId).toBe(parentId);
    expect(state.invoices[0].parentId).not.toBeNull();

    // Step 4: create a payment-gateway session for that invoice directly,
    // with the gateway mocked, and inspect exactly what it was handed.
    createSession.mockClear();
    const invoiceId = state.invoices[0].id as string;
    // Raising the invoice already made its link; an invoice that holds one is never given a second
    // (cycle 2026-10-17-payment-link-on-demand). Clear it, as the expiry sweep does, so this step
    // can inspect what the gateway is handed when a link is made.
    Object.assign(state.invoices[0], { xenditPaymentUrl: null, xenditSessionId: null, paymentCheckedAt: null });
    const session = await createPaymentSessionForInvoice(invoiceId, "t1", "https://app.example.test");
    expect(session).not.toBeNull();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0][0]).toMatchObject({
      customerEmail: "siti@example.test",
      customerName: "Siti Aminah",
    });
  });

  it("negative control — the OLD client body (isPrimary: false) reproduces the production bug", async () => {
    // Pre-T1 behaviour: EMPTY_GUARDIAN_FORM spread straight into the POST
    // body, asserting an explicit `isPrimary: false` the admin never chose.
    const oldBody = {
      name: "Siti Aminah",
      relationship: "IBU",
      email: "siti@example.test",
      phone: "081234567890",
      isPrimary: false,
      confirmNew: true,
    };

    const guardianRes = await postGuardianReq(oldBody);
    expect(guardianRes.status).toBe(201);
    const guardianJson = await guardianRes.json();
    // The bug: server default never fires because the key is present.
    expect(guardianJson.isPrimary).toBe(false);
    expect(state.guardians[0]).toMatchObject({ isPrimary: false });

    const invoiceRes = await postInvoiceReq(invoiceBody);
    expect(invoiceRes.status).toBe(201);
    // This is the production incident: no ACTIVE primary guardian exists, so
    // the billing-parent lookup in POST /api/invoices finds nothing.
    expect(state.invoices[0].parentId).toBeNull();

    createSession.mockClear();
    const invoiceId = state.invoices[0].id as string;
    Object.assign(state.invoices[0], { xenditPaymentUrl: null, xenditSessionId: null, paymentCheckedAt: null });
    await createPaymentSessionForInvoice(invoiceId, "t1", "https://app.example.test");
    expect(createSession).toHaveBeenCalledTimes(1);
    // No guardian to bill → DOKU/Xendit gets the student's name and no email
    // at all, exactly what stranded the parent in production.
    expect(createSession.mock.calls[0][0].customerEmail).toBeUndefined();
    expect(createSession.mock.calls[0][0].customerName).toBe("Anak Testing");
  });
});

describe("manual invoice for a student with no class (SPMB applicant, 2026-09-25)", () => {
  it("bills an ACTIVE student who has no enrollment and reaches the primary guardian", async () => {
    // A converted applicant: Student + guardian exist, next year's classes don't.
    state.enrollments = [];
    const guardianRes = await postGuardianReq({
      ...guardianCreatePayload({
        ...EMPTY_GUARDIAN_FORM,
        name: "Siti Aminah",
        relationship: "IBU",
        email: "siti@example.test",
        phone: "081234567890",
      }),
      confirmNew: true,
    });
    expect(guardianRes.status).toBe(201);

    const invoiceRes = await postInvoiceReq(invoiceBody);
    expect(invoiceRes.status).toBe(201);
    expect(state.invoices).toHaveLength(1);
    expect(state.invoices[0].parentId).toBe(state.guardians[0].parentId);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession.mock.calls[0][0]).toMatchObject({ customerEmail: "siti@example.test" });
  });

  it("rejects a student who is not ACTIVE", async () => {
    state.students[0].status = "WITHDRAWN";
    const res = await postInvoiceReq(invoiceBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tidak ditemukan atau tidak aktif/i);
    expect(state.invoices).toHaveLength(0);
  });

  it("rejects a student from another tenant", async () => {
    state.students[0].tenantId = "t2";
    const res = await postInvoiceReq(invoiceBody);
    expect(res.status).toBe(400);
    expect(state.invoices).toHaveLength(0);
  });
});
