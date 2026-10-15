import { describe, it, expect, vi, beforeEach } from "vitest";
import { stageWhere, UNPAID_WHERE, STAGES } from "@/lib/admission/stage";

/**
 * GET /api/admissions — the unified Pendaftaran list (cycle 2026-10-11-pendaftaran-simplify, T8a).
 * Each row carries a derived `stage`, a `payment` and a lean `application`; the page carries
 * `stats` for the whole tenant. Prisma is the only mock; the where clauses are compared with the
 * ones `lib/admission/stage` builds (their meaning is tested against `deriveStage` there).
 */

type Session = {
  id: string;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "TEACHER" | "GUARDIAN";
  tenantId: string | null;
  email: string;
  name: string | null;
  employeeId: string | null;
  parentId: string | null;
  permissions: string[];
  customRoleCode: string | null;
};

const state = { session: null as Session | null };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => state.session) };
});

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  blocks: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { admission: { findMany: db.findMany, count: db.count }, enrollmentApplication: { findMany: db.blocks } },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(() => ({ success: true })), getClientIp: vi.fn(() => "1.1.1.1") }));

import { GET } from "../route";

function session(permissions: string[] = ["admissions.view", "admissions.edit"], role: Session["role"] = "SCHOOL_ADMIN"): Session {
  return { id: "u1", role, tenantId: "t1", email: "a@x", name: "A", employeeId: null, parentId: null, permissions, customRoleCode: null };
}

const get = (qs = "") => GET(new Request(`http://localhost/api/admissions${qs ? `?${qs}` : ""}`) as never);

type Row = Record<string, unknown>;
const lead = (over: Row = {}): Row => ({
  id: "a1",
  tenantId: "t1",
  childName: "Aisyah",
  parentName: "Ibu Aisyah",
  parentPhone: "081234567890",
  parentWhatsapp: null,
  parentEmail: null,
  status: "INQUIRY",
  studentId: null,
  program: { name: "KB" },
  detectedParent: null,
  enrollmentApplication: null,
  ...over,
});
const application = (over: Row = {}): Row => ({
  id: "e1",
  status: "INVITED",
  program: { name: "Day Care" },
  studentId: null,
  submittedAt: null,
  fee: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.session = session();
  db.findMany.mockResolvedValue([]);
  db.count.mockResolvedValue(0);
  db.blocks.mockResolvedValue([]);
});

const listWhere = () => db.findMany.mock.calls[0][0].where;
const rowsOf = async (rows: Row[]) => {
  db.findMany.mockResolvedValue(rows);
  db.count.mockResolvedValue(rows.length);
  const body = await (await get()).json();
  return body.data as Row[];
};

describe("GET /api/admissions — access", () => {
  it("401 without a session", async () => {
    state.session = null;
    expect((await get()).status).toBe(401);
  });

  it("answers an empty 200 (with zero stats) for a non-admin or a role without admissions.view", async () => {
    for (const s of [session(["admissions.view"], "TEACHER"), session([])]) {
      state.session = s;
      const res = await get();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
      expect(body.stats).toEqual({ total: 0, baru: 0, formulirDikirim: 0, belumBayar: 0, formulirMasuk: 0, diterima: 0, siswa: 0 });
    }
    expect(db.findMany).not.toHaveBeenCalled();
    expect(db.count).not.toHaveBeenCalled();
  });
});

describe("GET /api/admissions — item shape", () => {
  it("a bare lead is Baru with no payment and no application", async () => {
    const [item] = await rowsOf([lead()]);
    expect(item).toMatchObject({ id: "a1", childName: "Aisyah", stage: "BARU", payment: "NONE", application: null });
    expect(item).not.toHaveProperty("enrollmentApplication");
  });

  it("carries stage, payment and a lean application with the fee and canRemind", async () => {
    const submittedAt = new Date("2026-10-09T03:00:00Z");
    const [item] = await rowsOf([
      lead({
        enrollmentApplication: application({
          status: "SUBMITTED",
          submittedAt,
          fee: { status: "UNPAID", amount: "1500000.00" },
        }),
      }),
    ]);
    expect(item.stage).toBe("FORMULIR_MASUK");
    expect(item.payment).toBe("UNPAID");
    expect(item.application).toEqual({
      id: "e1",
      status: "SUBMITTED",
      programName: "Day Care",
      studentId: null,
      submittedAt: submittedAt.toISOString(),
      fee: { status: "UNPAID", amount: 1500000, canRemind: true },
    });
  });

  it("never exposes the token, a payment URL or the parents' form blocks", async () => {
    // A lead with no usable number makes the route read the form blocks for the reminder check.
    db.blocks.mockResolvedValue([{ id: "e1", ayahData: { name: "Bapak", phone: "081111111111" }, ibuData: null }]);
    const [item] = await rowsOf([
      lead({
        parentPhone: null,
        enrollmentApplication: application({
          accessToken: "secret-token",
          ayahData: { name: "Bapak", phone: "081111111111" },
          fee: { status: "UNPAID", amount: 100000, paymentUrl: "https://pay.example/x" },
        }),
      }),
    ]);
    const json = JSON.stringify(item);
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("pay.example");
    expect(json).not.toContain("081111111111");
    expect(json).not.toContain("ayahData");
    expect(Object.keys(item.application as object).sort()).toEqual(
      ["fee", "id", "programName", "status", "studentId", "submittedAt"],
    );
  });

  it("never selects the access token or the form blocks in the list query", async () => {
    await get();
    const select = db.findMany.mock.calls[0][0].include.enrollmentApplication.select;
    expect(Object.keys(select).sort()).toEqual(["fee", "id", "program", "status", "studentId", "submittedAt"]);
  });

  it.each([
    ["no application", lead(), "BARU", "NONE"],
    ["legacy VISITED lead", lead({ status: "VISITED" }), "BARU", "NONE"],
    ["legacy ADMITTED lead without formulir or student", lead({ status: "ADMITTED" }), "BARU", "NONE"],
    ["formulir sent, fee paid", lead({ enrollmentApplication: application({ fee: { status: "PAID", amount: 1 } }) }), "FORMULIR_DIKIRIM", "PAID"],
    ["legacy UNDER_REVIEW", lead({ enrollmentApplication: application({ status: "UNDER_REVIEW", fee: { status: "WAIVED", amount: 0 } }) }), "FORMULIR_MASUK", "WAIVED"],
    ["accepted", lead({ enrollmentApplication: application({ status: "ACCEPTED" }) }), "DITERIMA", "NONE"],
    ["rejected", lead({ enrollmentApplication: application({ status: "REJECTED" }) }), "DITOLAK", "NONE"],
    ["cancelled", lead({ status: "CANCELLED" }), "BATAL", "NONE"],
    ["rejected with an unpaid fee is dead: not Belum bayar", lead({ enrollmentApplication: application({ status: "REJECTED", fee: { status: "UNPAID", amount: 1 } }) }), "DITOLAK", "NONE"],
    ["cancelled with an unpaid fee is dead: not Belum bayar", lead({ status: "CANCELLED", enrollmentApplication: application({ fee: { status: "UNPAID", amount: 1 } }) }), "BATAL", "NONE"],
    ["cancelled with a paid fee keeps Lunas", lead({ status: "CANCELLED", enrollmentApplication: application({ fee: { status: "PAID", amount: 1 } }) }), "BATAL", "PAID"],
    ["lead linked to a student", lead({ status: "ADMITTED", studentId: "s1" }), "SISWA", "NONE"],
    ["application linked to a student", lead({ enrollmentApplication: application({ status: "ACCEPTED", studentId: "s1" }) }), "SISWA", "NONE"],
  ])("%s -> %s / %s", async (_name, row, stage, payment) => {
    const [item] = await rowsOf([row]);
    expect(item.stage).toBe(stage);
    expect(item.payment).toBe(payment);
  });
});

describe("GET /api/admissions — fee canRemind (same rule as the enrollments routes)", () => {
  const withFee = (appOver: Row, leadOver: Row = {}, feeStatus = "UNPAID") =>
    lead({ ...leadOver, enrollmentApplication: application({ ...appOver, fee: { status: feeStatus, amount: 500000 } }) });
  const remind = async (row: Row) => ((await rowsOf([row]))[0].application as { fee: { canRemind: boolean } }).fee.canRemind;

  it("true for an unpaid fee on a formulir that was only sent (pay-first) when a number exists", async () => {
    expect(await remind(withFee({ status: "INVITED" }))).toBe(true);
  });

  it("true for an unpaid fee on a submitted formulir", async () => {
    expect(await remind(withFee({ status: "SUBMITTED" }))).toBe(true);
  });

  it("false for a paid or waived fee", async () => {
    expect(await remind(withFee({}, {}, "PAID"))).toBe(false);
    expect(await remind(withFee({}, {}, "WAIVED"))).toBe(false);
  });

  it("false when the application is rejected or the lead is cancelled (the link is closed)", async () => {
    expect(await remind(withFee({ status: "REJECTED" }))).toBe(false);
    expect(await remind(withFee({}, { status: "CANCELLED" }))).toBe(false);
  });

  it("false when no number WhatsApp can open exists", async () => {
    expect(await remind(withFee({}, { parentPhone: null }))).toBe(false);
    expect(await remind(withFee({}, { parentPhone: "12" }))).toBe(false);
  });

  it("falls back to a phone written in the parent's form, read in ONE tenant-scoped query", async () => {
    db.blocks.mockResolvedValue([{ id: "e1", ayahData: null, ibuData: { phone: "081299998888" } }]);
    expect(await remind(withFee({}, { parentPhone: null }))).toBe(true);
    expect(db.blocks).toHaveBeenCalledTimes(1);
    expect(db.blocks).toHaveBeenCalledWith({
      where: { id: { in: ["e1"] }, tenantId: "t1" },
      select: { id: true, ayahData: true, ibuData: true },
    });
  });

  it("false when neither the lead nor the form has a number WhatsApp can open", async () => {
    db.blocks.mockResolvedValue([{ id: "e1", ayahData: { phone: "12" }, ibuData: null }]);
    expect(await remind(withFee({}, { parentPhone: null }))).toBe(false);
  });

  it("does not read the form blocks when every row is answered by the lead's own number", async () => {
    await rowsOf([withFee({ status: "INVITED" }), withFee({ status: "SUBMITTED" }, { id: "a2" })]);
    expect(db.blocks).not.toHaveBeenCalled();
  });

  it("reads the form blocks only for the rows that need them (unpaid, open, no lead number)", async () => {
    await rowsOf([
      withFee({ id: "e-need" }, { id: "a1", parentPhone: null }),
      withFee({ id: "e-has-phone" }, { id: "a2" }),
      withFee({ id: "e-paid" }, { id: "a3", parentPhone: null }, "PAID"),
      withFee({ id: "e-dead", status: "REJECTED" }, { id: "a4", parentPhone: null }),
      lead({ id: "a5", parentPhone: null }),
    ]);
    expect(db.blocks.mock.calls[0][0].where.id).toEqual({ in: ["e-need"] });
  });

  it("false for a viewer without admissions.edit, and the form blocks are not read", async () => {
    state.session = session(["admissions.view"]);
    expect(await remind(withFee({ status: "SUBMITTED" }, { parentPhone: null }))).toBe(false);
    expect(db.blocks).not.toHaveBeenCalled();
  });
});

describe("GET /api/admissions — filters (done in the database, pagination stays correct)", () => {
  it("always scopes to the caller's tenant", async () => {
    await get();
    expect(listWhere().tenantId).toBe("t1");
    expect(db.count.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("sorts by the requested column with id as the tiebreaker, so pages never repeat or skip a row", async () => {
    await get("sortBy=childName&sortOrder=asc");
    expect(db.findMany.mock.calls[0][0].orderBy).toEqual([{ childName: "asc" }, { id: "asc" }]);
    await get();
    expect(db.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
  });

  it.each(STAGES)("?tahap=%s adds that stage's predicate to the list AND its count", async (stage) => {
    await get(`tahap=${stage}&page=2&pageSize=10`);
    const { where, skip, take } = db.findMany.mock.calls[0][0];
    expect(where).toEqual({ tenantId: "t1", AND: [stageWhere(stage)] });
    expect(skip).toBe(10);
    expect(take).toBe(10);
    // The total that pagination reads is counted with the very same where.
    expect(db.count).toHaveBeenCalledWith({ where });
  });

  it("?payment=unpaid adds the Belum bayar predicate", async () => {
    await get("payment=unpaid");
    expect(listWhere()).toEqual({ tenantId: "t1", AND: [UNPAID_WHERE] });
  });

  it("composes tahap, payment and search", async () => {
    await get("tahap=FORMULIR_DIKIRIM&payment=unpaid&search=aisy");
    expect(listWhere()).toEqual({
      tenantId: "t1",
      AND: [
        stageWhere("FORMULIR_DIKIRIM"),
        UNPAID_WHERE,
        {
          OR: [
            { childName: { contains: "aisy", mode: "insensitive" } },
            { parentName: { contains: "aisy", mode: "insensitive" } },
            { parentPhone: { contains: "aisy", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("ignores the retired ?status= param, an unknown ?tahap= and any other ?payment= value", async () => {
    await get("status=VISITED&tahap=NOPE&payment=paid");
    expect(listWhere()).toEqual({ tenantId: "t1" });
  });

  it("treats ?tahap=all (the UI's 'every stage') as no filter", async () => {
    await get("tahap=all");
    expect(listWhere()).toEqual({ tenantId: "t1" });
  });
});

describe("GET /api/admissions — stats", () => {
  it("counts the whole tenant in one batch, unaffected by search or filters", async () => {
    const counts = new Map<string, number>([
      [JSON.stringify({ tenantId: "t1" }), 40],
      [JSON.stringify({ tenantId: "t1", AND: [stageWhere("BARU")] }), 12],
      [JSON.stringify({ tenantId: "t1", AND: [stageWhere("FORMULIR_DIKIRIM")] }), 9],
      [JSON.stringify({ tenantId: "t1", AND: [UNPAID_WHERE] }), 5],
      [JSON.stringify({ tenantId: "t1", AND: [stageWhere("FORMULIR_MASUK")] }), 6],
      [JSON.stringify({ tenantId: "t1", AND: [stageWhere("DITERIMA")] }), 2],
      [JSON.stringify({ tenantId: "t1", AND: [stageWhere("SISWA")] }), 7],
    ]);
    db.count.mockImplementation(async ({ where }: { where: unknown }) => counts.get(JSON.stringify(where)) ?? 999);

    const body = await (await get("tahap=BATAL&payment=unpaid&search=zzz")).json();

    expect(body.stats).toEqual({ total: 40, baru: 12, formulirDikirim: 9, belumBayar: 5, formulirMasuk: 6, diterima: 2, siswa: 7 });
    // None of the stat queries saw the search or the filters.
    for (const [{ where }] of db.count.mock.calls.slice(1)) {
      expect(JSON.stringify(where)).not.toContain("zzz");
    }
  });

  it("with no filter the tenant total is the list total: one count less", async () => {
    db.count.mockResolvedValue(5);
    const body = await (await get()).json();
    expect(body.stats.total).toBe(5);
    expect(db.count).toHaveBeenCalledTimes(7); // list total + five stage counts + belum bayar
  });

  it("with a filter the tenant total is counted separately", async () => {
    await get("search=abc");
    expect(db.count).toHaveBeenCalledTimes(8);
    expect(db.count).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
  });

  it("every stat query is tenant-scoped", async () => {
    await get();
    for (const [{ where }] of db.count.mock.calls) expect(where.tenantId).toBe("t1");
  });

  it("returns canEdit and the usual pagination envelope", async () => {
    db.findMany.mockResolvedValue([lead()]);
    db.count.mockResolvedValue(1);
    const body = await (await get()).json();
    expect(body.canEdit).toBe(true);
    expect(body.pagination).toMatchObject({ page: 1, total: 1 });
    state.session = session(["admissions.view"]);
    expect((await (await get()).json()).canEdit).toBe(false);
  });
});
