import { beforeEach, describe, expect, it, vi } from "vitest";
const { findUnique, updateMany } = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { payrollRun: { findUnique, updateMany } } }));
vi.mock("@/lib/auth-guards", () => ({ requirePermission: vi.fn(async () => ({ session: { tenantId: "t1" } })) }));
import { GET } from "../route";
const payroll = (status: string) => ({ id: "p1", tenantId: "t1", status, periodStart: "2026-10-01", periodEnd: "2026-10-31", items: [{ employee: { nama: "Guru", bankAccountNo: "123" }, netAmount: 1000 }] });
const request = () => GET(new Request("http://localhost/api/payroll/p1/export/bsi") as never, { params: Promise.resolve({ id: "p1" }) });
beforeEach(() => { vi.clearAllMocks(); updateMany.mockResolvedValue({ count: 1 }); });
describe("BSI repeat downloads", () => {
  it.each(["EXPORTED", "SLIPS_SENT"])("downloads %s without regressing delivery status", async status => {
    findUnique.mockResolvedValue(payroll(status));
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(".csv");
    expect(await response.text()).toContain("Guru");
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("allows two concurrent first downloads", async () => {
    findUnique.mockResolvedValueOnce(payroll("APPROVED")).mockResolvedValueOnce({ status: "EXPORTED" });
    updateMany.mockResolvedValue({ count: 0 });
    expect((await request()).status).toBe(200);
  });
  it("refuses a concurrent cancellation", async () => {
    findUnique.mockResolvedValueOnce(payroll("APPROVED")).mockResolvedValueOnce({ status: "CANCELLED" });
    updateMany.mockResolvedValue({ count: 0 });
    expect((await request()).status).toBe(409);
  });
  it("refuses draft exports", async () => { findUnique.mockResolvedValue(payroll("DRAFT")); expect((await request()).status).toBe(409); });
});
