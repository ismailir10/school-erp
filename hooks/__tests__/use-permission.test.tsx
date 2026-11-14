import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { usePermissions } from "../use-permission";
function Controls() {
  const can = usePermissions();
  return <>{can("employees.view") && <span>Employee list</span>}{can("employees.edit") && <button>Edit employee</button>}{can("payroll.create") && <button>Create payroll</button>}</>;
}
afterEach(() => vi.unstubAllGlobals());
describe("UI grants", () => {
  it("keeps writes hidden for a custom read-only session", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ role: "SCHOOL_ADMIN", permissions: ["employees.view", "payroll.view"] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Controls />);
    expect(await screen.findByText("Employee list")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails closed when the session cannot be loaded", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(<Controls />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
