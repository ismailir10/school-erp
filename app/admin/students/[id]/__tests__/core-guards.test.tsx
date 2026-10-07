/**
 * Admin core guards cycle (2026-10-07), T2 — student detail page:
 *   ADM-1   "Daftarkan ke Kelas" only for ACTIVE; WITHDRAWN gets "Aktifkan kembali"
 *   CORE-13 "Luluskan" only with an active enrolment
 *   ADM-2   NIS_TAKEN on the Data Anak edit lands on the NIS field
 *   ADM-3   Data Anak edit registers an unsaved-changes guard; save is single-flight
 *   ADM-4   the back link restores the list's ?q=&status=&page=
 *
 * Stubs mirror lifecycle-and-forms.test.tsx (ResizeObserver, class picker).
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

const guardCalls: Array<{ dirty: boolean; message?: string }> = [];
vi.mock("@/components/admin/unsaved-changes-provider", () => ({
  useUnsavedChangesGuard: (dirty: boolean, message?: string) => {
    guardCalls.push({ dirty, message });
  },
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
    name: "Aisyah Putri",
    nickname: null,
    dateOfBirth: "2021-01-15",
    gender: "P",
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

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];

function stubFetch(
  student: ReturnType<typeof makeStudent>,
  extra?: (url: string, method: string) => Response | Promise<Response> | undefined,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    const custom = extra?.(url, method);
    if (custom) return Promise.resolve(custom);
    if (url === "/api/students/s1" && method === "GET") {
      return Promise.resolve({ ok: true, json: async () => student } as Response);
    }
    if (url.startsWith("/api/invoices")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  toastError.mockClear();
  toastSuccess.mockClear();
  guardCalls.length = 0;
  calls = [];
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("ADM-1 — header actions follow the student's status", () => {
  it("ACTIVE: Daftarkan ke Kelas is offered, Aktifkan kembali is not", async () => {
    vi.stubGlobal("fetch", stubFetch(makeStudent()));
    render(<StudentDetailPage />);

    expect(await screen.findByRole("button", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aktifkan kembali" })).not.toBeInTheDocument();
  });

  it("WITHDRAWN: Daftarkan ke Kelas is hidden and Aktifkan kembali takes its place", async () => {
    vi.stubGlobal("fetch", stubFetch(makeStudent({ status: "WITHDRAWN", enrollments: [] })));
    render(<StudentDetailPage />);

    expect(await screen.findByRole("button", { name: "Aktifkan kembali" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Daftarkan ke Kelas" })).not.toBeInTheDocument();
  });

  it("GRADUATED: neither enrol nor reactivate is offered", async () => {
    vi.stubGlobal("fetch", stubFetch(makeStudent({ status: "GRADUATED", enrollments: [] })));
    render(<StudentDetailPage />);

    await screen.findByRole("heading", { name: "Aisyah Putri" });
    expect(screen.queryByRole("button", { name: "Daftarkan ke Kelas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aktifkan kembali" })).not.toBeInTheDocument();
  });

  it("Aktifkan kembali confirms, PUTs { status: ACTIVE }, toasts and refetches", async () => {
    const user = userEvent.setup();
    let student = makeStudent({ status: "WITHDRAWN", enrollments: [] });
    vi.stubGlobal(
      "fetch",
      stubFetch(student, (url, method) => {
        if (url === "/api/students/s1" && method === "PUT") {
          student = makeStudent({ status: "ACTIVE", enrollments: [] });
          return { ok: true, status: 200, json: async () => student } as Response;
        }
        if (url === "/api/students/s1" && method === "GET") {
          return { ok: true, json: async () => student } as Response;
        }
        return undefined;
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Aktifkan kembali" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Aktifkan kembali Aisyah Putri?")).toBeInTheDocument();
    expect(
      within(confirm).getByText("Status siswa kembali Aktif. Daftarkan ke kelas setelahnya."),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);

    await user.click(within(confirm).getByRole("button", { name: "Aktifkan kembali" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Siswa aktif kembali"));
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe("/api/students/s1");
    expect(put?.body).toEqual({ status: "ACTIVE" });
    // Refetched: the student is ACTIVE now, so the enrol button replaces it.
    expect(await screen.findByRole("button", { name: "Daftarkan ke Kelas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aktifkan kembali" })).not.toBeInTheDocument();
  });

  it("a STUDENT_NOT_ACTIVE 409 from the enrol dialog is shown inline in the dialog", async () => {
    const user = userEvent.setup();
    const message = "Siswa berstatus Keluar tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu.";
    vi.stubGlobal(
      "fetch",
      stubFetch(makeStudent({ enrollments: [] }), (url, method) => {
        if (url.includes("/api/class-sections")) {
          return {
            ok: true,
            json: async () => [{ id: "sec-1", name: "KB 1", program: { name: "KB" }, academicYear: { name: "2025/2026" }, campus: { name: "A" }, _count: { enrollments: 1 }, capacity: 20 }],
          } as Response;
        }
        if (url.includes("/api/students/s1/enroll") && method === "POST") {
          return { ok: false, status: 409, json: async () => ({ error: message, code: "STUDENT_NOT_ACTIVE" }) } as Response;
        }
        return undefined;
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Daftarkan ke Kelas" }));
    await user.selectOptions(await screen.findByLabelText(/^Pilih Kelas\*?$/), "sec-1");
    await user.click(screen.getByRole("button", { name: "Daftarkan" }));

    const dialog = await screen.findByRole("dialog", { name: "Daftarkan ke Kelas" });
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });
});

describe("CORE-13 — Luluskan needs an active enrolment", () => {
  it("is offered when the student has an active enrolment", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", stubFetch(makeStudent()));
    render(<StudentDetailPage />);

    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Luluskan" })).toBeInTheDocument();
  });

  it("is hidden when the student has no active enrolment (Keluarkan stays)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", stubFetch(makeStudent({ enrollments: [] })));
    render(<StudentDetailPage />);

    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Keluarkan" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Luluskan" })).not.toBeInTheDocument();
  });

  it("is hidden when every enrolment has ended", async () => {
    const user = userEvent.setup();
    const ended = makeStudent().enrollments.map((e) => ({ ...e, status: "WITHDRAWN" }));
    vi.stubGlobal("fetch", stubFetch(makeStudent({ enrollments: ended })));
    render(<StudentDetailPage />);

    await openMenu(user);
    await screen.findByRole("menuitem", { name: "Keluarkan" });
    expect(screen.queryByRole("menuitem", { name: "Luluskan" })).not.toBeInTheDocument();
  });
});

describe("ADM-3 / ADM-2 — Data Anak edit", () => {
  it("registers an unsaved-changes guard only once the form is dirty", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", stubFetch(makeStudent()));
    render(<StudentDetailPage />);

    expect(guardCalls.at(-1)?.dirty ?? false).toBe(false);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByRole("button", { name: "Simpan Perubahan" });
    expect(guardCalls.at(-1)?.dirty).toBe(false);

    await user.type(screen.getByLabelText("Nama Panggilan"), "Eef");
    await waitFor(() => expect(guardCalls.at(-1)?.dirty).toBe(true));
    expect(guardCalls.at(-1)?.message).toMatch(/belum disimpan/);

    // Cancelling leaves edit mode, so nothing is left to protect.
    await user.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(guardCalls.at(-1)?.dirty).toBe(false));
  });

  it("a double click on Simpan Perubahan sends one PUT", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const student = makeStudent();
    vi.stubGlobal(
      "fetch",
      stubFetch(student, (url, method) => {
        if (url === "/api/students/s1" && method === "PUT") {
          return gate.then(() => ({ ok: true, status: 200, json: async () => student }) as Response) as unknown as Response;
        }
        return undefined;
      }),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Nama Panggilan"), "Eef");
    await user.dblClick(screen.getByRole("button", { name: "Simpan Perubahan" }));
    release();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Data siswa diperbarui"));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("a NIS_TAKEN 409 puts the message on the NIS field and stays in edit mode", async () => {
    const user = userEvent.setup();
    const message = "NIS 002 sudah dipakai siswa lain (Budi Santoso).";
    vi.stubGlobal(
      "fetch",
      stubFetch(makeStudent(), (url, method) =>
        url === "/api/students/s1" && method === "PUT"
          ? ({ ok: false, status: 409, json: async () => ({ error: message, code: "NIS_TAKEN", field: "nis" }) } as Response)
          : undefined,
      ),
    );
    render(<StudentDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("NIS"), "002");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText("NIS")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Simpan Perubahan" })).toBeInTheDocument();
  });
});

describe("ADM-4 — back link keeps the list state", () => {
  it("points at the list with the remembered query", async () => {
    sessionStorage.setItem("admin.students.listQuery", "q=aisyah&status=WITHDRAWN&page=2");
    vi.stubGlobal("fetch", stubFetch(makeStudent()));
    render(<StudentDetailPage />);

    const back = await screen.findByRole("link", { name: /Kembali ke Daftar Siswa/ });
    await waitFor(() => expect(back).toHaveAttribute("href", "/admin/students?q=aisyah&status=WITHDRAWN&page=2"));
  });

  it("is the bare list when nothing was remembered", async () => {
    vi.stubGlobal("fetch", stubFetch(makeStudent()));
    render(<StudentDetailPage />);

    expect(await screen.findByRole("link", { name: /Kembali ke Daftar Siswa/ })).toHaveAttribute("href", "/admin/students");
  });
});
