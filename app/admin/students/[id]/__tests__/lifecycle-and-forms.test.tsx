/**
 * T4 (2026-09-27, admin-finish-standard) — behaviour tests for the RHF forms
 * introduced/fixed by the dossier split: Data Anak's gender-null fix,
 * Riwayat Status' withdrawal-reason edit, Informasi Tambahan's duplicate-key
 * guard, Naik Kelas' empty-selection guard, Keluarkan staying open on a
 * server failure, and the enroll dialog's non-409 `FormRootError`.
 *
 * `ClassSectionCombobox` and `ResizeObserver` are stubbed for the same
 * reasons spelled out in `page.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: ({
    id,
    value,
    onChange,
    sections,
  }: {
    id?: string;
    value: string;
    onChange: (id: string) => void;
    sections: Array<{ id: string; name: string }>;
  }) => (
    <select id={id} aria-required="true" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">-- pilih --</option>
      {sections.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    canEdit: true,
    name: "Aisyah Putri",
    nickname: null,
    dateOfBirth: "2021-01-15",
    gender: null,
    address: null,
    notes: null,
    metadata: null,
    status: "ACTIVE",
    nis: null,
    nisn: null,
    birthPlace: null,
    nik: null,
    kkNumber: null,
    livingWith: null,
    photoUrl: null,
    createdAt: null,
    withdrawalReason: null,
    withdrawalDate: null,
    graduationDate: null,
    guardians: [],
    enrollments: [
      {
        id: "e1",
        enrollDate: "2025-07-14",
        status: "ACTIVE",
        classSection: {
          id: "cs1",
          name: "TKIT B",
          program: { name: "TKIT", code: "TKIT", type: "SEMESTER" },
          academicYear: { name: "2025/2026", status: "ACTIVE" },
          campus: { name: "Taman Aster" },
        },
      },
    ],
    ...overrides,
  };
}

type Calls = { url: string; method: string; body: string | undefined }[];

function baseHandlers(student: ReturnType<typeof makeStudent>, calls: Calls) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });

    if (url === "/api/students/s1" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => student } as Response);
    }
    if (url.startsWith("/api/invoices")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    return undefined; // let the caller's own handler decide
  };
}

describe("Data Anak — gender-null fix", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("saving a no-gender student sends gender: null, not \"\"", async () => {
    const user = userEvent.setup();
    const student = makeStudent();
    const calls: Calls = [];
    const base = baseHandlers(student, calls);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = base(input, init);
        if (handled) return handled;
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/students/s1" && init?.method === "PUT") {
          return Promise.resolve({ ok: true, json: async () => student } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Data siswa diperbarui"));
    const putCall = calls.find((c) => c.url === "/api/students/s1" && c.method === "PUT");
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall!.body!);
    expect(body.gender).toBeNull();
    expect(body).not.toHaveProperty("status");
  });
});

describe("Riwayat Status — withdrawal reason inline edit", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    toastError.mockClear();
  });

  it("an empty reason shows an inline error and sends no request", async () => {
    const user = userEvent.setup();
    const student = makeStudent({
      status: "WITHDRAWN",
      withdrawalReason: "Pindah domisili",
      withdrawalDate: "2026-01-10",
    });
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = baseHandlers(student, calls)(input, init);
        return handled ?? Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    // Riwayat Status sits in Kelas & Akademik, which starts closed.
    await screen.findByRole("heading", { name: "Aisyah Putri" });
    await user.click(document.querySelector<HTMLElement>('[aria-controls="group-kelas-content"]')!);
    await waitFor(() => expect(document.getElementById("riwayat-status")).toBeTruthy());
    const section = document.getElementById("riwayat-status") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Ubah" }));
    const textarea = await screen.findByLabelText("Alasan keluar");
    await user.clear(textarea);
    calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Alasan keluar wajib diisi")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/students/s1" && c.method === "PUT")).toBe(false);
  });
});

describe("Informasi Tambahan — duplicate-key guard", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("a duplicate key shows an inline error on the offending row and sends no PUT", async () => {
    const user = userEvent.setup();
    const student = makeStudent();
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = baseHandlers(student, calls)(input, init);
        return handled ?? Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Field" }));
    await user.click(screen.getByRole("button", { name: "Tambah Field" }));

    const keyInputs = screen.getAllByPlaceholderText("Nama field");
    expect(keyInputs).toHaveLength(2);
    await user.type(keyInputs[0], "hobi");
    await user.type(keyInputs[1], "hobi");
    // Blur the second field so onTouched validation runs before Simpan.
    await user.tab();

    calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    expect(await screen.findByText("Nama field harus unik")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/students/s1" && c.method === "PUT")).toBe(false);
  });
});

describe("Informasi Tambahan — save clears the dirty state", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("after a successful save the Simpan action goes away and the saved row stays", async () => {
    const user = userEvent.setup();
    // `metadata` is a JSON string once saved; the fixture types it as null.
    let student: Omit<ReturnType<typeof makeStudent>, "metadata"> & { metadata: string | null } =
      makeStudent();
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/students/s1" && init?.method === "PUT") {
          calls.push({ url, method: "PUT", body: init.body as string });
          const { metadata } = JSON.parse(init.body as string);
          student = { ...student, metadata: JSON.stringify(metadata) };
          return Promise.resolve({ ok: true, json: async () => student } as Response);
        }
        const handled = baseHandlers(student as ReturnType<typeof makeStudent>, calls)(input, init);
        return handled ?? Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Field" }));
    await user.type(screen.getByPlaceholderText("Nama field"), "hobi");
    await user.type(screen.getByPlaceholderText("Nilai"), "menggambar");
    await user.click(screen.getByRole("button", { name: "Simpan" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Informasi tambahan disimpan"));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Simpan" })).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText("Nama field")).toHaveValue("hobi");
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("Naik Kelas — empty selection", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  async function openPromote(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
    await user.click(await screen.findByRole("menuitem", { name: "Naik Kelas" }));
  }

  it("submitting with no class chosen shows an inline error and sends no request", async () => {
    const user = userEvent.setup();
    const student = makeStudent();
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = baseHandlers(student, calls)(input, init);
        if (handled) return handled;
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/class-sections")) {
          return Promise.resolve({ ok: true, json: async () => [] } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await openPromote(user);
    calls.length = 0;
    await user.click(await screen.findByRole("button", { name: "Naik Kelas" }));

    expect(await screen.findByText("Kelas tujuan wajib dipilih")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("/promote"))).toBe(false);
  });
});

describe("Keluarkan — server failure keeps the dialog open", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("a 400 keeps the dialog open and shows the error, instead of closing it", async () => {
    const user = userEvent.setup();
    const student = makeStudent();
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = baseHandlers(student, calls)(input, init);
        if (handled) return handled;
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/students/s1/withdraw")) {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: async () => ({ error: "Siswa sudah mengundurkan diri" }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
    await user.click(await screen.findByRole("menuitem", { name: "Keluarkan" }));

    const reasonField = await screen.findByLabelText(/^Alasan Keluar\*?$/);
    await user.type(reasonField, "Pindah sekolah");
    await user.click(screen.getByRole("button", { name: "Keluarkan" }));

    expect(await screen.findByText("Siswa sudah mengundurkan diri")).toBeInTheDocument();
    // Still open — the reason field (only rendered while the dialog is up)
    // is still there, and the destructive submit button is still reachable.
    expect(screen.getByLabelText(/^Alasan Keluar\*?$/)).toBeInTheDocument();
  });
});

describe("Enroll dialog — non-409 failure", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("a 500 shows FormRootError instead of only a toast", async () => {
    const user = userEvent.setup();
    const student = makeStudent({ enrollments: [] });
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const handled = baseHandlers(student, calls)(input, init);
        if (handled) return handled;
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/class-sections")) {
          return Promise.resolve({
            ok: true,
            json: async () => [{ id: "sec-1", name: "KB 1", program: { name: "KB" }, academicYear: { name: "2025/2026" }, campus: { name: "A" }, _count: { enrollments: 1 }, capacity: 20 }],
          } as Response);
        }
        if (url.includes("/api/students/s1/enroll")) {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Terjadi kesalahan server" }) } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Daftarkan ke Kelas" }));
    const select = await screen.findByLabelText(/^Pilih Kelas\*?$/);
    await user.selectOptions(select, "sec-1");
    await user.click(screen.getByRole("button", { name: "Daftarkan" }));

    expect(await screen.findByText("Terjadi kesalahan server")).toBeInTheDocument();
  });
});
