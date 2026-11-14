/**
 * Admin UI audit fixes (T7, finding #5) — the note-delete confirmation on
 * this page called a soft delete (`app/api/student-journal/admin/notes/[id]/
 * route.ts` sets `status: "INACTIVE"`, never a hard delete) but the dialog's
 * title and confirm button said "Hapus" / "Ya, Hapus". Per voice.md's
 * destructive-confirmation table, soft delete must say "Nonaktifkan", never
 * "Hapus" — the dialog's own body copy already said "dinonaktifkan", so the
 * title/button contradicted the body. This test renders the real page,
 * opens the Catatan tab, triggers the delete confirm, and asserts the fixed
 * copy. Against the pre-fix markup, `getByText("Nonaktifkan catatan?")`
 * and `getByRole("button", { name: "Ya, Nonaktifkan" })` would both throw.
 *
 * Cycle D (2026-09-03 journal-admin-catchup, T2) — the Catatan tab now
 * renders the full note thread via `NoteThreadPanel` (its own fetch to
 * `GET /api/student-journal/notes`), not the week-scoped `weekData.notes`.
 * The tests below mock the `/week` and `/api/student-journal/notes` fetches
 * independently to prove a note outside the viewed week still surfaces, and
 * that a delete triggers a `NoteThreadPanel` reload rather than a local
 * splice. A third test covers the empty-week copy on both WeekGrid
 * instances (design-system: shared empty-state copy from Cycle C).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentJournalDetailPage from "../page";

/**
 * `use(params)` suspends on first render for a "cold" Promise — React only
 * reads a `use()`-d thenable synchronously once it carries a `status`/`value`
 * pair, which it normally attaches itself on a later tick. jsdom + this repo's
 * vitest/RTL combo never flushes that retry tick, so a plain
 * `Promise.resolve(...)` leaves the tree permanently suspended. Pre-attach the
 * fulfilled marker React itself would set, mirroring real behaviour (Next.js
 * pre-resolves route params before paint). Same workaround as
 * `app/admin/enrollments/[id]/__tests__/page.test.tsx`.
 */
function fulfilledParams(value: { id: string }): Promise<{ id: string }> {
  const p = Promise.resolve(value) as Promise<{ id: string }> & {
    status?: string;
    value?: { id: string };
  };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const DATES = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];

const SCHOOL_CATEGORY = {
  id: "cat-school-1",
  name: "Ibadah",
  scope: "SCHOOL",
  indicators: [{ id: "ind-school-1", label: "Sholat Dhuha", order: 1 }],
};

const HOME_CATEGORY = {
  id: "cat-home-1",
  name: "Kemandirian",
  scope: "HOME",
  indicators: [{ id: "ind-home-1", label: "Merapikan mainan", order: 1 }],
};

function weekPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      weekStart: "2026-08-03",
      dates: DATES,
      schoolCategories: [SCHOOL_CATEGORY],
      homeCategories: [HOME_CATEGORY],
      schoolEntries: [],
      homeEntries: [],
      ...overrides,
    },
  };
}

function threadNote(id: string, body: string, date: string) {
  return {
    id,
    date,
    authorRole: "TEACHER",
    authorName: "Ustadzah Sari",
    body,
    createdAt: `${date}T03:00:00.000Z`,
  };
}

function notesPayload(notes: unknown[], nextCursor: string | null = null, unreadCount = 0) {
  return { data: { notes, nextCursor, unreadCount } };
}

/**
 * Mocks the `/week` fetch and the `NoteThreadPanel`-owned
 * `/api/student-journal/notes` fetch independently, since they are now two
 * separate data sources for the same page (that separation is the whole
 * point of the fix this cycle makes).
 */
function buildFetchStub({
  week = weekPayload(),
  notes = notesPayload([]),
}: { week?: unknown; notes?: unknown } = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/week?weekStart=")) {
      return Promise.resolve({ ok: true, json: async () => week } as Response);
    }
    if (url.includes("/api/students/")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ name: "Aisyah Nuraini" }),
      } as Response);
    }
    if (url.includes("/api/student-journal/notes/read")) {
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }
    if (url.includes("/api/student-journal/admin/notes/")) {
      // Admin note delete (`DELETE /api/student-journal/admin/notes/[id]`).
      void init;
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }
    if (url.startsWith("/api/student-journal/notes")) {
      return Promise.resolve({ ok: true, json: async () => notes } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("StudentJournalDetailPage — student identity", () => {
  it("shows the student's full name from the raw student API response", async () => {
    vi.stubGlobal("fetch", buildFetchStub());

    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    expect(await screen.findByRole("heading", { name: "Aisyah Nuraini" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Detail Jurnal Siswa" })).not.toBeInTheDocument();
  });

  it("offers a link from the journal to the student's own page", async () => {
    vi.stubGlobal("fetch", buildFetchStub());

    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    expect(await screen.findByRole("link", { name: "Lihat profil siswa" })).toHaveAttribute(
      "href",
      "/admin/students/student-1",
    );
  });
});

describe("StudentJournalDetailPage — note delete confirm copy (AC5)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      buildFetchStub({ notes: notesPayload([threadNote("note-1", "Ananda semangat belajar hari ini.", "2026-08-05")]) }),
    );
  });

  it("labels the soft-delete confirmation 'Nonaktifkan', never 'Hapus'", async () => {
    const user = userEvent.setup();
    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    await user.click(await screen.findByRole("tab", { name: "Catatan" }));
    await user.click(await screen.findByRole("button", { name: "Hapus catatan" }));

    expect(await screen.findByText("Nonaktifkan catatan?")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ya, Nonaktifkan" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hapus catatan?")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ya, Hapus" }),
    ).not.toBeInTheDocument();
  });
});

describe("StudentJournalDetailPage — Catatan tab reads the full thread", () => {
  it("renders a note outside the viewed week's payload, from NoteThreadPanel's own fetch", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      buildFetchStub({
        // The /week payload carries no notes at all for the viewed week.
        week: weekPayload(),
        // But the thread fetch returns a note from 3+ weeks earlier.
        notes: notesPayload([
          threadNote("old-note", "Catatan lama dari tiga minggu lalu.", "2026-07-13"),
        ]),
      }),
    );

    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    await user.click(await screen.findByRole("tab", { name: "Catatan" }));

    expect(
      await screen.findByText("Catatan lama dari tiga minggu lalu."),
    ).toBeInTheDocument();
  });

  it("calls the admin delete endpoint and reloads the thread on confirm", async () => {
    const user = userEvent.setup();
    const fetchMock = buildFetchStub({
      notes: notesPayload([threadNote("note-1", "Catatan yang akan dihapus.", "2026-08-05")]),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    await user.click(await screen.findByRole("tab", { name: "Catatan" }));
    await screen.findByText("Catatan yang akan dihapus.");

    const notesGetCallCountBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/student-journal/notes?"),
    ).length;

    await user.click(await screen.findByRole("button", { name: "Hapus catatan" }));
    await user.click(await screen.findByRole("button", { name: "Ya, Nonaktifkan" }));

    // The admin delete endpoint is called.
    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/api/student-journal/admin/notes/note-1") &&
          (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCall).toBeTruthy();
    });

    // The confirm dialog closes.
    await waitFor(() => {
      expect(screen.queryByText("Nonaktifkan catatan?")).not.toBeInTheDocument();
    });

    // The thread reloads — a second GET to the notes endpoint fires (reloadToken bump).
    await waitFor(() => {
      const notesGetCallCountAfter = fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/student-journal/notes?"),
      ).length;
      expect(notesGetCallCountAfter).toBeGreaterThan(notesGetCallCountBefore);
    });
  });
});

describe("StudentJournalDetailPage — empty-week copy", () => {
  it("shows 'Belum ada centang di pekan ini.' on both the school and home grids when no ticks exist", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      buildFetchStub({
        week: weekPayload({ schoolEntries: [], homeEntries: [] }),
      }),
    );

    render(
      <StudentJournalDetailPage params={fulfilledParams({ id: "student-1" })} />,
    );

    // Sekolah tab is the default.
    expect(
      await screen.findByText("Belum ada centang di pekan ini."),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: "Rumah" }));
    expect(
      await screen.findByText("Belum ada centang di pekan ini."),
    ).toBeInTheDocument();
  });
});
