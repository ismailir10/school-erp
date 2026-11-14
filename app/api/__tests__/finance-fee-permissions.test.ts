import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
  isAdminRole: (role: string) => ["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(role),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }), getClientIp: () => "test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getSession } from "@/lib/auth";
import { POST as createComponent } from "../fee-components/route";
import { PUT as editComponent } from "../fee-components/[id]/route";
import { POST as createAdjustment } from "../student-fee-adjustments/route";
import { PUT as editAdjustment } from "../student-fee-adjustments/[id]/route";
import { PUT as editStructure } from "../fee-structure/route";

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ role: "SCHOOL_ADMIN", tenantId: "tenant", permissions: ["invoices.view"] } as never);
});
it.each([
  ["create component", createComponent],
  ["edit component", editComponent],
  ["create adjustment", createAdjustment],
  ["edit adjustment", editAdjustment],
  ["save tariff", editStructure],
])("denies invoice-view-only admins permission to %s", async (_name, handler) => {
  const request = new NextRequest("http://localhost/api/fees", { method: "PUT", body: "{}" });
  const response = await handler(request, { params: Promise.resolve({ id: "owned" }) });
  expect(response.status).toBe(403);
});
