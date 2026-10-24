import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { findUnique, update, getSession, isAdminRole, hasPermission, transaction, recordAudit } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  getSession: vi.fn(),
  isAdminRole: vi.fn(),
  hasPermission: vi.fn(),
  transaction: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { tenant: { findUnique, update }, $transaction: transaction } }));
vi.mock("@/lib/auth", () => ({ getSession, isAdminRole }));
vi.mock("@/lib/permissions", () => ({ hasPermission }));
vi.mock("@/lib/audit", () => ({ recordAudit }));

import { GET, PUT } from "../route";
import { __resetRateLimitForTest } from "@/lib/rate-limit";
import { DEFAULT_REMINDER_TEMPLATE } from "@/lib/finance/reminder-template";

const put = (body: unknown) =>
  new NextRequest("http://localhost/api/config/invoice-reminder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitForTest();
  getSession.mockResolvedValue({ id: "u-1", tenantId: "t-1", role: "SCHOOL_ADMIN" });
  isAdminRole.mockReturnValue(true);
  hasPermission.mockReturnValue(true);
  findUnique.mockResolvedValue({ invoiceReminderTemplate: null });
  update.mockResolvedValue({});
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ tenant: { update } }));
});

describe("GET /api/config/invoice-reminder", () => {
  it("401 without a session", async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it("403 without payments.record", async () => {
    hasPermission.mockReturnValue(false);
    expect((await GET()).status).toBe(403);
    expect(hasPermission).toHaveBeenCalledWith(expect.anything(), "payments.record");
  });
  it("serves the default when the school has none", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({
      template: DEFAULT_REMINDER_TEMPLATE,
      isDefault: true,
      defaultTemplate: DEFAULT_REMINDER_TEMPLATE,
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("serves the stored text, read for the session's tenant only", async () => {
    findUnique.mockResolvedValue({ invoiceReminderTemplate: "Halo {wali} {tautan}" });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ template: "Halo {wali} {tautan}", isDefault: false });
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-1" } }));
  });
});

describe("PUT /api/config/invoice-reminder", () => {
  it("403 without payments.record, writes nothing", async () => {
    hasPermission.mockReturnValue(false);
    expect((await PUT(put({ template: "Halo {tautan}" }))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("400 on a body that is not JSON", async () => {
    expect((await PUT(put("not json"))).status).toBe(400);
  });
  it("saves valid text on the session's tenant, with an audit row", async () => {
    const res = await PUT(put({ template: "Halo {wali}, bayar di {tautan}" }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "t-1" }, data: { invoiceReminderTemplate: "Halo {wali}, bayar di {tautan}" } });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t-1", actorId: "u-1", entity: "Tenant", action: "update-reminder-template" }),
      expect.anything(),
    );
    expect(await res.json()).toMatchObject({ template: "Halo {wali}, bayar di {tautan}", isDefault: false });
  });
  it("ignores a tenantId smuggled into the body", async () => {
    await PUT(put({ template: "Halo {tautan}", tenantId: "t-2" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-1" } }));
  });
  it("blank text resets to the default (stores null)", async () => {
    findUnique.mockResolvedValue({ invoiceReminderTemplate: "Halo {tautan}" });
    const res = await PUT(put({ template: "  \n" }));
    expect(update).toHaveBeenCalledWith({ where: { id: "t-1" }, data: { invoiceReminderTemplate: null } });
    expect(await res.json()).toMatchObject({ template: DEFAULT_REMINDER_TEMPLATE, isDefault: true });
  });
  it("saving the built-in text unchanged also stores null, so the school keeps following the default", async () => {
    await PUT(put({ template: DEFAULT_REMINDER_TEMPLATE }));
    expect(update).toHaveBeenCalledWith({ where: { id: "t-1" }, data: { invoiceReminderTemplate: null } });
  });
  it.each([
    ["an unknown placeholder", "Halo {sisaa} {tautan}", /\{sisaa\}/],
    ["a missing {tautan}", "Halo {wali}", /\{tautan\}/],
    ["text over the cap", `{tautan}${"a".repeat(1001)}`, /terlalu panjang/],
  ])("400 with the reason for %s, stores nothing", async (_n, template, reason) => {
    const res = await PUT(put({ template }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(reason);
    expect(update).not.toHaveBeenCalled();
  });
  it("400 when template is not text", async () => {
    expect((await PUT(put({ template: 5 }))).status).toBe(400);
  });
  it("429 when rate limited", async () => {
    for (let i = 0; i < 10; i++) await PUT(put({ template: "Halo {tautan}" }));
    expect((await PUT(put({ template: "Halo {tautan}" }))).status).toBe(429);
  });
});
