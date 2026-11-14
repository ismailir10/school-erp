/**
 * T4 (2026-09-27, admin-forms-rhf) — "Timpa Kehadiran" now runs on
 * react-hook-form + zodResolver (`updateStudentAttendanceSchema`, reused
 * as-is — the dialog's fields already match the API shape).
 *
 * Kept in its own file, not appended to `page.test.tsx`: this page mounts
 * three independent fetch effects (class-sections, stats, list) plus a
 * second, eagerly-mounted tab (`RecapView`, its own `/recap` fetch) behind
 * `AdminTabs`.
 *
 * (Cycle 3 T7) The row menu used to open unreliably under CPU contention.
 * The real cause was `columns` being rebuilt on every render of
 * `StudentAttendancePage` (a brand-new array identity each render) — the
 * DropdownMenu inside the actions cell remounted whenever any of the
 * page's several mount-time fetch effects settled and called `setState`,
 * which could tear the popup down mid-open. `columns` is now `useMemo`'d
 * (module code, not this test), so the menu no longer remounts out from
 * under a click — a plain `userEvent.click` + `findBy*` (which already
 * awaits) is enough; no manual settle-ticks or click-retry loop needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentAttendancePage from "../page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const CLASS_SECTIONS = [
  {
    id: "cs-1",
    name: "TK B 1",
    academicYear: { id: "ay-1", name: "2026/2027", status: "ACTIVE" },
    capacity: 20,
    _count: { enrollments: 10 },
  },
];

const record = {
  id: "att-1",
  date: "2026-09-20",
  status: "PRESENT",
  notes: null,
  student: { id: "s1", name: "Aisyah Putri", nickname: null },
  classSection: { id: "cs-1", name: "TK B 1" },
};

function stubFetchWithRecord() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/class-sections")) {
      return Promise.resolve({ ok: true, json: async () => CLASS_SECTIONS } as Response);
    }
    if (url.includes("/api/student-attendance/stats")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ present: 0, absent: 0, sick: 0, permission: 0 }),
      } as Response);
    }
    if (url.includes("/api/student-attendance/att-1") && init?.method === "PUT") {
      return Promise.resolve({ ok: true, json: async () => ({ ...record, status: "SICK" }) } as Response);
    }
    if (url.includes("/api/student-attendance?")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [record],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("StudentAttendancePage — Timpa Kehadiran dialog (RHF)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetchWithRecord());
  });

  async function openOverrideDialog(user: ReturnType<typeof userEvent.setup>) {
    render(<StudentAttendancePage />);
    await screen.findByText("Aisyah Putri");
    // Base UI Menu — real pointer sequence via userEvent (see
    // app/admin/fees/__tests__/page.test.tsx and
    // app/admin/guardians/__tests__/page.test.tsx for the same pattern).
    const trigger = await screen.findByRole("button", { name: "Buka menu aksi" });
    await user.click(trigger);
    const timpa = await screen.findByRole("menuitem", { name: "Timpa" });
    await user.click(timpa);
    return screen.findByRole("dialog", { name: "Timpa Kehadiran" });
  }

  it("submits a PUT with the selected status and notes on a valid save", async () => {
    const user = userEvent.setup();
    const dialog = await openOverrideDialog(user);

    await user.click(within(dialog).getByLabelText("Status Kehadiran"));
    await user.click(await screen.findByRole("option", { name: "Sakit" }));

    const notesField = within(dialog).getByLabelText("Catatan (opsional)");
    await user.type(notesField, "Demam ringan");

    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));

    const { toast } = await import("sonner");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Kehadiran ditimpa"));

    const putCall = vi.mocked(fetch).mock.calls.find(
      ([reqUrl, init]) =>
        String(reqUrl).includes("/api/student-attendance/att-1") &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const [, putInit] = putCall as [string, RequestInit];
    const body = JSON.parse(putInit.body as string);
    expect(body.status).toBe("SICK");
    expect(body.notes).toBe("Demam ringan");
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/student-attendance/stats"))).toHaveLength(2));
  });

  it("clearing Catatan sends notes: null (the pre-migration `notes || null` contract)", async () => {
    const user = userEvent.setup();
    const dialog = await openOverrideDialog(user);

    // Nothing typed — Catatan starts blank ("" from the record's null notes).
    await user.click(within(dialog).getByRole("button", { name: "Simpan" }));

    await waitFor(() => {
      const putCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([reqUrl, init]) =>
            String(reqUrl).includes("/api/student-attendance/att-1") &&
            (init as RequestInit | undefined)?.method === "PUT",
        );
      expect(putCall).toBeTruthy();
    });
    const putCall = vi.mocked(fetch).mock.calls.find(
      ([reqUrl, init]) =>
        String(reqUrl).includes("/api/student-attendance/att-1") &&
        (init as RequestInit | undefined)?.method === "PUT",
    ) as [string, RequestInit];
    const body = JSON.parse(putCall[1].body as string);
    expect(body.status).toBe("PRESENT");
    expect(body.notes).toBeNull();
  });
});
