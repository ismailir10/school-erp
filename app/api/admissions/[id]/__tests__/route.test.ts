import { describe, it, expect, vi, beforeEach } from "vitest";

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

type AdmissionRow = {
  id: string;
  tenantId: string;
  childName: string;
  childAge: string | null;
  childGender: string | null;
  dateOfBirth: string | null;
  parentName: string;
  parentPhone: string | null;
  parentWhatsapp: string | null;
  parentEmail: string | null;
  parentEducation: string | null;
  parentOccupation: string | null;
  parentIncome: string | null;
  parentRelationship: string | null;
  programId: string | null;
  campusPreference: string | null;
  source: string;
  notes: string | null;
  followUpDate: string | null;
  status: string;
};

const state = {
  session: null as Session | null,
  admission: null as AdmissionRow | null,
  lastUpdate: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  updateWheres: [] as Array<{ id: string; tenantId?: string }>,
  programs: ["prog-1"] as string[],
};

const detect = vi.hoisted(() => ({ detectSibling: vi.fn() }));
const audit = vi.hoisted(() => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/admission/sibling-detect", () => detect);
vi.mock("@/lib/audit", () => audit);

// isAdminRole is the REAL implementation (importOriginal), not a hand-copied
// mirror — a role/tenant-boundary test asserting against a re-typed stand-in
// would only prove the stand-in matches itself, not that the route's actual
// gate holds.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => state.session) };
});

vi.mock("@/lib/db", () => {
  const admission = {
    // The route must filter by tenant in the query itself.
    findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) => {
      if (!state.admission || state.admission.id !== where.id || state.admission.tenantId !== where.tenantId) return null;
      return { ...state.admission };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string; tenantId?: string }; data: Record<string, unknown> }) => {
      state.updateWheres.push(where);
      state.updates.push(data);
      if (!("detectedParentId" in data)) state.lastUpdate = data;
      return { ...state.admission, ...data };
    }),
  };
  const prisma = {
    admission,
    program: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.programs.includes(where.id) ? { id: where.id } : null,
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ admission })),
  };
  return { prisma };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => "1.1.1.1"),
}));

import { PUT } from "../route";

function adminSession(): Session {
  return {
    id: "u1",
    role: "SCHOOL_ADMIN",
    tenantId: "t1",
    email: "a@x",
    name: "A",
    employeeId: null,
    parentId: null,
    permissions: ["admissions.view", "admissions.edit"],
    customRoleCode: null,
  };
}

function freshAdmission(overrides: Partial<AdmissionRow> = {}): AdmissionRow {
  return {
    id: "a1",
    tenantId: "t1",
    childName: "Aisyah",
    childAge: null,
    childGender: "P",
    dateOfBirth: "2018-03-15",
    parentName: "Ibu Fatimah",
    parentPhone: null,
    parentWhatsapp: null,
    parentEmail: null,
    parentEducation: null,
    parentOccupation: null,
    parentIncome: null,
    parentRelationship: null,
    programId: null,
    campusPreference: null,
    source: "WALK_IN",
    notes: null,
    followUpDate: null,
    status: "INQUIRY",
    ...overrides,
  };
}

function putReq(body: unknown): Request {
  return new Request("http://x/api/admissions/a1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "a1" });

beforeEach(() => {
  state.session = adminSession();
  state.admission = freshAdmission();
  state.lastUpdate = null;
  state.updates = [];
  state.updateWheres = [];
  state.programs = ["prog-1"];
  detect.detectSibling.mockReset();
  detect.detectSibling.mockResolvedValue(null);
  audit.recordAudit.mockClear();
});

describe("PUT /api/admissions/[id] — a key present in the body is written, even blank", () => {
  it("clears an optional contact sent as a blank string", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", parentEmail: "ibu@example.com" });
    const res = await PUT(putReq({ parentEmail: "" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ parentEmail: null });
  });

  it.each([
    ["notes", "Catatan lama"],
    ["dateOfBirth", "2020-01-02"],
    ["childGender", "L"],
    ["parentRelationship", "IBU"],
    ["programId", "prog-1"],
  ])("clears %s when the body sends it blank", async (key, previous) => {
    state.admission = freshAdmission({ parentPhone: "0811", [key]: previous });
    const res = await PUT(putReq({ [key]: "" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ [key]: null });
  });

  it("stores a cleared child name as an empty string (the column is NOT NULL)", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    const res = await PUT(putReq({ childName: "   " }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ childName: "" });
  });

  it("leaves every key that is not in the body alone", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", notes: "Jangan hilang" });
    const res = await PUT(putReq({ childName: "Aisyah Putri" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ childName: "Aisyah Putri" });
  });

  it("trims values it writes", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    await PUT(putReq({ parentName: "  Ibu Dewi ", parentWhatsapp: " 0822 " }) as never, { params });
    expect(state.lastUpdate).toEqual({ parentName: "Ibu Dewi", parentWhatsapp: "0822" });
  });

  it("no longer writes the removed lead fields, even when an old client still sends them", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    const res = await PUT(
      putReq({
        notes: "ok",
        parentEducation: "S1",
        parentOccupation: "Guru",
        parentIncome: "5-10 juta",
        campusPreference: "campus-1",
        followUpDate: "2026-11-01",
        source: "REFERRAL",
      }) as never,
      { params },
    );
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ notes: "ok" });
  });

  it("rejects a malformed email with a 400 and writes nothing", async () => {
    const res = await PUT(putReq({ parentEmail: "bukan-email" }) as never, { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects a blank parent name with a 400 and writes nothing", async () => {
    const res = await PUT(putReq({ parentName: "  " }) as never, { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});

describe("PUT /api/admissions/[id] — the merged row keeps a contact", () => {
  const CONTACT_MESSAGE = "Isi minimal satu kontak: No. HP, WhatsApp atau Email";

  it("rejects clearing the only contact, names the field, and writes nothing", async () => {
    state.admission = freshAdmission({ parentEmail: "ibu@example.com" });
    const res = await PUT(putReq({ parentEmail: "" }) as never, { params });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: Array<{ field: string; message: string }> };
    expect(body.error).toBe("Validasi gagal");
    expect(body).not.toHaveProperty("issues");
    expect(body.errors).toEqual([{ field: "parentPhone", message: CONTACT_MESSAGE }]);
    expect(state.updates).toHaveLength(0);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("allows clearing one contact while another remains", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", parentEmail: "ibu@example.com" });
    const res = await PUT(putReq({ parentEmail: "" }) as never, { params });
    expect(res.status).toBe(200);
  });

  it("allows swapping the only contact for another in one request", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    const res = await PUT(putReq({ parentPhone: "", parentWhatsapp: "0822" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ parentPhone: null, parentWhatsapp: "0822" });
  });

  it("does not block a status change or a note on an older lead that never had a contact", async () => {
    state.admission = freshAdmission();
    expect((await PUT(putReq({ status: "CANCELLED" }) as never, { params })).status).toBe(200);
    expect((await PUT(putReq({ notes: "Telepon dulu" }) as never, { params })).status).toBe(200);
  });
});

describe("PUT /api/admissions/[id] — audit and sibling detection", () => {
  it("writes an Admission update audit row naming the changed fields but no values", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", notes: "lama" });
    const res = await PUT(putReq({ notes: "baru", parentPhone: "0811" }) as never, { params });
    expect(res.status).toBe(200);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    const [entry] = audit.recordAudit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      tenantId: "t1",
      actorId: "u1",
      entity: "Admission",
      entityId: "a1",
      action: "update",
      after: { changedFields: ["notes"] },
    });
    expect(JSON.stringify(entry)).not.toContain("baru");
    expect(JSON.stringify(entry)).not.toContain("0811");
  });

  it("records the status in the audit row when it changes", async () => {
    await PUT(putReq({ status: "CANCELLED" }) as never, { params });
    const [entry] = audit.recordAudit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({ before: { status: "INQUIRY" }, after: { status: "CANCELLED" } });
  });

  it("re-runs sibling detection when a contact changed and stamps the match", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    detect.detectSibling.mockResolvedValue({ parentId: "par-1", matchReason: "phone" });
    const res = await PUT(putReq({ parentPhone: "0899" }) as never, { params });
    expect(res.status).toBe(200);
    expect(detect.detectSibling).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", parentPhone: "0899" }),
      expect.anything(),
    );
    expect(state.updates).toContainEqual({ detectedParentId: "par-1" });
    expect(state.updateWheres.every((w) => w.tenantId === "t1")).toBe(true);
  });

  it("does not run detection when no contact changed", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    await PUT(putReq({ notes: "x", parentPhone: "0811" }) as never, { params });
    expect(detect.detectSibling).not.toHaveBeenCalled();
  });

  it("still returns 200 when detection throws", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    detect.detectSibling.mockRejectedValue(new Error("db down"));
    const res = await PUT(putReq({ parentPhone: "0899" }) as never, { params });
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/admissions/[id] — program is tenant-scoped", () => {
  it("rejects a program that is not this school's, writes nothing", async () => {
    const res = await PUT(putReq({ programId: "prog-of-another-school" }) as never, { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});

describe("PUT /api/admissions/[id] — null, no-op and legacy rows", () => {
  const CONTACT_MESSAGE = "Isi minimal satu kontak: No. HP, WhatsApp atau Email";

  it("reads null as clear, so a client that round-trips a GET row can empty a field", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", parentEmail: "ibu@example.com" });
    const res = await PUT(putReq({ parentPhone: null }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ parentPhone: null });
  });

  it("rejects null on the only contact like a blank one", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    const res = await PUT(putReq({ parentPhone: null }) as never, { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("answers 200 with the current row and writes nothing when no value would change", async () => {
    state.admission = freshAdmission({ parentPhone: "0811", notes: "sama" });
    const res = await PUT(putReq({ source: "REFERRAL", notes: "sama", parentPhone: "0811" }) as never, { params });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("a1");
    expect(state.updates).toHaveLength(0);
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("(accepted) cancelling a legacy lead that has no contact still works", async () => {
    state.admission = freshAdmission();
    const res = await PUT(putReq({ status: "CANCELLED" }) as never, { params });
    expect(res.status).toBe(200);
    expect(state.lastUpdate).toEqual({ status: "CANCELLED" });
  });

  it("(accepted) the full dialog payload on a legacy lead without a contact asks for one", async () => {
    state.admission = freshAdmission();
    const res = await PUT(
      putReq({
        parentName: "Ibu Fatimah",
        parentRelationship: "",
        parentPhone: "",
        parentWhatsapp: "",
        parentEmail: "",
        childName: "Aisyah",
        dateOfBirth: "",
        childGender: "",
        programId: "",
        notes: "",
      }) as never,
      { params },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toEqual([{ field: "parentPhone", message: CONTACT_MESSAGE }]);
    expect(state.updates).toHaveLength(0);
  });

  it.each(["2020-02-31", "15/03/2020", "besok"])("rejects dateOfBirth %s", async (dateOfBirth) => {
    const res = await PUT(putReq({ dateOfBirth }) as never, { params });
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("scopes the write itself to the tenant", async () => {
    state.admission = freshAdmission({ parentPhone: "0811" });
    await PUT(putReq({ notes: "baru" }) as never, { params });
    expect(state.updateWheres).toEqual([{ id: "a1", tenantId: "t1" }]);
  });
});

describe("PUT /api/admissions/[id] — role and tenant boundaries", () => {
  it("returns 403 for a read-only admissions admin", async () => {
    state.session = { ...adminSession(), permissions: ["admissions.view"] };
    const res = await PUT(putReq({ childName: "Aisyah Putri" }) as never, { params });
    expect(res.status).toBe(403);
    expect(state.lastUpdate).toBeNull();
  });

  it.each(["TEACHER", "GUARDIAN"] as const)(
    "returns 403 for %s and never reads the admission",
    async (role) => {
      state.session = { ...adminSession(), role };
      const res = await PUT(putReq({ childName: "Aisyah Putri" }) as never, { params });
      expect(res.status).toBe(403);
      expect(state.lastUpdate).toBeNull();
    },
  );

  it("returns 403 when there is no session", async () => {
    state.session = null;
    const res = await PUT(putReq({ childName: "Aisyah Putri" }) as never, { params });
    expect(res.status).toBe(403);
    expect(state.lastUpdate).toBeNull();
  });

  it("returns 404 (not 403, not 500) when the admission belongs to another tenant", async () => {
    // Same shape as the parallel guard the T11 route-behaviour todos call
    // out for /categories and /indicators — cross-tenant reads must 404,
    // not leak existence via a 403 or crash via an unguarded update.
    state.admission = freshAdmission({ tenantId: "other-tenant" });
    const res = await PUT(putReq({ childName: "Aisyah Putri" }) as never, { params });
    expect(res.status).toBe(404);
    expect(state.lastUpdate).toBeNull();
  });
});
