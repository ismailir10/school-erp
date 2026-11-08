import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

let path = "/admin/invoices";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("@/components/admin/guarded-link", () => ({
  GuardedLink: ({ href, children, ...r }: { href: string; children?: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/config/admin-nav", () => ({
  getBreadcrumbs: (p: string) =>
    p === "/admin/invoices"
      ? [{ label: "Tagihan" }]
      : p === "/admin/invoices/1"
        ? [{ label: "Keuangan" }, { label: "Tagihan", href: "/admin/invoices" }, { label: "Detail" }]
        : [],
}));

import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";

describe("AdminBreadcrumb", () => {
  it("renders nothing for a single crumb", () => {
    path = "/admin/invoices";
    expect(render(<AdminBreadcrumb />).container.innerHTML).toBe("");
  });
  it("renders nothing without crumbs", () => {
    path = "/admin/x";
    expect(render(<AdminBreadcrumb />).container.innerHTML).toBe("");
  });
  it("renders a trail inside the data-admin-breadcrumb wrapper", () => {
    path = "/admin/invoices/1";
    const { container } = render(<AdminBreadcrumb />);
    expect(container.querySelector("[data-admin-breadcrumb]")).not.toBeNull();
    expect(container.textContent).toContain("Detail");
  });
});
