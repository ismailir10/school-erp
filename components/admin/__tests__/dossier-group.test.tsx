/**
 * `DossierGroup` + `DossierSubsection` — the student dossier's five cards and
 * the concerns inside them. A group shows its one-line summary only while
 * closed; a sub-section is a flat headed block unless the page gives it an
 * `onOpenChange`, in which case it is a collapsible row (and `keepMounted`
 * keeps fetched content alive through a collapse).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DossierGroup, DossierSubsection } from "../dossier-section";

function Group(props: {
  open: boolean;
  summary?: React.ReactNode;
  keepMounted?: boolean;
  onOpenChange?: (o: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <DossierGroup
      id="group-keuangan"
      label="Keuangan"
      summary={props.summary}
      open={props.open}
      onOpenChange={props.onOpenChange ?? (() => {})}
      keepMounted={props.keepMounted}
    >
      {props.children ?? <p>Isi grup</p>}
    </DossierGroup>
  );
}

describe("DossierGroup", () => {
  it("is a card anchored on its id with an h2 label", () => {
    const { container } = render(<Group open>{null}</Group>);
    expect(container.querySelector("#group-keuangan")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Keuangan" })).toBeInTheDocument();
  });

  it("shows the summary inside the trigger only while closed", () => {
    const { rerender } = render(<Group open={false} summary="Semua tagihan lunas" />);
    const trigger = screen.getByRole("button", { name: /Keuangan/ });
    expect(trigger).toHaveTextContent("Semua tagihan lunas");
    expect(trigger).toHaveAccessibleName("Keuangan Semua tagihan lunas");

    rerender(<Group open summary="Semua tagihan lunas" />);
    expect(screen.queryByText("Semua tagihan lunas")).not.toBeInTheDocument();
    expect(screen.getByText("Isi grup")).toBeInTheDocument();
  });

  it("renders nothing extra when no summary is given", () => {
    const { container } = render(<Group open={false} />);
    expect(container.querySelector("[data-slot='dossier-summary']")).toBeNull();
  });

  it("asks the page to open and close it", async () => {
    const onOpenChange = vi.fn();
    render(<Group open={false} onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Keuangan/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("unmounts its content while closed unless keepMounted", () => {
    const { rerender } = render(<Group open={false} />);
    expect(screen.queryByText("Isi grup")).not.toBeInTheDocument();
    rerender(<Group open={false} keepMounted />);
    expect(screen.getByText("Isi grup", { selector: "p" })).toBeInTheDocument();
  });
});

describe("DossierSubsection — flat", () => {
  it("is a labelled section with an h3, a badge and actions, and no toggle", () => {
    const { container } = render(
      <DossierSubsection
        id="data-anak"
        label="Data Anak"
        badge={<span>3 field</span>}
        actions={<button type="button">Edit</button>}
      >
        <p>Isi</p>
      </DossierSubsection>,
    );
    const section = screen.getByRole("region", { name: "Data Anak" });
    expect(section).toHaveAttribute("id", "data-anak");
    expect(within(section).getByRole("heading", { level: 3, name: "Data Anak" })).toBeInTheDocument();
    expect(within(section).getByText("3 field")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(section).getByText("Isi")).toBeInTheDocument();
    // Never collapsible: the only button is the action.
    expect(within(section).getAllByRole("button")).toHaveLength(1);
    expect(container.querySelector("[aria-controls]")).toBeNull();
  });

  it("ignores `open` and always shows its body", () => {
    render(
      <DossierSubsection id="x" label="Flat" open={false}>
        <p>Selalu terlihat</p>
      </DossierSubsection>,
    );
    expect(screen.getByText("Selalu terlihat")).toBeInTheDocument();
  });

  it("clears the sticky nav when jumped to", () => {
    const { container } = render(
      <DossierSubsection id="x" label="Flat">
        <p>Isi</p>
      </DossierSubsection>,
    );
    expect(container.querySelector("#x")?.className).toContain("scroll-mt-");
  });
});

describe("DossierSubsection — collapsible", () => {
  function Collapsible(props: { open: boolean; keepMounted?: boolean; onOpenChange?: (o: boolean) => void }) {
    return (
      <DossierSubsection
        id="kehadiran"
        label="Kehadiran"
        badge={<span>12</span>}
        actions={<button type="button">Pilih bulan</button>}
        open={props.open}
        onOpenChange={props.onOpenChange ?? (() => {})}
        keepMounted={props.keepMounted}
      >
        <p>Rekap kehadiran</p>
      </DossierSubsection>
    );
  }

  it("keeps the anchor id and an h3 label inside a 44px trigger", () => {
    const { container } = render(<Collapsible open={false} />);
    expect(container.querySelector("#kehadiran")).not.toBeNull();
    const trigger = screen.getByRole("button", { name: /Kehadiran/ });
    expect(trigger.className).toContain("min-h-11");
    expect(screen.getByRole("heading", { level: 3, name: "Kehadiran" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-controls", "kehadiran-content");
  });

  it("toggles through onOpenChange and shows its body only when open", async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Collapsible open={false} onOpenChange={onOpenChange} />);
    expect(screen.queryByText("Rekap kehadiran")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Kehadiran/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    rerender(<Collapsible open onOpenChange={onOpenChange} />);
    expect(screen.getByText("Rekap kehadiran")).toBeInTheDocument();
  });

  it("keeps its body mounted while collapsed with keepMounted", () => {
    render(<Collapsible open={false} keepMounted />);
    expect(screen.getByText("Rekap kehadiran", { selector: "p" })).toBeInTheDocument();
  });

  it("renders actions outside the trigger so they are not nested interactive elements", () => {
    render(<Collapsible open={false} />);
    const trigger = screen.getByRole("button", { name: /Kehadiran/ });
    expect(within(trigger).queryByRole("button", { name: "Pilih bulan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pilih bulan" })).toBeInTheDocument();
  });

  it("shows no summary of its own", () => {
    const { container } = render(<Collapsible open={false} />);
    expect(container.querySelector("[data-slot='dossier-summary']")).toBeNull();
  });
});

describe("DossierGroup holding sub-sections", () => {
  it("stacks flat and collapsible sub-sections under the group", () => {
    render(
      <DossierGroup id="group-profil" label="Profil" open onOpenChange={() => {}}>
        <DossierSubsection id="data-anak" label="Data Anak">
          <p>Nama</p>
        </DossierSubsection>
        <DossierSubsection id="akademik" label="Akademik" open={false} onOpenChange={() => {}}>
          <p>Raport</p>
        </DossierSubsection>
      </DossierGroup>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Profil" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Data Anak" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Akademik/ })).toBeInTheDocument();
    expect(screen.queryByText("Raport")).not.toBeInTheDocument();
  });
});
