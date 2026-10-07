import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NoteComposeDialog } from "@/components/student-journal/note-compose-dialog";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const WEEK = ["2026-09-28", "2026-09-29"];

function setup(props: Partial<React.ComponentProps<typeof NoteComposeDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <NoteComposeDialog
      open
      onOpenChange={onOpenChange}
      mode="create"
      studentId="stu-1"
      weekDates={WEEK}
      initialDate="2026-09-29"
      onSaved={onSaved}
      {...props}
    />,
  );
  return { onOpenChange, onSaved };
}

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("Isi catatan"), { target: { value: text } });

describe("NoteComposeDialog discard guard (TCH-3)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes straight away when nothing was typed", () => {
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Buang catatan?")).toBeNull();
  });

  it("asks before dropping a typed draft, and keeps the text when the teacher continues", async () => {
    const { onOpenChange } = setup();
    type("Ananda hari ini sangat semangat");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));

    expect(await screen.findByText("Buang catatan?")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Lanjut menulis" }));
    await waitFor(() => expect(screen.queryByText("Buang catatan?")).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Isi catatan")).toHaveValue("Ananda hari ini sangat semangat");
  });

  it("closes only after an explicit Buang", async () => {
    const { onOpenChange } = setup();
    type("draft");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Buang" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("guards the Escape / outside-tap path too (they go through the same onOpenChange)", async () => {
    const { onOpenChange } = setup();
    type("draft");
    fireEvent.keyDown(screen.getByLabelText("Isi catatan"), { key: "Escape" });
    expect(await screen.findByText("Buang catatan?")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks inside the composer: no second overlay is stacked on top (ui.md one overlay at a time)", async () => {
    const { onOpenChange } = setup();
    // Let the dialog finish opening first, as a person would. base-ui moves
    // focus to the first field one microtask + one animation frame after open;
    // interacting before that lets its queued focus land after ours (CI flake
    // on #581, reproduced with rAF = setTimeout 0).
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    type("draft");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));

    expect(await screen.findByText("Buang catatan?")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByLabelText("Isi catatan")).toHaveValue("draft");
    expect(screen.queryByRole("button", { name: "Simpan" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Lanjut menulis" })).toHaveFocus());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("Escape while the question is showing means keep writing, not discard", async () => {
    const { onOpenChange } = setup();
    type("draft");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await screen.findByText("Buang catatan?");
    fireEvent.keyDown(screen.getByLabelText("Isi catatan"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Buang catatan?")).toBeNull());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Isi catatan")).toHaveValue("draft");
  });

  it("does not treat an untouched edit as a draft, but does treat a changed one as one", async () => {
    const { onOpenChange } = setup({ mode: "edit", noteId: "n1", initialBody: "Catatan lama" });
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    type("Catatan lama diubah");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(await screen.findByText("Buang catatan?")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not ask after a successful save", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { onOpenChange, onSaved } = setup();
    type("Alhamdulillah");
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Buang catatan?")).toBeNull();
  });
});

describe("NoteComposeDialog length cap (TCHX-16)", () => {
  it("tells the teacher when a paste was cut to 2000 characters", () => {
    setup();
    type("a".repeat(2580));

    expect(screen.getByLabelText("Isi catatan")).toHaveValue("a".repeat(2000));
    expect(screen.getByText("2000/2000")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Catatan dipotong ke 2000 karakter.");
  });

  it("does not warn for text within the limit, and clears the warning once it is edited down", () => {
    setup();
    type("a".repeat(2000));
    expect(screen.queryByText("Catatan dipotong ke 2000 karakter.")).toBeNull();

    type("a".repeat(2500));
    expect(screen.getByText("Catatan dipotong ke 2000 karakter.")).toBeInTheDocument();

    type("a".repeat(1990));
    expect(screen.queryByText("Catatan dipotong ke 2000 karakter.")).toBeNull();
  });

  it("caps the textarea height so the counter stays visible", () => {
    setup();
    const box = screen.getByLabelText("Isi catatan");
    expect(box).toHaveClass("max-h-48");
    expect(box).toHaveClass("overflow-y-auto");
    // A long unbroken string wraps in the box rather than widening the dialog (PARX-3).
    expect(box).toHaveClass("min-w-0");
    expect(box.className).toContain("[overflow-wrap:anywhere]");
  });
});
