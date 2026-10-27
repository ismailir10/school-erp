/**
 * Cycle 2026-10-27-class-program-visibility (T4/T5): the billing wizard names
 * the program (and rate) each class bills from, warns about a class that looks
 * mislinked or has no fee structure, and shows the program on every review row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/student-picker", () => ({ StudentPicker: () => null }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionMultiPicker: ({
    sections,
    value,
    onChange,
    showProgram,
  }: {
    sections: { id: string; name: string }[];
    value: string[];
    onChange: (ids: string[]) => void;
    showProgram?: boolean;
  }) => (
    <div data-testid="picker" data-show-program={String(Boolean(showProgram))}>
      {sections.map((s) => (
        <label key={s.id}>
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={() => onChange(value.includes(s.id) ? value.filter((v) => v !== s.id) : [...value, s.id])}
          />
          {s.name}
        </label>
      ))}
    </div>
  ),
}));

import { ScopeStep } from "../step-1-scope";
import { ReviewStep } from "../step-2-review";
import type { BillingRunRowData } from "../types";

afterEach(() => vi.unstubAllGlobals());

describe("step 1 — class setup warnings", () => {
  const years = [{ id: "ay-1", name: "2026/2027", status: "ACTIVE" }];
  const cls = (id: string, name: string, program: string, fee: number | null, ageGroup = "A") => ({
    id,
    name,
    ageGroup,
    academicYearId: "ay-1",
    program: { name: program },
    recurringFeeTotal: fee,
  });
  const classes = [
    cls("ok", "TK A 1", "TK A", 499000),
    cls("mislinked", "TK A 4", "TK B", 504000),
    cls("nofee", "KB 1", "KB", null, "A"),
  ];
  let fetcher: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetcher = vi.fn(async () => ({ ok: true, json: async () => classes }) as Response);
    vi.stubGlobal("fetch", fetcher);
  });

  it("asks the class list for fees and has the picker show each class's program", async () => {
    render(<ScopeStep years={years} onAdvance={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByRole("checkbox", { name: "TK A 1" });
    expect(fetcher.mock.calls.some(([u]) => String(u).includes("/api/class-sections?yearStatus=ACTIVE,PLANNING&include=fees"))).toBe(true);
    expect(screen.getByTestId("picker")).toHaveAttribute("data-show-program", "true");
  });

  it("stays quiet for a correctly linked class", async () => {
    const user = userEvent.setup();
    render(<ScopeStep years={years} onAdvance={vi.fn()} onCancel={vi.fn()} />);

    await user.click(await screen.findByRole("checkbox", { name: "TK A 1" }));

    expect(screen.queryByText("Periksa dulu sebelum lanjut")).not.toBeInTheDocument();
  });

  it("warns, without blocking, about a TK A class linked to the TK B program", async () => {
    const user = userEvent.setup();
    const onAdvance = vi.fn();
    fetcher.mockImplementation(async (_u: string, init?: RequestInit) =>
      (init?.method === "POST"
        ? { status: 201, json: async () => ({ id: "run-1" }) }
        : { ok: true, json: async () => classes }) as unknown as Response,
    );
    render(<ScopeStep years={years} onAdvance={onAdvance} onCancel={vi.fn()} />);

    await user.click(await screen.findByRole("checkbox", { name: "TK A 4" }));

    expect(await screen.findByText(/Nama TK A 4 tidak cocok dengan program TK B/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await waitFor(() => expect(onAdvance).toHaveBeenCalledWith("run-1"));
  });

  it("warns about a selected class whose program has no fee structure, and drops the warning when it is deselected", async () => {
    const user = userEvent.setup();
    render(<ScopeStep years={years} onAdvance={vi.fn()} onCancel={vi.fn()} />);

    await user.click(await screen.findByRole("checkbox", { name: "KB 1" }));
    expect(await screen.findByText(/KB 1 memakai program KB, yang belum punya tarif rutin/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "KB 1" }));
    expect(screen.queryByText(/belum punya tarif rutin/)).not.toBeInTheDocument();
  });

  it("does not warn about fees when the response carries no fee information", async () => {
    const user = userEvent.setup();
    fetcher.mockImplementation(async () =>
      ({ ok: true, json: async () => [{ id: "x", name: "KB 1", academicYearId: "ay-1", program: { name: "KB" } }] }) as Response,
    );
    render(<ScopeStep years={years} onAdvance={vi.fn()} onCancel={vi.fn()} />);

    await user.click(await screen.findByRole("checkbox", { name: "KB 1" }));

    expect(screen.queryByText("Periksa dulu sebelum lanjut")).not.toBeInTheDocument();
  });
});

describe("step 2 — program on each row", () => {
  function reviewRow(id: string, name: string, over: Partial<BillingRunRowData> = {}): BillingRunRowData {
    return {
      id,
      billingRunId: "run-1",
      studentId: `stu-${id}`,
      studentNameSnapshot: name,
      classLabelSnapshot: "TKA 4",
      parentId: null,
      totalDue: 504000,
      status: "PENDING",
      invoiceId: null,
      error: null,
      lines: [],
      ...over,
    };
  }

  function stubRun(rows: BillingRunRowData[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/fee-components")) return { ok: true, json: async () => [] } as Response;
        return {
          ok: true,
          json: async () => ({
            id: "run-1",
            periodLabel: "November 2026",
            dueDate: "2026-11-10",
            academicYearId: "ay-1",
            status: "DRAFT",
            scope: {},
            createdAt: new Date().toISOString(),
            committedAt: null,
            rows: { data: rows, pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 } },
          }),
        } as Response;
      }),
    );
  }

  it("shows the program next to the class label", async () => {
    stubRun([reviewRow("r1", "Abrina", { programLabel: "TK B" })]);
    render(<ReviewStep runId="run-1" onAdvance={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText("TKA 4 · TK B")).toBeInTheDocument();
  });

  it("shows just the class when no program could be derived", async () => {
    stubRun([reviewRow("r1", "Abrina", { programLabel: null }), reviewRow("r2", "Aluna")]);
    render(<ReviewStep runId="run-1" onAdvance={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText("Abrina");
    expect(screen.getAllByText("TKA 4")).toHaveLength(2);
  });
});
