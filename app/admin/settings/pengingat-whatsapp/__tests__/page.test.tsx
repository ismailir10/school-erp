import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import { DEFAULT_REMINDER_TEMPLATE } from "@/lib/finance/reminder-template";
import ReminderTemplatePage from "../page";

type Opts = { get?: { ok: boolean; status?: number; body?: unknown }; put?: { ok: boolean; status: number; body: unknown } };

function fixture({ get, put }: Opts = {}) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const r = put ?? { ok: true, status: 200, body: { template: JSON.parse(String(init.body)).template } };
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    const g = get ?? { ok: true, body: { template: DEFAULT_REMINDER_TEMPLATE, isDefault: true, defaultTemplate: DEFAULT_REMINDER_TEMPLATE } };
    return { ok: g.ok, status: g.status ?? (g.ok ? 200 : 500), json: async () => g.body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const putCall = (m: ReturnType<typeof fixture>) => m.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");

async function open() {
  const user = userEvent.setup();
  render(<ReminderTemplatePage />);
  const area = (await screen.findByRole("textbox", { name: "Isi pesan" })) as HTMLTextAreaElement;
  return { user, area };
}
const preview = () => screen.getByLabelText("Pratinjau pesan");

describe("ReminderTemplatePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows the current message and a chat preview filled with sample data, no raw {isian}", async () => {
    fixture();
    const { area } = await open();
    expect(area.value).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(preview()).toHaveTextContent("Assalamu'alaikum Bapak/Ibu Budi.");
    expect(preview()).toHaveTextContent("ananda Aisyah (INV-2610-0001) masih tersisa Rp");
    expect(preview().textContent).not.toMatch(/\{\w+\}/);
    expect(screen.getByRole("button", { name: "Simpan" })).toBeDisabled();
  });

  it("updates the preview as the admin types", async () => {
    fixture();
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Halo {wali}, {siswa} belum bayar. {tautan}");
    expect(preview()).toHaveTextContent("Halo Bapak/Ibu Budi, Aisyah belum bayar. https://bayar.example/abc123");
  });

  it("inserts a placeholder chip at the cursor", async () => {
    fixture();
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Halo  , {tautan}");
    area.setSelectionRange(5, 5);
    await user.click(within(screen.getByRole("group", { name: "Sisipkan isian" })).getByRole("button", { name: "Nama anak" }));
    expect(area.value).toBe("Halo {siswa} , {tautan}");
  });

  it("refuses an unknown placeholder, naming it, and does not send", async () => {
    const fetchMock = fixture();
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Sisa {sisaa} {tautan}");
    expect(await screen.findByRole("alert")).toHaveTextContent("{sisaa}");
    expect(screen.getByRole("button", { name: "Simpan" })).toBeDisabled();
    expect(putCall(fetchMock)).toBeUndefined();
  });

  it("refuses a message without {tautan}", async () => {
    fixture();
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Halo {wali}");
    expect(await screen.findByRole("alert")).toHaveTextContent("{tautan}");
    expect(screen.getByRole("button", { name: "Simpan" })).toBeDisabled();
  });

  it("saves the edited text and confirms", async () => {
    const fetchMock = fixture();
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Halo {wali}, bayar di {tautan}");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Templat pesan disimpan."));
    expect(JSON.parse(String((putCall(fetchMock)![1] as RequestInit).body))).toEqual({ template: "Halo {wali}, bayar di {tautan}" });
    expect(screen.getByRole("button", { name: "Simpan" })).toBeDisabled();
  });

  it("shows the server's reason when saving fails", async () => {
    fixture({ put: { ok: false, status: 400, body: { error: "Pesan terlalu panjang" } } });
    const { user, area } = await open();
    await user.clear(area);
    await user.click(area);
    await user.paste("Halo {tautan}");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("'Kembalikan ke bawaan' puts the built-in text back, ready to save", async () => {
    fixture({ get: { ok: true, body: { template: "Halo {tautan}", isDefault: false, defaultTemplate: DEFAULT_REMINDER_TEMPLATE } } });
    const { user, area } = await open();
    expect(area.value).toBe("Halo {tautan}");
    await user.click(screen.getByRole("button", { name: "Kembalikan ke bawaan" }));
    expect(area.value).toBe(DEFAULT_REMINDER_TEMPLATE);
    expect(screen.getByRole("button", { name: "Simpan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Kembalikan ke bawaan" })).toBeDisabled();
  });

  it("says so, with no editor, when the GET is forbidden", async () => {
    fixture({ get: { ok: false, status: 403, body: { error: "Forbidden" } } });
    render(<ReminderTemplatePage />);
    expect(await screen.findByText("Anda tidak memiliki akses ke pengaturan ini.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    fixture({ get: { ok: false, status: 500, body: {} } });
    render(<ReminderTemplatePage />);
    expect(await screen.findByText("Gagal memuat templat pesan.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });
});
