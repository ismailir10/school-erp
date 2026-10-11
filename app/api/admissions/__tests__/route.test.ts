import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T5 (cycle 2026-09-27-admin-finish-standard) — POST /api/admissions moved
 * from `createAdmissionSchema.safeParse` (hand-rolled `{ error, errors }`
 * shape) to `validateBody` (lib/api/validate.ts). Same schema, same
 * persisted fields, same status codes — only the validation plumbing
 * changed, so the create dialog's server errors map onto fields the same
 * way `validateBody`-backed routes already do (lesson 5).
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

const state = {
  session: null as Session | null,
  lastCreate: null as Record<string, unknown> | null,
};

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => state.session) };
});

const detect = vi.hoisted(() => ({ detectSibling: vi.fn() }));
const admissionUpdate = vi.hoisted(() => vi.fn());
const audit = vi.hoisted(() => ({ recordAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/admission/sibling-detect", () => detect);
vi.mock("@/lib/audit", () => audit);

vi.mock("@/lib/db", () => {
  const admission = {
    update: admissionUpdate,
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.lastCreate = data;
      return { id: "new-admission-id", status: "INQUIRY", ...data };
    }),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
  };
  return {
    prisma: {
      admission,
      program: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "prog-1" ? { id: "prog-1" } : null)) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ admission })),
    },
  };
});

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ success: true })),
  getClientIp: vi.fn(() => "1.1.1.1"),
}));

import { POST } from "../route";

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

function postReq(body: unknown): Request {
  return new Request("http://x/api/admissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = adminSession();
  state.lastCreate = null;
  detect.detectSibling.mockReset();
  detect.detectSibling.mockResolvedValue(null);
  admissionUpdate.mockReset();
  audit.recordAudit.mockClear();
});

describe("POST /api/admissions — validation", () => {
  it("returns 400 with the standard { error, errors[] } shape on a missing parent name", async () => {
    const res = await POST(postReq({ parentName: "", parentPhone: "0812" }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: Array<{ field: string; message: string }> };
    expect(body.error).toBe("Validasi gagal");
    expect(body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "parentName", message: "Nama orang tua wajib diisi" })]),
    );
    expect(state.lastCreate).toBeNull();
  });

  it("requires at least one contact and says so on the phone field", async () => {
    const res = await POST(postReq({ parentName: "Ibu Fatimah", childName: "Aisyah" }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ field: string; message: string }> };
    expect(body.errors).toEqual([
      { field: "parentPhone", message: "Isi minimal satu kontak: No. HP, WhatsApp atau Email" },
    ]);
    expect(state.lastCreate).toBeNull();
    expect(audit.recordAudit).not.toHaveBeenCalled();
  });

  it("creates a lead from only a parent name and a phone, storing '' for the missing child name", async () => {
    const res = await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "081234567890" }) as never);
    expect(res.status).toBe(201);
    expect(state.lastCreate).toMatchObject({
      tenantId: "t1",
      parentName: "Ibu Fatimah",
      parentPhone: "081234567890",
      childName: "",
      parentEmail: null,
      parentWhatsapp: null,
      childGender: null,
      dateOfBirth: null,
      programId: null,
      notes: null,
    });
  });

  it("persists the optional child and contact fields it is given", async () => {
    const res = await POST(
      postReq({
        parentName: "Ibu Fatimah",
        parentRelationship: "IBU",
        parentEmail: "fatimah@example.com",
        childName: " Aisyah ",
        childGender: "P",
        dateOfBirth: "2022-03-04",
        programId: "prog-1",
        notes: "Tanya biaya",
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(state.lastCreate).toMatchObject({
      childName: "Aisyah",
      childGender: "P",
      dateOfBirth: "2022-03-04",
      parentRelationship: "IBU",
      parentEmail: "fatimah@example.com",
      programId: "prog-1",
      notes: "Tanya biaya",
    });
  });

  it("forces source to WALK_IN and ignores removed fields in the body", async () => {
    const res = await POST(
      postReq({
        parentName: "Ibu Fatimah",
        parentPhone: "0812",
        source: "REFERRAL",
        parentEducation: "S1",
        parentOccupation: "Guru",
        parentIncome: "5-10 juta",
        campusPreference: "campus-1",
        followUpDate: "2026-11-01",
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(state.lastCreate?.source).toBe("WALK_IN");
    for (const key of ["parentEducation", "parentOccupation", "parentIncome", "campusPreference", "followUpDate"]) {
      expect(state.lastCreate).not.toHaveProperty(key);
    }
  });

  it("writes an Admission create audit row with no personal data", async () => {
    await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "081234567890" }) as never);
    expect(audit.recordAudit).toHaveBeenCalledTimes(1);
    const [entry] = audit.recordAudit.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      tenantId: "t1",
      actorId: "u1",
      entity: "Admission",
      entityId: "new-admission-id",
      action: "create",
    });
    expect(JSON.stringify(entry)).not.toContain("Fatimah");
    expect(JSON.stringify(entry)).not.toContain("081234567890");
  });

  it("answers 400 (not a 500) when the body is not JSON", async () => {
    const res = await POST(
      new Request("http://x/api/admissions", { method: "POST", body: "bukan json" }) as never,
    );
    expect(res.status).toBe(400);
    expect(state.lastCreate).toBeNull();
  });

  it("rejects an impossible birth date", async () => {
    const res = await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "0812", dateOfBirth: "2020-02-31" }) as never);
    expect(res.status).toBe(400);
    expect(state.lastCreate).toBeNull();
  });

  it("rejects a program that belongs to another school", async () => {
    const res = await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "0812", programId: "prog-other" }) as never);
    expect(res.status).toBe(400);
    expect(state.lastCreate).toBeNull();
  });
});

describe("POST /api/admissions — auth boundaries unchanged", () => {
  it("returns 403 when the session lacks admissions.edit", async () => {
    state.session = { ...adminSession(), permissions: ["admissions.view"] };
    const res = await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "0812" }) as never);
    expect(res.status).toBe(403);
    expect(state.lastCreate).toBeNull();
  });

  it("returns 403 when there is no session", async () => {
    state.session = null;
    const res = await POST(postReq({ parentName: "Ibu Fatimah", parentPhone: "0812" }) as never);
    expect(res.status).toBe(403);
    expect(state.lastCreate).toBeNull();
  });
});

describe("POST /api/admissions — sibling detection (R2-ADMIN-1)", () => {
  it("runs detectSibling with email, phone and WhatsApp and stamps detectedParentId on a match", async () => {
    detect.detectSibling.mockResolvedValue({ parentId: "par-existing", matchReason: "phone" });
    const res = await POST(
      postReq({
        parentName: "Dewi",
        parentWhatsapp: "08215678901",
      }) as never,
    );
    expect(res.status).toBe(201);
    expect(detect.detectSibling).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        parentEmail: null,
        parentPhone: null,
        parentWhatsapp: "08215678901",
      }),
      expect.anything(),
    );
    expect(admissionUpdate).toHaveBeenCalledWith({
      where: { id: "new-admission-id" },
      data: { detectedParentId: "par-existing" },
    });
    expect((await res.json()).detectedParentId).toBe("par-existing");
  });

  it("writes nothing extra when no parent matches", async () => {
    const res = await POST(postReq({ parentName: "Dewi", parentPhone: "0812" }) as never);
    expect(res.status).toBe(201);
    expect(admissionUpdate).not.toHaveBeenCalled();
  });

  it("still returns 201 when detection throws", async () => {
    detect.detectSibling.mockRejectedValue(new Error("db down"));
    const res = await POST(postReq({ parentName: "Dewi", parentPhone: "0812" }) as never);
    expect(res.status).toBe(201);
    expect(admissionUpdate).not.toHaveBeenCalled();
  });
});
