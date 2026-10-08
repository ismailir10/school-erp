/**
 * `GET /api/students/[id]/enrollment-application`.
 *
 * The contracts worth pinning: the admin gate, the tenant predicate living in
 * the query rather than in a check after it, resolution by the
 * `EnrollmentApplication.studentId` FK (not the editable metadata pointer), and
 * that the parent's `accessToken` is never in the select.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Session = { id: string; role: string; tenantId: string | null; permissions?: string[] };

const state = {
  session: null as Session | null,
  application: null as Record<string, unknown> | null,
  lastQuery: null as { where?: Record<string, unknown>; select?: Record<string, unknown> } | null,
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  isAdminRole: (role: string) => role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN",
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    enrollmentApplication: {
      findFirst: vi.fn(
        async (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
          state.lastQuery = args;
          const app = state.application;
          if (!app) return null;
          if (args.where.studentId && app.studentId !== args.where.studentId) return null;
          if (args.where.tenantId && app.tenantId !== args.where.tenantId) return null;
          return app;
        },
      ),
    },
  },
}));

const { GET } = await import("@/app/api/students/[id]/enrollment-application/route");

const req = () => new Request("http://localhost/x") as never;
const ctx = (id = "s1") => ({ params: Promise.resolve({ id }) });

const APPLICATION = {
  id: "app1",
  tenantId: "t1",
  studentId: "s1",
  status: "ACCEPTED",
  childName: "Aisyah Putri",
  parentEmail: "ibu@example.com",
  dcareAddon: false,
  submittedAt: new Date("2026-05-02T03:00:00.000Z"),
  createdAt: new Date("2026-04-28T03:00:00.000Z"),
  studentData: { childName: "Aisyah Putri", foodAllergy: "telur" },
  ayahData: { name: "Umar" },
  ibuData: { name: "Fatimah" },
  consentData: { agreed: true, ayah: { name: "Umar", signatureToken: "tok" } },
  documents: {
    kk: {
      fileToken: "supabase:v1:enrollment/app1/doc-kk-SECRETKK.pdf",
      fileName: "kk.pdf",
      mimeType: "application/pdf",
      size: 1234,
      uploadedAt: "2026-05-01T03:00:00.000Z",
    },
    akta: { receivedPhysical: true, receivedAt: "2026-05-02T03:00:00.000Z" },
  },
  program: { id: "p1", name: "TKIT" },
  admission: { id: "adm1", parentName: "Umar", parentPhone: "0812", parentRelationship: "AYAH" },
};

beforeEach(() => {
  state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["admissions.view"] };
  state.application = { ...APPLICATION };
  state.lastQuery = null;
});

describe("GET /api/students/[id]/enrollment-application", () => {
  it("403s a non-admin", async () => {
    state.session = { id: "u2", role: "TEACHER", tenantId: "t1" };
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it("403s an unauthenticated caller", async () => {
    state.session = null;
    expect((await GET(req(), ctx())).status).toBe(403);
  });

  it("returns the form for a converted student", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe("app1");
    expect(body.data.studentData.foodAllergy).toBe("telur");
    expect(body.data.consentData.ayah.hasSignature).toBe(true);
  });

  it("never ships the raw signature storage token in consentData", async () => {
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(body.data.consentData.ayah).not.toHaveProperty("signatureToken");
  });

  it("resolves by the studentId FK, not by a metadata pointer", async () => {
    await GET(req(), ctx("s1"));
    expect(state.lastQuery?.where).toMatchObject({ studentId: "s1", tenantId: "t1" });
  });

  it("scopes the tenant inside the query, so another tenant's form is a 404", async () => {
    state.application = { ...APPLICATION, tenantId: "other" };
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it("404s a hand-entered student with no form", async () => {
    state.application = null;
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Not found");
  });

  it("never selects the parent's access token", async () => {
    // `accessToken` is the unguessable credential that lets a parent open the
    // form. It has no business in an admin page payload.
    await GET(req(), ctx());
    const select = state.lastQuery?.select ?? {};
    expect(select).not.toHaveProperty("accessToken");
    expect(select).not.toHaveProperty("tokenExpiresAt");
    expect(select).toHaveProperty("consentData");
  });

  it("returns the documents in the admin view, with no storage token anywhere in the JSON", async () => {
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(body.data.documents.kk).toMatchObject({ hasFile: true, fileName: "kk.pdf", receivedPhysical: false });
    expect(body.data.documents.akta).toMatchObject({ hasFile: false, receivedPhysical: true });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("fileToken");
    expect(raw).not.toContain("SECRETKK");
    expect(raw).not.toContain("supabase:v1:enrollment");
    expect(raw).not.toContain("signatureToken");
  });

  it("selects documents and returns an empty map when none were uploaded", async () => {
    state.application = { ...APPLICATION, documents: null };
    const body = await (await GET(req(), ctx())).json();
    expect(state.lastQuery?.select).toHaveProperty("documents", true);
    expect(body.data.documents).toEqual({});
  });

  it("canEditDocuments follows admissions.edit", async () => {
    expect((await (await GET(req(), ctx())).json()).data.canEditDocuments).toBe(false);
    state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["admissions.view", "admissions.edit"] };
    expect((await (await GET(req(), ctx())).json()).data.canEditDocuments).toBe(true);
    state.session = { id: "u1", role: "SUPER_ADMIN", tenantId: "t1" };
    expect((await (await GET(req(), ctx())).json()).data.canEditDocuments).toBe(true);
  });

  it("hides documents from an admin role without admissions.view (null, and canEditDocuments false)", async () => {
    state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["students.view", "admissions.edit"] };
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.documents).toBeNull();
    expect(body.data.canEditDocuments).toBe(false);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("kk.pdf");
    expect(raw).not.toContain("SECRETKK");
    // The rest of the form is unchanged.
    expect(body.data.studentData.foodAllergy).toBe("telur");
  });

  it("shows documents read-only to an admissions viewer", async () => {
    state.session = { id: "u1", role: "SCHOOL_ADMIN", tenantId: "t1", permissions: ["admissions.view"] };
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.documents.kk).toMatchObject({ hasFile: true });
    expect(body.data.canEditDocuments).toBe(false);
  });
});
