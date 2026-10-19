/**
 * "Tautkan anak": picks an active student and a relationship, then posts the
 * existing link branch of POST /api/students/[id]/guardians for this wali.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { LinkStudentDialog } from "../link-student-dialog";

const STUDENT = { id: "stu-1", name: "Ahmad Fauzi", nickname: null, nis: "12345" };

function stubFetch(postResponse: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.startsWith("/api/students?")) {
      return { ok: true, status: 200, json: async () => ({ data: [STUDENT], pagination: { total: 1 } }) };
    }
    if (init?.method === "POST") {
      const { status, body } = postResponse;
      const res = { ok: status >= 200 && status < 300, status, json: async () => body };
      return { ...res, clone: () => res };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

async function pickStudent(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("combobox")[0]!);
  await user.type(await screen.findByPlaceholderText("Cari nama siswa..."), "Ahmad");
  await user.click(await screen.findByRole("option", { name: new RegExp(STUDENT.name) }));
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const onLinked = vi.fn();
  render(<LinkStudentDialog parentId="p1" open onOpenChange={onOpenChange} onLinked={onLinked} />);
  return { onOpenChange, onLinked };
}

describe("LinkStudentDialog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens with a student picker and a relationship defaulting to Wali", () => {
    stubFetch({ status: 201, body: {} });
    renderDialog();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Tautkan anak");
    expect(within(dialog).getByText("Siswa")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[1]).toHaveTextContent("Wali");
  });

  it("asks for a student and sends nothing when submitted empty", async () => {
    const fetchMock = stubFetch({ status: 201, body: {} });
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Tautkan anak" }));

    expect(await screen.findByText("Pilih siswa terlebih dahulu")).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("posts parentId and relationship to the student's guardians route, then closes and refreshes", async () => {
    const fetchMock = stubFetch({ status: 201, body: { id: "sg-9" } });
    const user = userEvent.setup();
    const { onOpenChange, onLinked } = renderDialog();

    await pickStudent(user);
    await user.click(screen.getAllByRole("combobox")[1]!);
    await user.click(await screen.findByRole("option", { name: "Ibu" }));
    await user.click(screen.getByRole("button", { name: "Tautkan anak" }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [url, init] = posts(fetchMock)[0];
    expect(url).toBe("/api/students/stu-1/guardians");
    // No isPrimary: the route decides primacy.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ parentId: "p1", relationship: "IBU" });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Anak ditautkan"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message on the student field when the link already exists", async () => {
    stubFetch({
      status: 409,
      body: { error: "Wali ini sudah tertaut ke siswa tersebut.", code: "GUARDIAN_LINK_EXISTS" },
    });
    const user = userEvent.setup();
    const { onOpenChange, onLinked } = renderDialog();

    await pickStudent(user);
    await user.click(screen.getByRole("button", { name: "Tautkan anak" }));

    const message = await screen.findByText("Wali ini sudah tertaut ke siswa tersebut.");
    expect(message).toBeInTheDocument();
    // On the field (FieldError), not a banner or a toast.
    expect(message.closest('[role="alert"]')).not.toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("reports any other failure in the form and keeps the dialog open", async () => {
    stubFetch({ status: 500, body: { error: "Internal Server Error" } });
    const user = userEvent.setup();
    const { onLinked } = renderDialog();

    await pickStudent(user);
    await user.click(screen.getByRole("button", { name: "Tautkan anak" }));

    expect(await screen.findByText("Terjadi kendala di server. Coba lagi sebentar lagi.")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
    expect(onLinked).not.toHaveBeenCalled();
  });
});
