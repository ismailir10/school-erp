/**
 * ReminderQueueDialog (cycle 2026-10-17-payment-link-reminders, T8): the WhatsApp
 * reminder queue opened from the invoice list. The row action is a real wa.me
 * anchor that stamps the reminder with a keepalive POST and never prevents the
 * navigation; a row without a link offers "Buat link dulu".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { ReminderQueueDialog } from "../reminder-queue-dialog";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

type Row = {
  id: string;
  invoiceNumber: string;
  periodLabel: string;
  dueDate: string;
  status: string;
  totalDue: number;
  totalPaid: number;
  remaining: number;
  studentName: string;
  guardianName: string | null;
  hasLink: boolean;
  waUrl: string | null;
  lastRemindedAt: string | null;
  lastRemindedByName: string | null;
  remindCount: number;
};

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    periodLabel: "September 2026",
    dueDate: "2026-09-30",
    status: "SENT",
    totalDue: 500000,
    totalPaid: 0,
    remaining: 500000,
    studentName: `Siswa ${id}`,
    guardianName: `Wali ${id}`,
    hasLink: true,
    waUrl: `https://wa.me/62812000${id}?text=halo`,
    lastRemindedAt: null,
    lastRemindedByName: null,
    remindCount: 0,
    ...over,
  };
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body }) as Response;

function page(data: Row[], over: { page?: number; totalPages?: number; total?: number; excludedNoNumber?: number; truncated?: boolean } = {}) {
  return {
    data,
    pagination: { page: over.page ?? 1, pageSize: 50, total: over.total ?? data.length, totalPages: over.totalPages ?? 1 },
    meta: { excludedNoNumber: over.excludedNoNumber ?? 0, truncated: over.truncated ?? false },
  };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: ReturnType<typeof stubFetch>, part: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

function renderQueue(props: { create?: boolean } = {}) {
  return render(
    <ReminderQueueDialog open onOpenChange={() => {}} capabilities={{ create: props.create ?? true }} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ReminderQueueDialog", () => {
  it("fetches page 1 at 50 per page and renders the rows in the order given", async () => {
    const fetchMock = stubFetch(() =>
      ok(page([row("B", { studentName: "Budi", remaining: 250000 }), row("A", { studentName: "Aisyah" })])),
    );
    renderQueue();

    const dialog = await screen.findByRole("dialog", { name: "Pengingat WhatsApp" });
    expect(within(dialog).getByText(/Satu ketukan per keluarga/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/invoices/reminders")[0]![0]).toBe("/api/invoices/reminders?page=1&pageSize=50");

    const items = await within(dialog).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Budi");
    expect(items[0]).toHaveTextContent("Wali B");
    expect(items[0]).toHaveTextContent("Link Dibuat");
    expect(items[0]).toHaveTextContent("Belum diingatkan");
    expect(items[0]!.textContent).toMatch(/Sisa\s*Rp\s*250\.000/);
    expect(items[1]).toHaveTextContent("Aisyah");
  });

  it("shows a skeleton while loading", async () => {
    stubFetch(() => new Promise<Response>(() => {}) as unknown as Response);
    renderQueue();
    expect(await screen.findByText("Memuat daftar pengingat")).toBeInTheDocument();
  });

  it("says so, with a retry, when the list cannot be loaded", async () => {
    let calls = 0;
    stubFetch(() => (++calls === 1 ? fail(500, { error: "boom" }) : ok(page([row("A")]))));
    renderQueue();

    expect(await screen.findByText("Daftar pengingat belum dapat dimuat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Siswa A")).toBeInTheDocument();
  });

  it("Buka WhatsApp is a new-tab link to the row's wa.me URL, named for the wali and student", async () => {
    stubFetch(() => ok(page([row("A", { studentName: "Aisyah", guardianName: "Siti" })])));
    renderQueue();

    const link = await screen.findByRole("link", { name: /Buka WhatsApp untuk Siti, tagihan Aisyah/ });
    expect(link).toHaveAttribute("href", "https://wa.me/62812000A?text=halo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link).toHaveTextContent("Buka WhatsApp");
  });

  it("tapping it fires a keepalive stamp POST without preventing the navigation, and the row reads 'Diingatkan baru saja'", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/invoices/A/reminder" && init?.method === "POST") {
        return ok({ lastRemindedAt: new Date().toISOString(), remindCount: 1, waUrl: "https://wa.me/x" });
      }
      return ok(page([row("A")]));
    });
    renderQueue();

    const link = await screen.findByRole("link", { name: /Buka WhatsApp/ });
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.click(link)).toBe(true);

    expect(await screen.findByText("Diingatkan baru saja · oleh Anda")).toBeInTheDocument();
    const stamps = callsTo(fetchMock, "/api/invoices/A/reminder");
    expect(stamps).toHaveLength(1);
    expect(stamps[0]![1]).toMatchObject({ method: "POST", keepalive: true });
  });

  it("announces a recorded reminder through one status region, not per row", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/reminder") && init?.method === "POST") {
        return ok({ lastRemindedAt: new Date().toISOString(), remindCount: 1 });
      }
      return ok(page([row("A"), row("B")]));
    });
    renderQueue();

    fireEvent.click((await screen.findAllByRole("link", { name: /Buka WhatsApp/ }))[0]!);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Pengingat untuk Siswa A tercatat."));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelector("[aria-live]")).toBeNull();
  });

  it("a second tap while the stamp is in flight opens the link again but does not POST twice", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/invoices/A/reminder" && init?.method === "POST") {
        return ok({ lastRemindedAt: new Date().toISOString(), remindCount: 1 });
      }
      return ok(page([row("A")]));
    });
    renderQueue();

    const link = await screen.findByRole("link", { name: /Buka WhatsApp/ });
    expect(fireEvent.click(link)).toBe(true);
    expect(fireEvent.click(link)).toBe(true);

    expect(await screen.findByText("Diingatkan baru saja · oleh Anda")).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/invoices/A/reminder")).toHaveLength(1);

    // Once it has settled a later tap is a new reminder.
    fireEvent.click(link);
    await waitFor(() => expect(callsTo(fetchMock, "/api/invoices/A/reminder")).toHaveLength(2));
  });

  it("toasts the server's message when the stamp is refused (429) and leaves the row as it was", async () => {
    stubFetch((url, init) => {
      if (url.endsWith("/reminder") && init?.method === "POST") return fail(429, { error: "Terlalu banyak permintaan" });
      return ok(page([row("A")]));
    });
    renderQueue();

    fireEvent.click(await screen.findByRole("link", { name: /Buka WhatsApp/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan"));
    expect(screen.getByText("Belum diingatkan")).toBeInTheDocument();
  });

  it("shows who reminded an invoice and how long ago", async () => {
    stubFetch(() =>
      ok(page([row("A", { lastRemindedAt: ago(3 * 24 * 3600 * 1000), lastRemindedByName: "Bu Nur", remindCount: 2 })])),
    );
    renderQueue();
    expect(await screen.findByText("Diingatkan 3 hari lalu · oleh Bu Nur")).toBeInTheDocument();
  });

  describe("a row without a link", () => {
    const noLink = row("A", { hasLink: false, waUrl: null });

    it("with the create capability offers 'Buat link dulu', POSTs replace-payment-link, then refetches so it becomes Buka WhatsApp", async () => {
      let created = false;
      const fetchMock = stubFetch((url, init) => {
        if (url === "/api/invoices/A/replace-payment-link" && init?.method === "POST") {
          created = true;
          return ok({ outcome: "REPLACED", url: "https://pay.example/new", created: true });
        }
        return ok(page([created ? row("A") : noLink]));
      });
      const user = userEvent.setup();
      renderQueue();

      expect(screen.queryByRole("link", { name: /Buka WhatsApp/ })).not.toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      expect(await screen.findByRole("link", { name: /Buka WhatsApp/ })).toHaveAttribute("href", "https://wa.me/62812000A?text=halo");
      expect(callsTo(fetchMock, "/replace-payment-link")).toHaveLength(1);
      expect(callsTo(fetchMock, "/api/invoices/reminders").length).toBeGreaterThanOrEqual(2);
    });

    it("announces the new link and moves focus to that row's Buka WhatsApp", async () => {
      let created = false;
      stubFetch((url, init) => {
        if (url === "/api/invoices/A/replace-payment-link" && init?.method === "POST") {
          created = true;
          return ok({ outcome: "REPLACED", url: "https://pay.example/new", created: true });
        }
        return ok(page([created ? row("A") : noLink, row("B")]));
      });
      const user = userEvent.setup();
      renderQueue();

      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      const link = await screen.findByRole("link", { name: /Buka WhatsApp untuk Wali A/ });
      await waitFor(() => expect(link).toHaveFocus());
      expect(screen.getByRole("status")).toHaveTextContent("Link untuk Siswa A siap.");
    });

    it("after a PAID removal focus moves to the next row's action", async () => {
      stubFetch((url, init) => {
        if (url.endsWith("/replace-payment-link") && init?.method === "POST") {
          return ok({ outcome: "PAID", message: "Lunas" });
        }
        return ok(page([noLink, row("B")]));
      });
      const user = userEvent.setup();
      renderQueue();

      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      await waitFor(() => expect(screen.getByRole("link", { name: /Buka WhatsApp untuk Wali B/ })).toHaveFocus());
    });

    it("after removing the last row focus moves to the dialog heading", async () => {
      stubFetch((url, init) => {
        if (url.endsWith("/replace-payment-link") && init?.method === "POST") {
          return ok({ outcome: "PAID", message: "Lunas" });
        }
        return ok(page([noLink]));
      });
      const user = userEvent.setup();
      renderQueue();

      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      const dialog = screen.getByRole("dialog", { name: "Pengingat WhatsApp" });
      await waitFor(() => expect(within(dialog).getByText("Pengingat WhatsApp", { selector: "span" })).toHaveFocus());
    });

    it("drops the row and toasts the message when the invoice turns out to be paid", async () => {
      stubFetch((url, init) => {
        if (url.endsWith("/replace-payment-link") && init?.method === "POST") {
          return ok({ outcome: "PAID", message: "Pembayaran ditemukan — tagihan ditandai lunas." });
        }
        return ok(page([noLink, row("B")]));
      });
      const user = userEvent.setup();
      renderQueue();

      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Pembayaran ditemukan — tagihan ditandai lunas."));
      expect(screen.queryByText("Siswa A")).not.toBeInTheDocument();
      expect(screen.getByText("Siswa B")).toBeInTheDocument();
    });

    it("toasts the server's error and keeps the row", async () => {
      stubFetch((url, init) => {
        if (url.endsWith("/replace-payment-link") && init?.method === "POST") {
          return fail(429, { error: "Terlalu banyak permintaan" });
        }
        return ok(page([noLink]));
      });
      const user = userEvent.setup();
      renderQueue();

      await user.click(await screen.findByRole("button", { name: "Buat link dulu" }));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Terlalu banyak permintaan"));
      expect(screen.getByRole("button", { name: "Buat link dulu" })).toBeEnabled();
    });

    it("without the create capability says who to ask instead of offering a button", async () => {
      stubFetch(() => ok(page([noLink])));
      renderQueue({ create: false });

      expect(await screen.findByText("Belum ada link — minta admin tagihan membuatnya.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Buat link dulu" })).not.toBeInTheDocument();
    });
  });

  it("notes how many unpaid invoices are left out for having no WhatsApp number", async () => {
    stubFetch(() => ok(page([row("A")], { excludedNoNumber: 3 })));
    renderQueue();
    expect(
      await screen.findByText("3 tagihan belum lunas tanpa nomor WhatsApp wali — lengkapi di data wali."),
    ).toBeInTheDocument();
  });

  it("says when the list is cut at the first 2000", async () => {
    stubFetch(() => ok(page([row("A")], { truncated: true })));
    renderQueue();
    expect(await screen.findByText("Daftar menampilkan 2000 tagihan pertama.")).toBeInTheDocument();
  });

  it("has no notes when nothing is left out", async () => {
    stubFetch(() => ok(page([row("A")])));
    renderQueue();
    await screen.findByText("Siswa A");
    expect(screen.queryByText(/tanpa nomor WhatsApp wali/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tagihan pertama/)).not.toBeInTheDocument();
  });

  it("empty queue shows the purpose-written empty state", async () => {
    stubFetch(() => ok(page([], { excludedNoNumber: 2 })));
    renderQueue();
    expect(await screen.findByText("Tidak ada tagihan belum lunas yang bisa diingatkan")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/2 tagihan belum lunas tanpa nomor/)).toBeInTheDocument();
  });

  it("tells the admin when every invoice in the list was already reminded today", async () => {
    stubFetch(() =>
      ok(page([row("A", { lastRemindedAt: ago(60_000) }), row("B", { lastRemindedAt: ago(120_000) })])),
    );
    renderQueue();
    expect(await screen.findByText("Semua tagihan di daftar ini sudah diingatkan hari ini.")).toBeInTheDocument();
  });

  it("does not claim that while more pages are still to load", async () => {
    stubFetch(() => ok(page([row("A", { lastRemindedAt: ago(60_000) })], { totalPages: 2, total: 2 })));
    renderQueue();
    await screen.findByText("Siswa A");
    expect(screen.queryByText("Semua tagihan di daftar ini sudah diingatkan hari ini.")).not.toBeInTheDocument();
  });

  it("shows the size of the queue", async () => {
    stubFetch(() => ok(page([row("A"), row("B")], { totalPages: 2, total: 73 })));
    renderQueue();
    expect(await screen.findByText("73 tagihan di antrean")).toBeInTheDocument();
  });

  it("treats a URL that is not wa.me as no link", async () => {
    stubFetch(() => ok(page([row("A", { waUrl: "https://evil.example/62812?text=halo" })])));
    renderQueue();
    expect(await screen.findByRole("button", { name: "Buat link dulu" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Buka WhatsApp/ })).not.toBeInTheDocument();
  });

  it("does not claim that when someone is still waiting", async () => {
    stubFetch(() => ok(page([row("A", { lastRemindedAt: ago(60_000) }), row("B")])));
    renderQueue();
    await screen.findByText("Siswa B");
    expect(screen.queryByText("Semua tagihan di daftar ini sudah diingatkan hari ini.")).not.toBeInTheDocument();
  });

  it("'Muat lebih banyak' appends the next page and disappears on the last one", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("page=2")
        ? ok(page([row("C")], { page: 2, totalPages: 2, total: 3 }))
        : ok(page([row("A"), row("B")], { page: 1, totalPages: 2, total: 3 })),
    );
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByRole("button", { name: "Muat lebih banyak" }));

    expect(await screen.findByText("Siswa C")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.match(/Siswa [ABC]/)?.[0])).toEqual([
      "Siswa A",
      "Siswa B",
      "Siswa C",
    ]);
    expect(callsTo(fetchMock, "page=2")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Muat lebih banyak" })).not.toBeInTheDocument();
  });

  it("'Muat lebih banyak' after a stamp re-reads pages 1..n+1 so the row that shifted across the boundary still appears", async () => {
    let stamped = false;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/invoices/A/reminder" && init?.method === "POST") {
        stamped = true;
        return ok({ lastRemindedAt: new Date().toISOString(), remindCount: 1 });
      }
      // The server sends reminded rows last: stamping A moves it from page 1 to page 2,
      // so C slides onto page 1 and page 2 alone would hide it.
      const reminded = row("A", { lastRemindedAt: new Date().toISOString(), lastRemindedByName: "Bu Nur", remindCount: 1 });
      if (!stamped) {
        return url.includes("page=2")
          ? ok(page([row("C")], { page: 2, totalPages: 2, total: 3 }))
          : ok(page([row("A"), row("B")], { page: 1, totalPages: 2, total: 3 }));
      }
      return url.includes("page=2")
        ? ok(page([reminded], { page: 2, totalPages: 2, total: 3 }))
        : ok(page([row("B"), row("C")], { page: 1, totalPages: 2, total: 3 }));
    });
    const user = userEvent.setup();
    renderQueue();

    fireEvent.click((await screen.findAllByRole("link", { name: /Buka WhatsApp/ }))[0]!);
    await screen.findByText("Diingatkan baru saja · oleh Anda");
    await user.click(screen.getByRole("button", { name: "Muat lebih banyak" }));

    expect(await screen.findByText("Siswa C")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.match(/Siswa [ABC]/)?.[0])).toEqual([
      "Siswa A",
      "Siswa B",
      "Siswa C",
    ]);
    // A's row took its data from the fresh fetch (Bu Nur), in place.
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("oleh Bu Nur");
    const reads = callsTo(fetchMock, "/api/invoices/reminders").map(([url]) => String(url));
    expect(reads.slice(-2)).toEqual([
      "/api/invoices/reminders?page=1&pageSize=50",
      "/api/invoices/reminders?page=2&pageSize=50",
    ]);
    expect(screen.queryByRole("button", { name: "Muat lebih banyak" })).not.toBeInTheDocument();
  });

  it("no 'Muat lebih banyak' when everything fits on one page", async () => {
    stubFetch(() => ok(page([row("A")])));
    renderQueue();
    await screen.findByText("Siswa A");
    expect(screen.queryByRole("button", { name: "Muat lebih banyak" })).not.toBeInTheDocument();
  });

  it("does not fetch while closed", () => {
    const fetchMock = stubFetch(() => ok(page([])));
    render(<ReminderQueueDialog open={false} onOpenChange={() => {}} capabilities={{ create: true }} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
