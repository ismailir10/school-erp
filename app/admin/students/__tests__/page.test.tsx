/**
 * Admin UI audit fixes (T2, finding #1) — `components/ui/field.tsx` renders
 * `FieldLabel` as a plain sibling `<Label>`, never a wrapper, so a control
 * with no `htmlFor`/`id` pair has NO accessible name at all.
 * `screen.getByLabelText` resolves a control only through a real label
 * association (`<label for>`, `aria-labelledby`, or wrapping `<label>`) — it
 * does NOT fall back to nearby unassociated text. Against the pre-fix
 * markup (`<FieldLabel>Nama Lengkap</FieldLabel><Input .../>` with no
 * `htmlFor`/`id`) every assertion below would throw
 * `Unable to find a label with the text of: ...`. This test only passes
 * because `app/admin/students/page.tsx` now wires `htmlFor`/`id` pairs
 * (e.g. `student-name`, `student-gender`) between each `FieldLabel` and its
 * control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentsPage from "@/app/admin/students/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function stubFetch(studentsData: unknown[] = []) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/students/stats")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ total: 0, active: 0, graduated: 0 }),
      } as Response);
    }
    if (url.includes("/api/students?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          capabilities: { canCreate: true, canEdit: true }, data: studentsData,
          pagination: { page: 1, pageSize: 20, total: studentsData.length, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("StudentsPage — create dialog accessible names (AC1)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  it("resolves getByLabelText for representative fields, including the required one", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />);

    await user.click(await screen.findByRole("button", { name: "Tambah Siswa" }));

    // Required field — also asserts the required+aria-required wiring the
    // spec calls for alongside every `<FieldLabel required>`. The label's
    // textContent includes a trailing `aria-hidden` asterisk span
    // ("Nama Lengkap*"), so the query anchors on it rather than
    // requiring an exact string match.
    const nameInput = screen.getByLabelText(/^Nama Lengkap\*?$/);
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAttribute("aria-required", "true");

    // Plain Input.
    expect(screen.getByLabelText("Nama Panggilan")).toBeInTheDocument();
    expect(screen.getByLabelText("NIS")).toBeInTheDocument();

    // Textarea.
    expect(screen.getByLabelText("Catatan")).toBeInTheDocument();

    // shadcn <Select> — id lives on <SelectTrigger>, not <Select>.
    expect(screen.getByLabelText("Jenis Kelamin")).toBeInTheDocument();
    expect(screen.getByLabelText("Tinggal Dengan")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });
});

describe("StudentsPage — Kelas column shows both enrollments (T9)", () => {
  it("renders both the sekolah and daycare class for a dual-enrolled student, primary first", async () => {
    const dualEnrolledStudent = {
      id: "s1",
      name: "Aisyah Putri",
      nickname: null,
      dateOfBirth: null,
      gender: null,
      status: "ACTIVE",
      nis: null,
      nisn: null,
      notes: null,
      photoUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      guardians: [],
      enrollments: [
        {
          id: "enr-daycare",
          enrollDate: "2025-06-01",
          classSection: { name: "Daycare 1", program: { name: "Daycare", type: "YEAR_ROUND" } },
        },
        {
          id: "enr-sekolah",
          enrollDate: "2025-07-01",
          classSection: { name: "TKIT A", program: { name: "Taman Kanak-kanak", type: "SEMESTER" } },
        },
      ],
    };
    vi.stubGlobal("fetch", stubFetch([dualEnrolledStudent]));

    render(<StudentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Aisyah Putri")).toBeInTheDocument();
    });

    // Primary (SEMESTER/sekolah) shown first, daycare second — never hidden.
    expect(screen.getByText("Taman Kanak-kanak")).toBeInTheDocument();
    // (The mobile-only meta under the name repeats the placements, hidden from md up — hence getAll.)
    expect(screen.getAllByText(/TKIT A/).length).toBeGreaterThan(0);
    expect(screen.getByText("Daycare")).toBeInTheDocument();
    expect(screen.getAllByText(/Daycare 1/).length).toBeGreaterThan(0);

    // The assertions above only prove both are present. Pin the ordering the
    // comment claims, and that the two placements are stacked as separate
    // lines rather than joined into one long inline run — that run is what
    // forced the column wide enough to push the page past the viewport and
    // clip the header's action buttons.
    const cell = screen.getByText("Taman Kanak-kanak").closest("td");
    const lines = cell?.querySelectorAll(":scope > div > span");
    expect(lines).toHaveLength(2);
    expect(lines?.[0]).toHaveTextContent("Taman Kanak-kanak · TKIT A");
    expect(lines?.[1]).toHaveTextContent("Daycare · Daycare 1");
  });
});

describe("StudentsPage — name is the link (T7, admin-ui-standard-c1)", () => {
  it("renders the student name as a link to the detail page and drops the separate Lihat button", async () => {
    const student = {
      id: "s2",
      name: "Budi Santoso",
      nickname: null,
      dateOfBirth: null,
      gender: null,
      status: "ACTIVE",
      nis: null,
      nisn: null,
      notes: null,
      photoUrl: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      guardians: [],
      enrollments: [],
    };
    vi.stubGlobal("fetch", stubFetch([student]));

    render(<StudentsPage />);

    const nameLink = await screen.findByRole("link", { name: /Budi Santoso/ });
    expect(nameLink).toHaveAttribute("href", "/admin/students/s2");
    expect(screen.queryByRole("button", { name: /^Lihat/ })).not.toBeInTheDocument();
  });
});

// T4 fix (2026-09-27, admin-forms-rhf review) — the RHF migration's first
// pass wrapped every optional field in `optionalTrimmed`, which coerces a
// blank field to `undefined`; `JSON.stringify` then drops that key, and
// `PUT /api/students/[id]` reads an ABSENT key as "leave the column alone"
// (app/api/students/[id]/route.ts ~177-187) — so clearing an optional field
// in the edit dialog silently did nothing. `studentFormSchema` now emits
// `null` (never `undefined`) for a blank field, matching the pre-migration
// client's `field.trim() || null`, sent as an explicit key every time.
describe("StudentsPage — edit/create PUT and POST bodies match the pre-migration contract", () => {
  const fullStudent = {
    name: "Aisyah Putri",
    nickname: "Eef",
    gender: "P",
    dateOfBirth: "2018-04-12",
    address: "Jl. Mawar No. 7",
    notes: "Catatan awal",
    nis: "NIS001",
    nisn: "NISN001",
    birthPlace: "Bandung",
    nik: "3273000000000001",
    kkNumber: "3273000000000002",
    livingWith: "ORANG_TUA",
    status: "ACTIVE",
  };

  const rowStudent = {
    id: "s1",
    name: fullStudent.name,
    nickname: fullStudent.nickname,
    dateOfBirth: fullStudent.dateOfBirth,
    gender: fullStudent.gender,
    status: fullStudent.status,
    nis: fullStudent.nis,
    nisn: fullStudent.nisn,
    notes: fullStudent.notes,
    photoUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    guardians: [],
    enrollments: [],
  };

  function stubFetchForMutations() {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method;
      if (url.includes("/api/students/stats")) {
        return Promise.resolve({ ok: true, json: async () => ({ total: 1, active: 1, graduated: 0 }) } as Response);
      }
      if (url === "/api/students/s1" && (method === undefined || method === "GET")) {
        return Promise.resolve({ ok: true, json: async () => fullStudent } as Response);
      }
      if (url === "/api/students/s1" && method === "PUT") {
        return Promise.resolve({ ok: true, json: async () => ({ ...fullStudent, id: "s1" }) } as Response);
      }
      if (url === "/api/students" && method === "POST") {
        return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: "s-new" }) } as Response);
      }
      if (url.includes("/api/students?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ capabilities: { canCreate: true, canEdit: true }, data: [rowStudent], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetchForMutations());
  });

  it("clearing Nama Panggilan on edit sends nickname: null explicitly (not an omitted key)", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />);

    await screen.findByText("Aisyah Putri");
    // Base UI Menu — real pointer sequence via userEvent (see
    // app/admin/fees/__tests__/page.test.tsx for the same pattern).
    await user.click(await screen.findByRole("button", { name: "Aksi untuk Aisyah Putri" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit Siswa" });
    const nickname = await within(dialog).findByLabelText("Nama Panggilan");
    expect(nickname).toHaveValue("Eef");
    await user.clear(nickname);

    await user.click(within(dialog).getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      const putCall = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
      expect(putCall).toBeTruthy();
    });
    const putCall = vi.mocked(fetch).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    ) as [string, RequestInit];
    const body = JSON.parse(putCall[1].body as string);
    expect("nickname" in body).toBe(true);
    expect(body.nickname).toBeNull();
    // Untouched fields still ride along explicitly too (never omitted) —
    // the same "always send every key" contract as the pre-migration client.
    expect(body.name).toBe("Aisyah Putri");
    expect(body.address).toBe(fullStudent.address);
    expect(body.status).toBe("ACTIVE");
  });

  it("create with every optional field left blank sends null for each (not an omitted key)", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />);

    await screen.findByText("Aisyah Putri");
    await user.click(await screen.findByRole("button", { name: "Tambah Siswa" }));
    const dialog = await screen.findByRole("dialog", { name: "Tambah Siswa" });

    await user.type(within(dialog).getByLabelText(/^Nama Lengkap\*?$/), "Budi Santoso");
    await user.click(within(dialog).getByRole("button", { name: "Tambah Siswa" }));

    await waitFor(() => {
      const postCall = vi
        .mocked(fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(postCall).toBeTruthy();
    });
    const postCall = vi.mocked(fetch).mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    ) as [string, RequestInit];
    const body = JSON.parse(postCall[1].body as string);
    expect(body.name).toBe("Budi Santoso");
    for (const key of ["nickname", "gender", "dateOfBirth", "address", "notes", "nis", "nisn", "birthPlace", "nik", "kkNumber", "livingWith"]) {
      expect(body).toHaveProperty(key);
      expect(body[key]).toBeNull();
    }
    expect(body.status).toBe("ACTIVE");
  });
});
