import { expect, it, vi } from "vitest";
const { assertPermission } = vi.hoisted(() => ({ assertPermission: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ assertPermission }));
vi.mock("../client", () => ({ default: () => null }));
import Page from "../page";
it("gates the academic page and passes the explicit write grant", async () => {
  assertPermission.mockResolvedValue({ role: "SCHOOL_ADMIN", permissions: ["academic.view"], customRoleCode: "reader" });
  const result = await Page();
  expect(assertPermission).toHaveBeenCalledWith("academic.view");
  expect(result.props.canWrite).toBe(false);
  assertPermission.mockResolvedValue({ role: "SCHOOL_ADMIN", permissions: ["academic.view", "academic.edit"], customRoleCode: "editor" });
  expect((await Page()).props.canWrite).toBe(true);
});
