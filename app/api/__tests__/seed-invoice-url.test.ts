import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Exercises the REAL POST /api/admin/seed handler end-to-end (mocked prisma),
// focused on the xenditPaymentUrl decision: which invoice statuses get a
// payment link on CREATION (route.ts ~line 296, only SENT/PARTIALLY_PAID) vs.
// on BACKFILL of a pre-existing invoice (route.ts ~line 277, SENT/PARTIALLY_PAID/OVERDUE).
// A prior version of this test hand-copied both branches into one function and
// asserted OVERDUE gets a URL unconditionally — which is only true for backfill,
// not creation — and drifted silently from the route. This version imports the
// route directly so a future change to either branch fails the test that covers it.

const { db, session } = vi.hoisted(() => {
  const db = {
    academicYear: { findFirst: vi.fn() },
    campus: { findMany: vi.fn() },
    program: { upsert: vi.fn() },
    classSection: { findFirst: vi.fn(), create: vi.fn() },
    classTrack: { upsert: vi.fn() },
    student: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    parent: { create: vi.fn() },
    studentGuardian: { create: vi.fn() },
    user: { findFirst: vi.fn() },
    teachingAssignment: { upsert: vi.fn() },
    studentAttendance: { findFirst: vi.fn(), create: vi.fn() },
    feeComponentDef: { upsert: vi.fn() },
    programFeeStructure: { upsert: vi.fn() },
    studentEnrollment: { findMany: vi.fn() },
    invoice: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn() },
    webhookEvent: { upsert: vi.fn() },
    admission: { findFirst: vi.fn(), create: vi.fn() },
    studentFeeAdjustment: { findFirst: vi.fn(), create: vi.fn() },
    employee: { findFirst: vi.fn() },
    leaveRequest: { findFirst: vi.fn(), create: vi.fn() },
  };
  const session = { tenantId: "tnt-1", id: "u-admin", role: "SUPER_ADMIN" };
  return { db, session };
});

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => ({ success: true }),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn().mockResolvedValue(session) };
});

import { POST } from "../admin/seed/route";

const DEMO_URL = (invoiceNumber: string) =>
  `https://checkout-staging.xendit.co/web/demo-${invoiceNumber}`;

function makeReq() {
  return new NextRequest("http://localhost:3000/api/admin/seed", { method: "POST" });
}

/** Nine enrollments walk one full lap of the route's status cycle (PAID×3,
 * PARTIALLY_PAID×2, SENT×3, DRAFT×1) so creation-time URL logic is exercised
 * for every status it can actually produce. */
const ENROLLMENT_COUNT = 9;

beforeEach(() => {
  vi.clearAllMocks();

  db.academicYear.findFirst.mockResolvedValue({ id: "ay-1", name: "2025/2026" });
  db.campus.findMany.mockResolvedValue([{ id: "campus-1", name: "Taman Aster" }]);
  db.program.upsert.mockImplementation(({ create }) => Promise.resolve({ id: `prog-${create.code}` }));
  db.classSection.findFirst.mockResolvedValue({ id: "cls-1" });
  db.classTrack.upsert.mockResolvedValue({ id: "track-1" });

  // Student backfill loop (step 4): every seed student already exists, so the
  // route takes the idempotent skip branch and never calls student.create.
  db.student.findFirst.mockResolvedValue({ id: "existing-student" });

  // Teaching assignments (step 5) and payroll admin lookup (step 9) share
  // user.findFirst — distinguish by the where-clause shape the route uses.
  db.user.findFirst.mockImplementation(({ where }) =>
    Promise.resolve(where.email ? null : { id: "admin-1" }),
  );

  // Attendance loop (step 6): one already-enrolled student, attendance rows
  // already exist so no create() calls are needed.
  db.student.findMany.mockResolvedValue([
    { id: "att-student-1", enrollments: [{ classSectionId: "cls-1" }] },
  ]);
  db.studentAttendance.findFirst.mockResolvedValue({ id: "att-1" });

  db.feeComponentDef.upsert.mockImplementation(({ create }) =>
    Promise.resolve({ id: `fc-${create.code}` }),
  );
  db.programFeeStructure.upsert.mockResolvedValue({ id: "pfs-1" });

  // Invoices (step 9) — the section under test.
  db.studentEnrollment.findMany.mockResolvedValue(
    Array.from({ length: ENROLLMENT_COUNT }, (_, i) => ({
      student: { id: `student-${i}` },
      classSection: { program: { code: "TKIT" } },
    })),
  );
  // INV-2026-0001 (the first invoice in the loop) already exists as an OVERDUE
  // invoice seeded before the URL fix shipped — this is the backfill path.
  // Every other invoice number is new.
  db.invoice.findFirst.mockImplementation(({ where }) =>
    Promise.resolve(
      where.invoiceNumber === "INV-2026-0001"
        ? { id: "existing-inv-1", status: "OVERDUE", xenditPaymentUrl: null }
        : null,
    ),
  );
  db.invoice.create.mockImplementation(({ data }) => Promise.resolve({ id: `new-${data.invoiceNumber}` }));

  db.admission.findFirst.mockResolvedValue({ id: "adm-existing" });
  db.studentFeeAdjustment.findFirst.mockResolvedValue({ id: "adj-existing" });
  db.employee.findFirst.mockResolvedValue(null);
});

describe("POST /api/admin/seed — invoice xenditPaymentUrl", () => {
  it("backfills a pre-existing OVERDUE invoice with a null URL", async () => {
    await POST(makeReq());

    expect(db.invoice.update).toHaveBeenCalledWith({
      where: { id: "existing-inv-1" },
      data: { xenditPaymentUrl: DEMO_URL("INV-2026-0001"), paymentLinkExpiresAt: expect.any(Date) },
    });
  });

  it("does not backfill an invoice that already has a URL or isn't SENT/PARTIALLY_PAID/OVERDUE", async () => {
    db.invoice.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.invoiceNumber === "INV-2026-0001"
          ? { id: "existing-inv-1", status: "PAID", xenditPaymentUrl: null }
          : null,
      ),
    );

    await POST(makeReq());

    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it("sets a payment URL when creating a SENT or PARTIALLY_PAID invoice", async () => {
    await POST(makeReq());

    const created = db.invoice.create.mock.calls.map((c) => c[0].data);
    const sent = created.find((d) => d.status === "SENT");
    const partiallyPaid = created.find((d) => d.status === "PARTIALLY_PAID");

    expect(sent?.xenditPaymentUrl).toBe(DEMO_URL(sent.invoiceNumber));
    expect(partiallyPaid?.xenditPaymentUrl).toBe(DEMO_URL(partiallyPaid.invoiceNumber));
  });

  it("does NOT set a payment URL when creating a PAID or DRAFT invoice — creation excludes OVERDUE by construction, but PAID/DRAFT are the reachable null cases", async () => {
    await POST(makeReq());

    const created = db.invoice.create.mock.calls.map((c) => c[0].data);
    const paid = created.find((d) => d.status === "PAID");
    const draft = created.find((d) => d.status === "DRAFT");

    expect(paid?.xenditPaymentUrl).toBeNull();
    expect(draft?.xenditPaymentUrl).toBeNull();
  });

  it("seeds the link-expiry fixtures: future, past, no date, paid-with-past, early-expired with no link", async () => {
    await POST(makeReq());

    const byNumber = new Map(
      db.invoice.create.mock.calls.map((c) => [c[0].data.invoiceNumber as string, c[0].data]),
    );
    const now = Date.now();
    expect(byNumber.get("INV-2026-0980").paymentLinkExpiresAt.getTime()).toBeGreaterThan(now);
    expect(byNumber.get("INV-2026-0981").paymentLinkExpiresAt.getTime()).toBeLessThan(now);
    expect(byNumber.get("INV-2026-0981").status).toBe("SENT");
    expect(byNumber.get("INV-2026-0982").xenditPaymentUrl).not.toBeNull();
    expect(byNumber.get("INV-2026-0982").paymentLinkExpiresAt).toBeNull();
    expect(byNumber.get("INV-2026-0983").status).toBe("PAID");
    expect(byNumber.get("INV-2026-0983").paymentLinkExpiresAt.getTime()).toBeLessThan(now);
    const early = byNumber.get("INV-2026-0985");
    expect(early.status).toBe("SENT");
    expect(early).toMatchObject({ xenditPaymentUrl: null, xenditSessionId: null, paymentLinkExpiresAt: null });
    expect(early.dueDate > new Date().toISOString().slice(0, 10)).toBe(true);
    expect(["OVERDUE", "PARTIALLY_PAID"].every((st) => [...byNumber.values()].some((d) => d.status === st))).toBe(true);
    // The expired event hangs off 0984 only, and 0984's own link is current.
    expect(db.webhookEvent.upsert).toHaveBeenCalledTimes(1);
    expect(db.webhookEvent.upsert.mock.calls[0][0].create).toMatchObject({
      eventType: "payment_session.expired",
      status: "PROCESSED",
      invoiceId: "new-INV-2026-0984",
    });
    expect(byNumber.get("INV-2026-0984").paymentLinkExpiresAt.getTime()).toBeGreaterThan(now);
  });
});
