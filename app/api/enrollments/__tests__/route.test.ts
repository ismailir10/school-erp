import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { findMany, count, getSession, isAdminRole } = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { enrollmentApplication: { findMany, count } } }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));

import { GET } from "../route";

const req = () => new NextRequest("http://localhost/api/enrollments?page=1&pageSize=20");

beforeEach(() => {
  vi.clearAllMocks();
  isAdminRole.mockReturnValue(true);
  findMany.mockResolvedValue([{ id: "ea-1" }]);
  count.mockResolvedValue(1);
});

describe("GET /api/enrollments", () => {
  it("denies custom finance admins without querying records", async () => {
    getSession.mockResolvedValue({ tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["invoices.view"] });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("allows admissions.view and preserves tenant filtering", async () => {
    getSession.mockResolvedValue({ tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: "ea-1", fee: null, followUp: null }]);
    expect(findMany.mock.calls[0][0].where.tenantId).toBe("t-1");
    expect(count.mock.calls[0][0].where.tenantId).toBe("t-1");
  });

  it("keeps the base admin-role boundary even if a teacher has a permission grant", async () => {
    getSession.mockResolvedValue({ tenantId: "t-1", role: "TEACHER", permissions: ["admissions.view"] });
    isAdminRole.mockReturnValue(false);
    expect((await GET(req())).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/enrollments — pendaftaran fee", () => {
  const editor = { id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view", "admissions.edit"] };
  const viewer = { id: "u-2", tenantId: "t-1", role: "SCHOOL_ADMIN", permissions: ["admissions.view"] };
  const reqWith = (qs: string) => new NextRequest(`https://talib.example/api/enrollments?${qs}`);

  const unpaidRow = (over: Record<string, unknown> = {}) => ({
    id: "ea-1",
    childName: "Aisyah",
    status: "SUBMITTED",
    fee: { status: "UNPAID", amount: "300000" },
    ayahData: { phone: "0815555666" },
    ibuData: {},
    admission: { parentName: "Siti", parentPhone: null, parentWhatsapp: "0812-3456-7890" },
    ...over,
  });

  it.each([
    ["paid", { is: { status: "PAID" } }],
    ["waived", { is: { status: "WAIVED" } }],
    ["none", { is: null }],
  ])("?payment=%s filters on the fee, within the tenant", async (value, fee) => {
    getSession.mockResolvedValue(editor);
    await GET(reqWith(`payment=${value}`));
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", fee });
    expect(count.mock.calls[0][0].where).toEqual({ tenantId: "t-1", fee });
  });

  it("?payment=unpaid is the chase list: unpaid fees of applications that are not REJECTED, in the tenant", async () => {
    getSession.mockResolvedValue(editor);
    await GET(reqWith("payment=unpaid"));
    const expected = { tenantId: "t-1", fee: { is: { status: "UNPAID" } }, status: { not: "REJECTED" } };
    expect(findMany.mock.calls[0][0].where).toEqual(expected);
    // The stat card counts with the same where.
    expect(count.mock.calls[0][0].where).toEqual(expected);
  });

  it("?payment=unpaid&status=REJECTED honours the explicit status filter", async () => {
    getSession.mockResolvedValue(editor);
    await GET(reqWith("payment=unpaid&status=REJECTED"));
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1", fee: { is: { status: "UNPAID" } }, status: "REJECTED" });
  });

  it("a REJECTED application with an unpaid fee has no follow-up: its pay link is closed", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ status: "REJECTED" })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.fee).toEqual({ status: "UNPAID", amount: 300_000 });
    expect(row.followUp).toBeNull();
  });

  it("pay-first: a formulir still INVITED with an unpaid fee can be chased by WhatsApp", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ status: "INVITED", childName: "" })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.fee).toEqual({ status: "UNPAID", amount: 300_000 });
    expect(row.followUp).toEqual({ canRemind: true });
  });

  it("pay-first: an INVITED formulir with no number WhatsApp can open has canRemind false, not null", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([
      unpaidRow({ status: "INVITED", ayahData: {}, admission: { status: "INQUIRY", parentPhone: null, parentWhatsapp: null } }),
    ]);
    expect((await (await GET(reqWith("page=1"))).json()).data[0].followUp).toEqual({ canRemind: false });
  });

  it("a CANCELLED lead with an unpaid fee has no follow-up: its pay link is closed", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([
      unpaidRow({ status: "INVITED", admission: { status: "CANCELLED", parentName: "Siti", parentPhone: null, parentWhatsapp: "0812-3456-7890" } }),
    ]);
    expect((await (await GET(reqWith("page=1"))).json()).data[0].followUp).toBeNull();
  });

  it("ignores an unknown payment value (no filter, no injection)", async () => {
    getSession.mockResolvedValue(editor);
    await GET(reqWith("payment=%7B%22is%22%3Anull%7D"));
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: "t-1" });
  });

  it("an unpaid row carries the fee and whether a reminder can be sent; no link, no token, no phone", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow()]);
    const body = await (await GET(reqWith("page=1"))).json();
    const row = body.data[0];

    expect(row.fee).toEqual({ status: "UNPAID", amount: 300_000 });
    expect(row.followUp).toEqual({ canRemind: true });
    // The WhatsApp link carries the form token, so the list never builds it.
    expect(JSON.stringify(body)).not.toMatch(/wa\.me|waUrl|SECRET-TOKEN|accessToken|ayahData|ibuData|0815555666|0812|"admission"/);
  });

  it("never reads the access token for the list, not even for editors", async () => {
    getSession.mockResolvedValue(editor);
    await GET(reqWith("page=1"));
    const select = findMany.mock.calls[0][0].select;
    expect(select.accessToken).toBeUndefined();
    expect(select.admission).toEqual({ select: { status: true, parentPhone: true, parentWhatsapp: true } });
  });

  it("canRemind is false for a row with no number WhatsApp can open, so the UI disables the button", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ ayahData: {}, admission: { parentName: "Siti", parentPhone: "123", parentWhatsapp: null } })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.followUp).toEqual({ canRemind: false });
  });

  it("canRemind falls back to the parents' phone from the form", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ admission: { parentName: "Siti", parentPhone: null, parentWhatsapp: null } })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.followUp).toEqual({ canRemind: true });
  });

  it.each([
    ["PAID", { status: "PAID", amount: "300000" }],
    ["WAIVED", { status: "WAIVED", amount: "0" }],
  ])("a %s fee has nothing to chase: no follow-up", async (_n, fee) => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ fee })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.followUp).toBeNull();
  });

  it("a read-only viewer sees the fee status but is never given a link, and the token is not even read", async () => {
    getSession.mockResolvedValue(viewer);
    findMany.mockResolvedValue([unpaidRow()]);
    const body = await (await GET(reqWith("page=1"))).json();

    expect(body.data[0].fee).toEqual({ status: "UNPAID", amount: 300_000 });
    expect(body.data[0].followUp).toBeNull();
    const select = findMany.mock.calls[0][0].select;
    expect(select.accessToken).toBeUndefined();
    expect(select.admission).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("SECRET-TOKEN");
  });

  it("reads the fee status for everyone with admissions.view", async () => {
    getSession.mockResolvedValue(viewer);
    await GET(reqWith("page=1"));
    expect(findMany.mock.calls[0][0].select.fee).toEqual({ select: { status: true, amount: true } });
  });

  it("an application with no fee (free program) has fee: null", async () => {
    getSession.mockResolvedValue(editor);
    findMany.mockResolvedValue([unpaidRow({ fee: null })]);
    const row = (await (await GET(reqWith("page=1"))).json()).data[0];
    expect(row.fee).toBeNull();
    expect(row.followUp).toBeNull();
  });
});
