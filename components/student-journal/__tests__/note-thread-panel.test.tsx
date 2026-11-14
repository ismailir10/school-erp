import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NoteThreadPanel } from "@/components/student-journal/note-thread-panel";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function note(id: string, body: string) {
  return {
    id,
    date: "2026-07-14",
    authorRole: "TEACHER",
    authorUserId: "teacher-1",
    authorName: "Bu Sari",
    body,
    createdAt: "2026-07-14T01:00:00.000Z",
  };
}

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

describe("NoteThreadPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the thread and marks it read once on arrival", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url.startsWith("/api/student-journal/notes/read")) return jsonOk({ lastReadAt: "x" });
      return jsonOk({ notes: [note("n1", "Alhamdulillah lancar")], nextCursor: null, unreadCount: 2 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onUnreadChange = vi.fn();

    render(
      <NoteThreadPanel studentId="stu-1" audience="teacher" onUnreadChange={onUnreadChange} />,
    );

    expect(await screen.findByText("Alhamdulillah lancar")).toBeInTheDocument();
    await waitFor(() => expect(onUnreadChange).toHaveBeenCalledWith(2));

    const readCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/student-journal/notes/read"),
    );
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0][1]).toMatchObject({ method: "POST" });
  });

  it("does not mark read when the caller says the surface is not open", async () => {
    const fetchMock = vi.fn((url: string) => {
      void url;
      return jsonOk({ notes: [note("n1", "catatan")], nextCursor: null, unreadCount: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NoteThreadPanel studentId="stu-1" audience="parent" markReadOnOpen={false} />);
    await screen.findByText("catatan");

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("/api/student-journal/notes/read"),
      ),
    ).toBe(false);
  });

  it("appends the next page from the cursor instead of replacing the list", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url.startsWith("/api/student-journal/notes/read")) return jsonOk({ lastReadAt: "x" });
      if (url.includes("cursor=n1")) {
        return jsonOk({ notes: [note("n2", "catatan lama")], nextCursor: null });
      }
      return jsonOk({ notes: [note("n1", "catatan baru")], nextCursor: "n1", unreadCount: 0 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<NoteThreadPanel studentId="stu-1" audience="parent" />);
    await screen.findByText("catatan baru");

    fireEvent.click(screen.getByRole("button", { name: "Muat catatan lama" }));

    expect(await screen.findByText("catatan lama")).toBeInTheDocument();
    // The first page is still on screen — this is a thread, not a swap.
    expect(screen.getByText("catatan baru")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Muat catatan lama" })).toBeNull();
  });

  it("offers a retry instead of an empty thread when the fetch fails", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/student-journal/notes/read")) return jsonOk({ lastReadAt: "x" });
        return ++calls === 1
          ? Promise.resolve({ ok: false, json: async () => ({}) })
          : jsonOk({ notes: [note("n1", "pulih")], nextCursor: null, unreadCount: 0 });
      }),
    );

    render(<NoteThreadPanel studentId="stu-1" audience="teacher" />);

    expect(await screen.findByText("Catatan belum bisa dimuat.")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/notes/read"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("pulih")).toBeInTheDocument();
  });
});
