import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ProgramClassesUsage } from "../program-classes-usage";

const cls = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  ageGroup: "A",
  campus: { name: "Taman Aster" },
  enrolledCount: 9,
  ...over,
});

function stub(body: unknown, init: { ok?: boolean } = {}) {
  const f = vi.fn().mockResolvedValue({ ok: init.ok ?? true, json: async () => body } as Response);
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProgramClassesUsage", () => {
  it("asks for this program's active classes in the chosen year", async () => {
    const f = stub({ data: [] });

    render(<ProgramClassesUsage programId="p-a" programName="TK A" yearId="y1" />);

    await waitFor(() => expect(f).toHaveBeenCalled());
    const url = new URL(String(f.mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/api/admin/classes");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      programId: "p-a",
      yearId: "y1",
      status: "ACTIVE",
      pageSize: "100",
    });
  });

  it("lists the classes with campus and student count, linked to the class page", async () => {
    stub({ data: [cls("c1", "TK A 1"), cls("c3", "TK A 3", { enrolledCount: 13 })] });

    render(<ProgramClassesUsage programId="p-a" programName="TK A" yearId="y1" />);

    const link = await screen.findByRole("link", { name: "TK A 1" });
    expect(link).toHaveAttribute("href", "/admin/classes/c1");
    expect(screen.getByText("13 siswa")).toBeInTheDocument();
    expect(screen.getAllByText("Taman Aster")).toHaveLength(2);
    expect(screen.queryByText("Periksa kelas ini")).not.toBeInTheDocument();
  });

  it("says so when no class uses the program", async () => {
    stub({ data: [] });

    render(<ProgramClassesUsage programId="p-a" programName="TK A" yearId="y1" />);

    expect(await screen.findByText(/Belum ada kelas yang memakai program ini/)).toBeInTheDocument();
  });

  it("warns about a class whose name points at another program, listing it anyway", async () => {
    stub({ data: [cls("c4", "TK A 4")] });

    render(<ProgramClassesUsage programId="p-b" programName="TK B" yearId="y1" />);

    expect(await screen.findByText("Periksa kelas ini")).toBeInTheDocument();
    expect(screen.getByText(/Nama TK A 4 tidak cocok dengan program TK B/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TK A 4" })).toBeInTheDocument();
  });

  it("falls back to a quiet note and logs when the classes cannot be loaded", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ error: "forbidden" }, { ok: false });

    render(<ProgramClassesUsage programId="p-a" programName="TK A" yearId="y1" />);

    expect(await screen.findByText(/Daftar kelas tidak bisa dimuat/)).toBeInTheDocument();
    expect(screen.queryByText(/forbidden/)).not.toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("refetches when the admin switches program, ignoring the superseded answer", async () => {
    let resolveFirst: (v: Response) => void = () => {};
    const f = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [cls("c9", "TK B 9", { ageGroup: "B" })] }) } as Response);
    vi.stubGlobal("fetch", f);

    const { rerender } = render(<ProgramClassesUsage programId="p-a" programName="TK A" yearId="y1" />);
    rerender(<ProgramClassesUsage programId="p-b" programName="TK B" yearId="y1" />);

    expect(await screen.findByRole("link", { name: "TK B 9" })).toBeInTheDocument();
    resolveFirst({ ok: true, json: async () => ({ data: [cls("c1", "TK A 1")] }) } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "TK A 1" })).not.toBeInTheDocument();
  });
});
