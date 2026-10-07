import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoteThread } from "../note-thread";

const baseNote = {
  id: "note-1",
  date: "2026-06-25",
  authorRole: "TEACHER",
  authorUserId: "teacher-1",
  body: "Anak aktif hari ini.",
  createdAt: "2026-06-25T07:30:00.000Z",
};

describe("NoteThread", () => {
  it("renders the author name and derived initials when authorName is present", () => {
    render(<NoteThread notes={[{ ...baseNote, authorName: "Bu Sari" }]} />);

    expect(screen.getByText("Bu Sari")).toBeInTheDocument();
    expect(screen.getByText("BS")).toBeInTheDocument();
    // Role badge is still rendered alongside the name.
    expect(screen.getByText("Guru")).toBeInTheDocument();
  });

  it("falls back to the role label (and its initial) when authorName is missing", () => {
    render(<NoteThread notes={[{ ...baseNote, authorName: undefined }]} />);

    // Role label appears twice: once as the author-name fallback text, once as the Badge.
    expect(screen.getAllByText("Guru")).toHaveLength(2);
    expect(screen.getByText("G")).toBeInTheDocument();
  });

  it("renders the created timestamp (time part) alongside the short date", () => {
    render(<NoteThread notes={[{ ...baseNote, authorName: "Bu Sari" }]} />);

    // formatTime renders "HH:mm" in 24h Indonesian locale for the UTC ISO above.
    // We only assert the date+time separator text is present rather than pin
    // an exact wall-clock string (which is TZ-dependent in CI).
    const dateNode = screen.getByText((content) => content.includes("2026") && content.includes("·"));
    expect(dateNode).toBeInTheDocument();
  });

  it("renders delete-only actions when onDelete is passed without onEdit", () => {
    render(
      <NoteThread
        notes={[{ ...baseNote, authorName: "Bu Sari" }]}
        canEdit={() => true}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByLabelText("Hapus catatan")).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit catatan")).not.toBeInTheDocument();
  });

  it("renders the shared EmptyState (not a bare paragraph) when there are no notes", () => {
    render(<NoteThread notes={[]} />);

    // Title + description come from EmptyState, not a hand-rolled <p>.
    expect(screen.getByText("Belum ada catatan")).toBeInTheDocument();
    expect(
      screen.getByText("Catatan dari guru akan tampil di sini setelah dituliskan."),
    ).toBeInTheDocument();
  });

  it("addresses the reader in the empty state — a guru is not told to wait for a guru", () => {
    const { unmount } = render(<NoteThread notes={[]} audience="teacher" />);
    expect(
      screen.getByText("Belum ada catatan di pekan ini. Tulis catatan pertama untuk wali murid."),
    ).toBeInTheDocument();
    unmount();

    render(<NoteThread notes={[]} audience="parent" />);
    // Was "Belum ada catatan. Tulis catatan pertama…" directly under a
    // "Belum ada catatan" title — the same sentence twice.
    expect(
      screen.getByText("Tulis catatan pertama, atau tunggu catatan dari Ustadzah."),
    ).toBeInTheDocument();
  });

  it("names a seeded author once, not name-plus-English-role beside the badge", () => {
    render(<NoteThread notes={[{ ...baseNote, authorName: "Ismail Rabbani (Teacher)" }]} />);

    expect(screen.getByText("Ismail Rabbani")).toBeInTheDocument();
    expect(screen.queryByText("Ismail Rabbani (Teacher)")).toBeNull();
    // Initials follow the cleaned name rather than picking up the role word.
    expect(screen.getByText("IR")).toBeInTheDocument();
    expect(screen.getByText("Guru")).toBeInTheDocument();
  });

  it("wraps an unbroken string inside the card instead of widening the page (PARX-3)", () => {
    render(<NoteThread notes={[{ ...baseNote, body: "x".repeat(2000), authorName: "Bu Sari" }]} />);

    const body = screen.getByText("x".repeat(2000));
    expect(body.className).toContain("[overflow-wrap:anywhere]");
    expect(body).toHaveClass("break-words", "min-w-0", "whitespace-pre-wrap");
    expect(body.parentElement).toHaveClass("min-w-0");
  });

  it("gives the Edit and Hapus icon buttons a 44px tap area (PAR-14)", () => {
    render(
      <NoteThread
        notes={[{ ...baseNote, authorName: "Bu Sari" }]}
        canEdit={() => true}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    for (const name of ["Edit catatan", "Hapus catatan"]) {
      const btn = screen.getByLabelText(name);
      // 28px button + 8px invisible halo top and bottom = 44px.
      expect(btn).toHaveClass("relative", "before:absolute", "before:-inset-y-2");
    }
  });
});
