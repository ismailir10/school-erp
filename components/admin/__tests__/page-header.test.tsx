import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageHeader } from "@/components/admin/page-header";
import { PageHeader as PortalPageHeader } from "@/components/portal/page-header";

describe("PageHeader", () => {
  it("renders title, description, badge and actions", () => {
    render(
      <PageHeader title="Siswa" description="104 siswa" badge={<span>Baru</span>} actions={<button>Tambah</button>} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Siswa" })).toBeInTheDocument();
    expect(screen.getByText("104 siswa")).toBeInTheDocument();
    expect(screen.getByText("Baru")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tambah" })).toBeInTheDocument();
  });

  it("the portal header is the same layout under its own `subtitle` prop", () => {
    const admin = render(<PageHeader title="Kehadiran" description="Pantau" className="mb-0" />);
    const adminHtml = admin.container.innerHTML;
    admin.unmount();
    const portal = render(<PortalPageHeader title="Kehadiran" subtitle="Pantau" className="mb-0" />);
    expect(portal.container.innerHTML).toBe(adminHtml);
  });
});
