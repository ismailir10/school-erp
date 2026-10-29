import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookOpen } from "lucide-react";
import { TaskList, TaskRow } from "../task-list";
import { SaveStatus } from "../save-status";
import { ContextStrip } from "../context-strip";

describe("portal task primitives", () => {
  it("renders navigation, action, and read-only rows with their intended semantics", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TaskList>
        <TaskRow title="Jurnal harian" description="12 dari 20 catatan terisi" icon={<BookOpen />} meta="Lanjutkan" href="/teacher/journal" />
        <TaskRow title="Absensi kelas" onClick={onClick} />
        <TaskRow title="Check-in" description="07.13 · tercatat" />
      </TaskList>,
    );

    expect(screen.getByRole("link", { name: /Jurnal harian/ })).toHaveAttribute("href", "/teacher/journal");
    await user.tab();
    expect(screen.getByRole("link", { name: /Jurnal harian/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /Absensi kelas/ })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /Absensi kelas/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("Check-in")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check-in/ })).not.toBeInTheDocument();
  });

  it("lets a status line wrap to 3 lines instead of truncating it to one", () => {
    render(
      <TaskList>
        <TaskRow title="Tagihan Ahmad" description="4 tagihan belum dibayar · 2 lewat tempo" meta="Rp 3.000.000" onClick={() => {}} />
      </TaskList>,
    );
    const status = screen.getByText(/lewat tempo/);
    expect(status.className).toContain("line-clamp-3");
    expect(status.className).not.toContain("truncate");
    expect(status.className).not.toContain("line-clamp-1");
  });

  it("stacks the meta under the text on a narrow row only when asked", () => {
    const { rerender } = render(<TaskRow title="Tagihan" meta="Rp 1" onClick={() => {}} stackMeta />);
    const meta = () => screen.getByText("Rp 1") as HTMLElement;
    expect(meta().className).toContain("@max-[15rem]:w-full");
    expect(meta().parentElement?.className).toContain("@max-[15rem]:flex-col");
    expect(meta().parentElement?.parentElement?.className).toContain("@container");
    rerender(<TaskRow title="Absensi" meta="Buka" onClick={() => {}} />);
    expect(screen.getByText("Buka").className).not.toContain("@max-");
  });

  it("exposes save feedback and a read-only child context", () => {
    const { rerender } = render(<SaveStatus state="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Menyimpan…");
    rerender(<SaveStatus state="error" message="Periksa koneksi lalu coba lagi" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Periksa koneksi lalu coba lagi");

    render(<ContextStrip name="Alya Putri" detail="TK B Anggur" avatar={<span>AP</span>} />);
    expect(screen.getByText("Alya Putri")).toBeInTheDocument();
    expect(screen.getByText("TK B Anggur")).toBeInTheDocument();
  });
});
