import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Star } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";

describe("StatusBadge", () => {
  it("renders the canonical label in the default (solid) variant", () => {
    render(<StatusBadge status="PRESENT" />);
    expect(screen.getByText("Hadir")).toBeInTheDocument();
  });

  it("renders an auto-selected icon in the intent variant", () => {
    const { container } = render(<StatusBadge status="PRESENT" variant="intent" />);
    // Intent variant uses a <span> wrapper; the icon is an <svg> child.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(screen.getByText("Hadir")).toBeInTheDocument();
  });

  it("honors an icon override in the intent variant", () => {
    const { container } = render(
      <StatusBadge status="PRESENT" variant="intent" icon={Star} />,
    );
    // Star's lucide class name is "lucide-star".
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class") ?? "").toMatch(/lucide-star/i);
  });

  it("renders SICK with the amber (status-late) tone, not red (status-absent)", () => {
    render(<StatusBadge status="SICK" />);
    const badge = screen.getByText("Sakit");
    expect(badge.className).toContain("status-late-subtle");
    expect(badge.className).not.toContain("status-absent-subtle");
  });

  it("defaults ABSENT label to 'Alpa' per voice.md glossary", () => {
    render(<StatusBadge status="ABSENT" />);
    expect(screen.getByText("Alpa")).toBeInTheDocument();
  });

  it("preserves assessment copy through a PUBLISHED label override", () => {
    const { rerender } = render(
      <StatusBadge status="PUBLISHED" label="Dipublikasi" />,
    );
    expect(screen.getByText("Dipublikasi")).toBeInTheDocument();

    rerender(<StatusBadge status="PUBLISHED" />);
    expect(screen.getByText("Terbit")).toBeInTheDocument();
  });

  it.each([
    ["REGISTERED", "Terdaftar", "bg-status-present-subtle"],
    ["UNDER_REVIEW", "Ditinjau", "bg-status-late-subtle"],
    ["SUBMITTED", "Terkirim", "bg-status-leave-subtle"],
    ["DELETE", "Dihapus", "bg-status-absent-subtle"],
    ["UPDATE", "Diubah", "bg-status-leave-subtle"],
  ])(
    "maps the new %s status to its canonical label and visual family",
    (status, label, classFamily) => {
      render(<StatusBadge status={status} />);
      const badge = screen.getByText(label);
      expect(badge).toHaveClass(classFamily);
    },
  );
});

describe("STATUS_MAP enum coverage", () => {
  // A missing entry is not a type error — StatusBadge falls back to rendering
  // the raw status string, so an unmapped enum silently ships an English code
  // to a user. The audit found PARTIALLY_PAID/RECORDED/REVERSED/FAILED
  // reachable but unmapped exactly this way.
  it.each([
    // Invoice
    ["DRAFT", "Draft"],
    ["SENT", "Link Dibuat"],
    ["PAID", "Lunas"],
    ["OVERDUE", "Lewat Tempo"],
    ["PARTIALLY_PAID", "Dibayar Sebagian"],
    ["PENDING_PAYMENT_LINK", "Link Gagal"],
    // Payment ledger
    ["RECORDED", "Tercatat"],
    // Email log
    ["FAILED", "Gagal"],
    // Attendance
    ["PRESENT", "Hadir"],
    ["ABSENT", "Alpa"],
    ["SICK", "Sakit"],
    ["PERMISSION", "Izin"],
  ])("maps %s to an Indonesian label, never the raw code", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(status)).toBeNull();
  });

  it("never labels OVERDUE with the due-date phrase", () => {
    // "Jatuh tempo" is the due DATE, and that exact phrase captions the date
    // field on the same invoice row — reusing it as the status made the badge
    // and the date indistinguishable.
    render(<StatusBadge status="OVERDUE" />);
    expect(screen.queryByText(/Jatuh Tempo/i)).toBeNull();
  });

  // Class health ("Kondisi", admin/classes list + detail) — ported from the
  // standalone `healthTone()` helper onto STATUS_MAP (T2, 2026-09-27
  // admin-finish-standard cycle). Keys are the raw Indonesian health values
  // the classes module already carries (not an English enum).
  it.each([
    ["Sehat", "bg-status-present-subtle"],
    ["Perhatian", "bg-status-late-subtle"],
    ["Kritis", "bg-status-absent-subtle"],
    ["Libur", "bg-status-leave-subtle"],
  ])("maps class health %s to its canonical tone", (status, classFamily) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(status);
    expect(badge).toHaveClass(classFamily);
  });

  it("falls back to a muted pill with the raw text for 'Tidak Aktif' (no explicit entry needed)", () => {
    render(<StatusBadge status="Tidak Aktif" />);
    const badge = screen.getByText("Tidak Aktif");
    expect(badge).toHaveClass("bg-muted");
  });

  it("renders ARCHIVED as 'Diarsipkan' on a muted tone, never the raw enum (ADM-13)", () => {
    render(<StatusBadge status="ARCHIVED" />);
    const badge = screen.getByText("Diarsipkan");
    expect(badge.className).toContain("bg-muted");
    expect(screen.queryByText("ARCHIVED")).not.toBeInTheDocument();
  });

  it("gives ARCHIVED the neutral icon and left border in the intent variant", () => {
    const { container } = render(<StatusBadge status="ARCHIVED" variant="intent" />);
    expect(container.querySelector("svg")?.getAttribute("class") ?? "").toMatch(/lucide-minus/i);
    expect(container.firstElementChild?.className).toContain("border-l-border");
  });
});
