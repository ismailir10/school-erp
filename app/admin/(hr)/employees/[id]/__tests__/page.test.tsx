/**
 * T6c — employee detail migrated from AdminTabs to the Recipe 2b Dossier
 * layout (patterns.md). The contracts worth pinning here are the ones the
 * migration could silently break:
 *
 *  - every visible section is hash-addressable (`id` on the DOM node
 *    matches the `DossierNav` target), which is the whole point of trading
 *    tabs for one long scroll;
 *  - the Gaji section is permission-gated exactly like the old Gaji tab
 *    was — the server sends `salaryValues: null` (not `[]`) when the
 *    viewer lacks payroll access, and that must stay hidden, not render an
 *    empty state;
 *  - Kehadiran stays lazy: it costs its own request, so it must not fire
 *    until the admin opens it, same as the old tab only mounting on click;
 *  - a `#attendance`-style deep link expands the (closed-by-default)
 *    target section and fires its fetch, mirroring the `hashHandled`
 *    pattern in app/admin/guardians/[id]/page.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import EmployeeDetailPage from "@/app/admin/(hr)/employees/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "e1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { toast } from "sonner";

const employee = {
  id: "e1",
  kode: "EMP-001",
  nama: "Budi Santoso",
  formalName: null,
  email: "budi@example.com",
  noHp: "081234567890",
  jabatan: "Guru Kelas",
  campusId: "c1",
  hireDate: "2022-01-10",
  status: "ACTIVE",
  bankAccountNo: "1234567890",
  bankName: "BCA",
  bpjsEnrolled: true,
  leaveBalanceAnnual: 12,
  leaveBalanceSick: 14,
  campus: { name: "Kampus Utama" },
};

const salaryValues = [
  {
    id: "sv1",
    value: 5000000,
    componentDefId: "comp1",
    componentDef: { code: "GAPOK", label: "Gaji Pokok", category: "INCOME", calcType: "FIXED", sortOrder: 1 },
  },
];

type Calls = { url: string; method: string }[];

function stubFetch(over: { salary?: unknown; salaryOk?: boolean; employee?: unknown } = {}) {
  const calls: Calls = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET" });

    if (url === "/api/employees/e1") {
      return Promise.resolve({ ok: true, json: async () => over.employee ?? employee } as Response);
    }
    if (url === "/api/employees/e1/salary") {
      const ok = over.salaryOk ?? true;
      return Promise.resolve({ ok, json: async () => over.salary ?? salaryValues } as Response);
    }
    if (url === "/api/config/campuses") {
      return Promise.resolve({ ok: true, json: async () => [{ id: "c1", name: "Kampus Utama" }] } as Response);
    }
    if (url === "/api/employees/positions") {
      return Promise.resolve({ ok: true, json: async () => ["Guru Kelas"] } as Response);
    }
    if (url.startsWith("/api/employees/e1/attendance")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ records: [], summary: { present: 0, late: 0, absent: 0, leave: 0 } }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  return { fn, calls };
}

const urlsMatching = (calls: Calls, needle: string) => calls.filter((c) => c.url.includes(needle));

describe("employee dossier — hash-addressable sections", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    // Deep-link tests set the hash directly; nothing else here clears it
    // between tests, so leaking it would make later renders think they
    // already have a target to jump to.
    window.location.hash = "";
  });

  it("shows leave remaining against the allowance (sisa X dari Y hari), in the section and the rail", async () => {
    const { fn } = stubFetch({ employee: { ...employee, leaveUsedAnnual: 3, leaveUsedSick: 0 } });
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());

    expect(screen.getByText("Sisa 9 dari 12 hari")).toBeInTheDocument();
    expect(screen.getByText("Sisa 14 dari 14 hari")).toBeInTheDocument();
    // Rail tiles: remaining as the figure, allowance as the hint.
    expect(screen.getByText("sisa dari 12 hari")).toBeInTheDocument();
    expect(screen.getByText("sisa dari 14 hari")).toBeInTheDocument();
  });

  it("renders every visible section with a hash-addressable id", async () => {
    const { fn } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());

    for (const id of ["profile", "employment", "leave", "salary", "attendance"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("hides the Gaji section when the server withholds salaryValues (no payroll access)", async () => {
    const { fn } = stubFetch({ salary: null, salaryOk: false });
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());

    expect(document.getElementById("salary")).toBeNull();
    expect(screen.queryByText("Gaji")).not.toBeInTheDocument();
    // The rest of the dossier still renders — the gate hides one section,
    // not the page.
    expect(document.getElementById("profile")).not.toBeNull();
    expect(document.getElementById("attendance")).not.toBeNull();
  });

  it("does not request attendance until the Kehadiran section is opened", async () => {
    const user = userEvent.setup();
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());
    expect(urlsMatching(calls, "/attendance")).toHaveLength(0);

    const section = document.getElementById("attendance");
    const trigger = section?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(trigger).not.toBeNull();
    await user.click(trigger!);

    await waitFor(() => expect(urlsMatching(calls, "/attendance")).toHaveLength(1));
  });

  it("expands and fetches the Kehadiran section from a #attendance deep link", async () => {
    window.location.hash = "#attendance";
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());

    // Closed by default — the hash effect must be the thing that opened it.
    await waitFor(() => expect(urlsMatching(calls, "/attendance")).toHaveLength(1));

    const section = document.getElementById("attendance");
    const trigger = section?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(trigger).toHaveAttribute("data-panel-open");
  });
});

describe("Gaji section — calcType-aware value input", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // PCT_OF_BASE is a percentage of gaji_pokok (lib/payroll/engine.ts:
  // `amount = gajiPokokAmount * (baseValue / 100)`), not a rupiah amount —
  // RupiahInput would strip "2.5" down to digits-only and stamp a "Rp"
  // prefix on it, which is what the review caught.
  const mixedSalaryValues = [
    {
      id: "sv1",
      value: 5000000,
      componentDefId: "comp1",
      componentDef: { code: "GAPOK", label: "Gaji Pokok", category: "INCOME", calcType: "FIXED", sortOrder: 1 },
    },
    {
      id: "sv2",
      value: 2.5,
      componentDefId: "comp2",
      componentDef: { code: "TUNJ_JABATAN", label: "Tunjangan Jabatan", category: "INCOME", calcType: "PCT_OF_BASE", sortOrder: 2 },
    },
  ];

  it("keeps a PCT_OF_BASE value as a decimal percentage with no Rp addon", async () => {
    const { fn } = stubFetch({ salary: mixedSalaryValues });
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    const pctInput = await screen.findByRole("spinbutton", { name: "Nilai Tunjangan Jabatan" });
    expect(pctInput).toHaveValue(2.5);
    expect(pctInput).toHaveAttribute("type", "number");
    // Its own group shows "%", not "Rp".
    const pctGroup = pctInput.closest('[data-slot="input-group"]');
    expect(pctGroup).not.toBeNull();
    expect(pctGroup).toHaveTextContent("%");
    expect(pctGroup).not.toHaveTextContent("Rp");
  });

  it("uses RupiahInput (Rp addon, thousands-grouped) for a FIXED value", async () => {
    const { fn } = stubFetch({ salary: mixedSalaryValues });
    vi.stubGlobal("fetch", fn);
    render(<EmployeeDetailPage />);

    const fixedInput = await screen.findByRole("textbox", { name: "Nilai Gaji Pokok" });
    expect(fixedInput).toHaveValue("5.000.000");
    const fixedGroup = fixedInput.closest('[data-slot="input-group"]');
    expect(fixedGroup).not.toBeNull();
    expect(fixedGroup).toHaveTextContent("Rp");
  });
});

/**
 * T6 (2026-09-27 admin-finish-standard) — the Profil/Kepegawaian/Saldo Cuti
 * edit card migrated from a 12-field `useState` + a single `fetch` onto
 * react-hook-form + zod (`employeeEditFormSchema`, lib/validations/employee.ts).
 */
describe("employee profile edit card", () => {
  function stubEditableFetch(overrides: { putStatus?: number; putBody?: unknown } = {}) {
    const { putStatus = 200, putBody = employee } = overrides;
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url === "/api/employees/e1" && method === "PUT") {
        return Promise.resolve({ ok: putStatus < 400, status: putStatus, json: async () => putBody } as Response);
      }
      if (url === "/api/employees/e1") {
        return Promise.resolve({ ok: true, json: async () => employee } as Response);
      }
      if (url === "/api/employees/e1/salary") {
        return Promise.resolve({ ok: true, json: async () => salaryValues } as Response);
      }
      if (url === "/api/config/campuses") {
        return Promise.resolve({ ok: true, json: async () => [{ id: "c1", name: "Kampus Utama" }] } as Response);
      }
      if (url === "/api/employees/positions") {
        return Promise.resolve({ ok: true, json: async () => ["Guru Kelas"] } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    return { fn, calls };
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks an empty Nama with an inline error and sends no PUT", async () => {
    const { fn, calls } = stubEditableFetch();
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Ubah" }));
    await user.clear(screen.getByRole("textbox", { name: "Nama" }));
    await user.click(screen.getByRole("button", { name: "Simpan Profil" }));

    expect(await screen.findByText("Nama wajib diisi")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("submits every field as the PUT body, including a cleared optional field", async () => {
    const { fn, calls } = stubEditableFetch();
    vi.stubGlobal("fetch", fn);
    const user = userEvent.setup();
    render(<EmployeeDetailPage />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Budi Santoso" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Ubah" }));
    await user.clear(screen.getByLabelText("No. HP"));
    await user.click(screen.getByRole("button", { name: "Simpan Profil" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const putCall = calls.find((c) => c.method === "PUT")!;
    expect(putCall.url).toBe("/api/employees/e1");
    expect(putCall.body).toEqual({
      nama: "Budi Santoso",
      formalName: "",
      email: "budi@example.com",
      noHp: "",
      jabatan: "Guru Kelas",
      campusId: "c1",
      hireDate: "2022-01-10",
      bankName: "BCA",
      bankAccountNo: "1234567890",
      bpjsEnrolled: true,
      leaveBalanceAnnual: 12,
      leaveBalanceSick: 14,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Data karyawan disimpan"));
  });
});
