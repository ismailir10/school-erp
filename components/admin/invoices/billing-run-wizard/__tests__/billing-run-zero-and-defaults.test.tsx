/**
 * FINX-4 (Rp 0 rows shown + counted, never invoiced), the pinned footer, and
 * the period-aware default due date — docs/cycles/2026-10-07-finance-money-guards.md.
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
  }: {
    sections: { id: string; name: string }[];
    value: string[];
    onChange: (ids: string[]) => void;
  }) => (
    <div>
      {sections.map((s) => (
        <label key={s.id}>
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={() => onChange(value.includes(s.id) ? [] : [s.id])}
          />
          {s.name}
        </label>
      ))}
    </div>
  ),
}));
vi.mock("@/lib/finance/run-bulk-generate", () => ({ runBulkCommit: vi.fn() }));

import { ScopeStep } from "../step-1-scope";
import { ReviewStep } from "../step-2-review";
import { CommitStep } from "../step-3-commit";
import { computeDefaultBillingForm, defaultDueDateForPeriod } from "../billing-defaults";
import type { BillingRunRowData } from "../types";

function line(finalAmount: number, source = "BASE") {
  return {
    id: `l-${finalAmount}-${source}`,
    feeComponentId: "fc-spp",
    labelSnapshot: "SPP",
    amount: 500_000,
    adjustmentAmount: finalAmount - 500_000,
    adjustmentNote: finalAmount === 500_000 ? null : "Keringanan",
    finalAmount,
    source,
  };
}

function row(id: string, name: string, totalDue: number, over: Partial<BillingRunRowData> = {}): BillingRunRowData {
  return {
    id,
    billingRunId: "run-1",
    studentId: `stu-${id}`,
    studentNameSnapshot: name,
    classLabelSnapshot: "KB 1",
    parentId: null,
    totalDue,
    status: "PENDING",
    invoiceId: null,
    error: null,
    lines: [line(totalDue)],
    ...over,
  };
}

function runPayload(rows: BillingRunRowData[]) {
  return {
    id: "run-1",
    periodLabel: "Oktober 2026",
    dueDate: "2026-10-31",
    academicYearId: "ay-1",
    status: "DRAFT",
    scope: {},
    createdAt: new Date().toISOString(),
    committedAt: null,
    rows: {
      data: rows,
      pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 },
    },
  };
}

function stubRunFetch(rows: BillingRunRowData[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/fee-components")) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => runPayload(rows) } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("step 3 summary — Rp 0 rows (FINX-4)", () => {
  const rows = [
    row("r1", "Aisyah", 500_000),
    row("r2", "Bilal", 0),
    row("r3", "Citra", 0),
    // Parked by an earlier partial commit — counted as Rp 0, not as an admin exclusion.
    row("r4", "Dimas", 0, { status: "EXCLUDED", error: "Rp 0 — tidak ditagih" }),
    row("r5", "Eko", 500_000, { status: "EXCLUDED" }),
  ];

  it("counts Rp 0 students out of the billable total and says so", async () => {
    stubRunFetch(rows);
    render(<CommitStep runId="run-1" onClose={vi.fn()} onCommitted={vi.fn()} onRebuilt={vi.fn()} />);

    expect(await screen.findByText(/3 siswa Rp 0 tidak ditagih/)).toBeInTheDocument();
    // Only Aisyah is billable; Eko is the single admin exclusion.
    expect(screen.getByText("Siswa akan ditagih").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Dikecualikan").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Komit 1 Tagihan" })).toBeInTheDocument();
  });

  it("offers to finish the draft when only Rp 0 rows remain, and omits the note when there are none", async () => {
    stubRunFetch([row("r2", "Bilal", 0)]);
    const { unmount } = render(
      <CommitStep runId="run-1" onClose={vi.fn()} onCommitted={vi.fn()} onRebuilt={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "Selesaikan Draf" })).toBeInTheDocument();
    unmount();

    stubRunFetch([row("r1", "Aisyah", 500_000)]);
    render(<CommitStep runId="run-1" onClose={vi.fn()} onCommitted={vi.fn()} onRebuilt={vi.fn()} />);
    await screen.findByRole("button", { name: "Komit 1 Tagihan" });
    expect(screen.queryByText(/Rp 0 tidak ditagih/)).not.toBeInTheDocument();
  });

  it("pins the action bar to the bottom of the scroll area", async () => {
    stubRunFetch(rows);
    render(<CommitStep runId="run-1" onClose={vi.fn()} onCommitted={vi.fn()} onRebuilt={vi.fn()} />);
    const commit = await screen.findByRole("button", { name: "Komit 1 Tagihan" });
    expect(commit.parentElement).toHaveClass("sticky", "bottom-0");
  });
});

describe("step 2 rows — Rp 0 rows (FINX-4)", () => {
  it('shows "Rp 0 — tidak ditagih" instead of a price for a zero row, and a price for the rest', async () => {
    stubRunFetch([row("r1", "Aisyah", 500_000), row("r2", "Bilal", 0)]);
    render(<ReviewStep runId="run-1" onAdvance={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText("Bilal");
    expect(screen.getAllByText("Rp 0 — tidak ditagih")).toHaveLength(1);
    expect(screen.getByText(/500\.000/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanjutkan" }).parentElement).toHaveClass("sticky", "bottom-0");
  });
});

describe("step 1 — due date follows the typed period", () => {
  const years = [{ id: "ay-1", name: "2026/2027", status: "ACTIVE" }];
  const classes = [{ id: "c-1", name: "Kelas A", academicYearId: "ay-1" }];

  beforeEach(() => vi.clearAllMocks());

  async function submitWith(periodLabel: string) {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { status: 201, json: async () => ({ id: "run-x" }) }
        : { ok: true, json: async () => classes },
    );
    vi.stubGlobal("fetch", fetcher);
    render(<ScopeStep years={years} onAdvance={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText(/Periode/);
    await user.clear(input);
    await user.type(input, periodLabel);
    await user.click(await screen.findByRole("checkbox", { name: "Kelas A" }));
    await user.click(screen.getByRole("button", { name: "Lanjutkan" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const post = fetcher.mock.calls.find(([, i]) => i?.method === "POST")?.[1];
    return JSON.parse(String(post?.body)) as { periodLabel: string; dueDate: string };
  }

  it("uses the end of the typed period's month and keeps the label as typed", async () => {
    const body = await submitWith("Des 2027");
    expect(body.dueDate).toBe("2027-12-31");
    expect(body.periodLabel).toBe("Des 2027");
  });

  it("leaves the default alone when the label does not name one month and year", async () => {
    const body = await submitWith("Semester 1 2025/2026");
    expect(body.dueDate).toBe(computeDefaultBillingForm(years).dueDate);
  });

  it("defaultDueDateForPeriod handles leap years and returns null for unparseable labels", () => {
    expect(defaultDueDateForPeriod("Feb 2028")).toBe("2028-02-29");
    expect(defaultDueDateForPeriod("Februari 2027")).toBe("2027-02-28");
    expect(defaultDueDateForPeriod("Semester 1")).toBeNull();
  });
});
