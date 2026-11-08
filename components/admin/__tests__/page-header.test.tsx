import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("renders one primary action, a secondary, and menu items behind the ⋯ trigger", async () => {
    const onPrimary = vi.fn();
    const onMenu = vi.fn();
    render(
      <PageHeader
        title="Tagihan"
        primaryAction={{ label: "Buat Tagihan", onClick: onPrimary }}
        secondaryAction={{ label: "Catat di muka" }}
        menuActions={[{ label: "Tagihan Manual", onClick: onMenu }, { label: "Hapus draf", destructive: true }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Buat Tagihan" }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Catat di muka" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Tagihan Manual" }));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it("folds the secondary action into the menu for small screens", async () => {
    render(<PageHeader title="Tagihan" secondaryAction={{ label: "Catat di muka" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    expect(await screen.findByRole("menuitem", { name: "Catat di muka" })).toBeInTheDocument();
  });

  it("skips hidden actions and shows no menu trigger when there is nothing in it", () => {
    render(<PageHeader title="Tagihan" primaryAction={{ label: "Baru", hidden: true }} menuActions={[{ label: "X", hidden: true }]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
