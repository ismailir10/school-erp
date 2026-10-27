import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ProgramChangeImpact } from "../program-change-impact";

const side = (programId: string, programName: string, amounts: number[]) => ({
  programId,
  programName,
  fees: {
    total: amounts.reduce((a, b) => a + b, 0),
    lines: amounts.map((amount, i) => ({ label: `Biaya ${i + 1}`, amount })),
  },
});

const impact = (over: Record<string, unknown> = {}) => ({
  academicYear: { id: "ay1", name: "2026/2027" },
  activeStudents: 13,
  invoicedStudents: 0,
  blockedReason: null,
  current: side("p-b", "TK B", [504000]),
  next: side("p-a", "TK A", [499000]),
  ...over,
});

function stubImpact(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, " ").trim();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProgramChangeImpact", () => {
  it("renders nothing and asks nothing while the program is unchanged", () => {
    const fetchMock = stubImpact(impact());

    const { container } = render(
      <ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-b" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("previews the per-period fee change and the affected students for the chosen program", async () => {
    const fetchMock = stubImpact(impact());

    render(<ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-a" />);

    expect(screen.getByRole("status")).toHaveTextContent("Memeriksa dampak ke tagihan");
    const note = await screen.findByText(/Tagihan rutin per periode berubah/);
    expect(text(note)).toBe(
      "Tagihan rutin per periode berubah dari Rp 504.000 ke Rp 499.000 untuk 13 siswa aktif. Draf tagihan yang sudah dibuat perlu dibuat ulang.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/classes/c1/program-impact?programId=p-a",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("says the rate stays when both programs bill the same", async () => {
    stubImpact(impact({ next: side("p-a", "TK A", [504000]) }));

    render(<ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-a" />);

    const note = await screen.findByText(/tetap/);
    expect(text(note)).toContain("Tagihan rutin per periode tetap Rp 504.000 untuk 13 siswa aktif.");
  });

  it("warns when the target program has no recurring fee for the year", async () => {
    stubImpact(impact({ next: side("p-a", "TK A", []) }));

    render(<ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-a" />);

    const note = await screen.findByText(/belum punya tarif rutin/);
    expect(text(note)).toBe(
      "TK A belum punya tarif rutin untuk tahun ajaran 2026/2027. 13 siswa aktif di kelas ini tidak akan ditagih sampai tarifnya diisi di Biaya → Tarif per Program.",
    );
  });

  it("shows why the move is refused and reports it as blocked, then clears when the choice is undone", async () => {
    const reason = "Program tidak bisa diubah karena 2 siswa di kelas ini sudah punya tagihan tahun ajaran ini.";
    stubImpact(impact({ invoicedStudents: 2, blockedReason: reason }));
    const onBlockedChange = vi.fn();

    const { rerender } = render(
      <ProgramChangeImpact
        classId="c1"
        currentProgramId="p-b"
        nextProgramId="p-a"
        onBlockedChange={onBlockedChange}
      />,
    );

    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(onBlockedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ProgramChangeImpact
        classId="c1"
        currentProgramId="p-b"
        nextProgramId="p-b"
        onBlockedChange={onBlockedChange}
      />,
    );
    await waitFor(() => expect(onBlockedChange).toHaveBeenLastCalledWith(false));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });

  it("falls back to a plain note, never blocks, and logs the failure when the preview is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubImpact({ error: "forbidden" }, { ok: false, status: 403 });
    const onBlockedChange = vi.fn();

    render(
      <ProgramChangeImpact
        classId="c1"
        currentProgramId="p-b"
        nextProgramId="p-a"
        onBlockedChange={onBlockedChange}
      />,
    );

    const note = await screen.findByText(/Dampak ke tagihan tidak bisa ditampilkan/);
    expect(note).toBeInTheDocument();
    expect(note.textContent).not.toMatch(/forbidden|403/);
    expect(onBlockedChange).not.toHaveBeenCalledWith(true);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("shows only the latest choice when the admin switches program quickly", async () => {
    let resolveFirst: (v: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => impact({ next: side("p-c", "TK C", [450000]) }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-a" />,
    );
    rerender(<ProgramChangeImpact classId="c1" currentProgramId="p-b" nextProgramId="p-c" />);

    expect(await screen.findByText(/Rp 450\.000/)).toBeInTheDocument();
    resolveFirst({ ok: true, status: 200, json: async () => impact() } as Response);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Rp 499\.000/)).not.toBeInTheDocument();
  });
});
