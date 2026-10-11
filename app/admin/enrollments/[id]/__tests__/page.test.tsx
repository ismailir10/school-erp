/**
 * Admin UI audit fixes (T8, finding #12) — the enrollment detail page used
 * to hand-roll its loading/not-found states as plain `<p>` text instead of
 * the shared `DetailPageSkeleton` / `EmptyState` primitives every sibling
 * detail page (students, guardians) already uses. This guards the
 * not-found branch: against the pre-fix markup
 * (`<p className="p-6 …">Formulir tidak ditemukan.</p>`) there is no
 * `EmptyState` title/description pairing and no way back to the list, so
 * these assertions would fail.
 *
 * Also covers the convert action (header placement, "Lihat siswa" link, toast action).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import EnrollmentDetailPage from "../page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// Only the read-only body is stubbed; the editor reuses the module's section chrome.
vi.mock("@/components/admin/enrollment-application-view", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/admin/enrollment-application-view")>()),
  EnrollmentApplicationView: () => <div>Isi formulir</div>,
}));

/**
 * `use(params)` suspends on first render for a "cold" Promise — React only
 * reads a `use()`-d thenable synchronously once it carries a `status`/`value`
 * pair, which it normally attaches itself via `.then()` on a later tick. jsdom
 * + this repo's vitest/RTL combo never flushes that retry tick (verified with
 * a minimal repro: even 3s of real-timer `waitFor` never resolves it), so a
 * genuinely-pending `Promise.resolve(...)` never renders past the Suspense
 * fallback here. Pre-attach the fulfilled marker React itself would set once
 * the promise settles, so `use()` returns synchronously on first render — this
 * mirrors real behaviour (Next.js pre-resolves route params before paint) and
 * lets the test exercise the page's actual not-found branch instead of a
 * permanently-suspended tree.
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

describe("EnrollmentDetailPage — not-found state (AC12)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: async () => ({ error: "Not found" }),
        } as Response),
      ),
    );
  });

  it("renders the shared EmptyState with a description and a way back to the list", async () => {
    render(
      <EnrollmentDetailPage params={fulfilledParams({ id: "missing-id" })} />,
    );

    expect(
      await screen.findByText("Formulir tidak ditemukan"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Formulir pendaftaran ini tidak tersedia atau telah dihapus.",
      ),
    ).toBeInTheDocument();

    const backLink = screen.getByRole("link", {
      name: "Kembali ke Daftar Formulir Pendaftaran",
    });
    expect(backLink).toHaveAttribute("href", "/admin/enrollments");
  });
});

describe("EnrollmentDetailPage — read-only admissions access", () => {
  it("does not render status or conversion mutations when canEdit is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            id: "ea-1",
            canEdit: false,
            status: "ACCEPTED",
            studentId: null,
            childName: "Aisyah",
            dcareAddon: false,
            studentData: {},
            ayahData: {},
            ibuData: {},
            consentData: {},
            program: { id: "p-1", name: "TK A" },
          }),
        } as Response),
      ),
    );

    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    expect(await screen.findByText("Aisyah")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kembali ke Tinjau" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Konversi ke Siswa" })).not.toBeInTheDocument();
  });
});

describe("EnrollmentDetailPage — convert toast", () => {
  const accepted = {
    id: "ea-1",
    canEdit: true,
    status: "ACCEPTED",
    studentId: null,
    childName: "Aisyah",
    dcareAddon: false,
    studentData: {},
    ayahData: {},
    ibuData: {},
    consentData: {},
    documents: {},
    program: { id: "p-1", name: "TK A" },
  };

  async function convertWith(convertBody: unknown) {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: async () => (init?.method === "POST" ? convertBody : accepted),
        } as Response),
      ),
    );
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Konversi ke Siswa" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Konversi ke Siswa")!,
    );
  }

  it("names the documents copied to the guardians", async () => {
    await convertWith({
      documentsCopied: { ktpAyah: "copied", ktpIbu: "copied", kk: "copied" },
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Siswa berhasil dibuat dari formulir. KTP Ayah, KTP Ibu, KK disalin ke data wali.",
      ),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns when some copies failed and lists only what was copied", async () => {
    await convertWith({
      documentsCopied: { ktpAyah: "copied", ktpIbu: "failed", kk: "missing" },
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Siswa berhasil dibuat dari formulir. KTP Ayah disalin ke data wali.",
      ),
    );
    expect(toast.warning).toHaveBeenCalledWith(
      "Sebagian berkas gagal disalin ke data wali. Unggah manual dari halaman wali.",
    );
  });

  it("keeps the plain success message when nothing was copied", async () => {
    await convertWith({
      documentsCopied: { ktpAyah: "missing", ktpIbu: "skipped_existing", kk: "missing" },
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Siswa berhasil dibuat dari formulir."),
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("EnrollmentDetailPage — convert action placement", () => {
  const base = {
    id: "ea-1",
    canEdit: true,
    status: "ACCEPTED",
    studentId: null as string | null,
    childName: "Aisyah",
    dcareAddon: false,
    studentData: {},
    ayahData: {},
    ibuData: {},
    consentData: {},
    documents: {},
    program: { id: "p-1", name: "TK A" },
  };

  function serve(detail: Record<string, unknown>, convertBody: unknown = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: async () => (init?.method === "POST" ? convertBody : detail),
        } as Response),
      ),
    );
  }

  it("ACCEPTED shows exactly one Konversi ke Siswa button, in the header, beside Kembali ke Tinjau", async () => {
    serve(base);
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    const convert = await screen.findByRole("button", { name: "Konversi ke Siswa" });
    expect(screen.getAllByRole("button", { name: "Konversi ke Siswa" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Kembali ke Tinjau" })).toBeInTheDocument();
    // The bottom bar and its sentence are gone.
    expect(screen.queryByText(/Konversi menjadi data siswa \+ orang tua/)).not.toBeInTheDocument();
    // Header buttons live before the page body (the documents card).
    expect(convert.compareDocumentPosition(screen.getByText("Isi formulir")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the header Konversi ke Siswa opens the confirm dialog", async () => {
    serve(base);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Konversi ke Siswa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Konversi menjadi siswa?")).toBeInTheDocument();
  });

  it("shows no convert button for statuses other than ACCEPTED", async () => {
    serve({ ...base, status: "UNDER_REVIEW" });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: "Konversi ke Siswa" })).not.toBeInTheDocument();
  });

  it("a converted form links to the student", async () => {
    serve({ ...base, studentId: "stu-9" });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    const link = await screen.findByRole("link", { name: "Lihat siswa" });
    expect(link).toHaveAttribute("href", "/admin/students/stu-9");
    expect(screen.queryByRole("button", { name: "Konversi ke Siswa" })).not.toBeInTheDocument();
  });

  it("the convert success toast offers the same link as an action", async () => {
    vi.mocked(toast.success).mockClear();
    push.mockClear();
    serve(base, { student: { id: "stu-9" }, documentsCopied: {} });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Konversi ke Siswa" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Konversi ke Siswa")!,
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [message, options] = vi.mocked(toast.success).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("Siswa berhasil dibuat dari formulir.");
    expect(options.action.label).toBe("Lihat siswa");
    options.action.onClick();
    expect(push).toHaveBeenCalledWith("/admin/students/stu-9");
  });
});

describe("EnrollmentDetailPage — Terima / Tolak confirm", () => {
  const review = {
    id: "ea-1",
    canEdit: true,
    status: "UNDER_REVIEW",
    studentId: null as string | null,
    childName: "Aisyah",
    dcareAddon: false,
    studentData: {},
    ayahData: {},
    ibuData: {},
    consentData: {},
    documents: {},
    program: { id: "p-1", name: "TK A" },
  };

  function serve() {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => (init?.method === "PATCH" ? { ok: true } : review),
      } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const patches = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([, init]) => init?.method === "PATCH");

  it("Terima opens a confirm and only changes the status once confirmed", async () => {
    const fetchMock = serve();
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await user.click(await screen.findByRole("button", { name: "Terima" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Terima pendaftaran Aisyah?")).toBeInTheDocument();
    expect(patches(fetchMock)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Terima" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(JSON.parse(patches(fetchMock)[0][1]!.body as string)).toEqual({ status: "ACCEPTED" });
  });

  it("Tolak opens a destructive confirm; cancelling sends nothing", async () => {
    const fetchMock = serve();
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await user.click(await screen.findByRole("button", { name: "Tolak" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Tolak pendaftaran Aisyah?")).toBeInTheDocument();
    expect(within(dialog).getByText(/keluarga diberi tahu/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("Tolak confirm sends REJECTED", async () => {
    const fetchMock = serve();
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await user.click(await screen.findByRole("button", { name: "Tolak" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Tolak" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(JSON.parse(patches(fetchMock)[0][1]!.body as string)).toEqual({ status: "REJECTED" });
  });
});

describe("EnrollmentDetailPage — pendaftaran fee", () => {
  const unpaidFee = {
    status: "UNPAID",
    method: null,
    baseAmount: 300000,
    discountPercent: 0,
    discountReason: null,
    amount: 300000,
    paidAt: null,
    note: null,
    linkError: null,
    lastCheckedAt: null,
    linkActive: false,
  };
  const base = {
    id: "ea-1",
    canEdit: true,
    status: "ACCEPTED",
    studentId: null as string | null,
    childName: "Aisyah",
    dcareAddon: false,
    studentData: {},
    ayahData: {},
    ibuData: {},
    consentData: {},
    documents: {},
    program: { id: "p-1", name: "TK A" },
    fee: unpaidFee,
    followUp: { formUrl: "https://talib.example/pendaftaran/tok", canRemind: true },
    feeProblems: [],
    feePermissions: { recordPayment: true, adjust: true },
  };

  function serve(detail: Record<string, unknown>) {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve({ ok: true, json: async () => detail } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows the payment card above the documents, with the reminder link", async () => {
    serve(base);
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    const card = await screen.findByRole("heading", { name: "Pembayaran pendaftaran" });
    expect(screen.getByRole("link", { name: "Chat WhatsApp: ingatkan orang tua Aisyah" })).toHaveAttribute(
      "href",
      "/api/enrollments/ea-1/fee/reminder",
    );
    expect(card.compareDocumentPosition(screen.getByText("Isi formulir")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no payment card for an application whose program has no fee", async () => {
    serve({ ...base, fee: null, followUp: null });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("heading", { name: "Pembayaran pendaftaran" })).not.toBeInTheDocument();
  });

  it("converting with an unpaid fee warns, with the amount, but does not block", async () => {
    serve(base);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Konversi ke Siswa" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/belum dibayar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/300\.000/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Konversi ke Siswa" })).toBeEnabled();
  });

  it("converting a paid or waived application shows the plain confirm", async () => {
    serve({ ...base, fee: { ...unpaidFee, status: "PAID" }, followUp: null });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Konversi ke Siswa" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByText(/belum dibayar/)).not.toBeInTheDocument();
  });

  it("a refresh after a fee action re-reads the application without flashing the page skeleton", async () => {
    const fetchMock = serve(base);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByRole("heading", { name: "Pembayaran pendaftaran" });
    fetchMock.mockClear();
    // Refresh POST resolves with the same body (a code the card treats as "no change").
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, json: async () => ({ ...base, code: "NO_CHANGE", message: "Belum ada pembayaran masuk." }) } as Response),
    );

    await user.click(screen.getByRole("button", { name: "Perbarui pembayaran" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]) === "/api/enrollments/ea-1")).toBe(true));
    // The card never unmounted.
    expect(screen.getByRole("heading", { name: "Pembayaran pendaftaran" })).toBeInTheDocument();
  });
});

describe("EnrollmentDetailPage — Ubah data and Tandai formulir masuk", () => {
  const invited = {
    id: "ea-1",
    canEdit: true,
    status: "INVITED",
    studentId: null as string | null,
    childName: "Aisyah",
    dcareAddon: false,
    studentData: { childName: "Aisyah" },
    ayahData: { name: "Budi" },
    ibuData: {},
    consentData: {},
    documents: {},
    program: { id: "p-1", name: "TK A" },
    fee: null,
  };

  function serve(detail: Record<string, unknown>, markReply: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { id: "ea-1", status: "SUBMITTED" } }) {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith("/mark-submitted")) {
        return Promise.resolve({ ok: markReply.ok, status: markReply.status, json: async () => markReply.body } as Response);
      }
      if (url === "/api/config/enrollment") {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ programs: [] }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => detail } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const marks = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([u]) => String(u).endsWith("/mark-submitted"));

  it("an invited formulir offers both actions to staff who can edit", async () => {
    serve(invited);
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    expect(await screen.findByRole("button", { name: "Ubah data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tandai formulir masuk" })).toBeInTheDocument();
  });

  it.each([
    ["a viewer without admissions.edit", { ...invited, canEdit: false }],
    ["a converted application", { ...invited, status: "ACCEPTED", studentId: "stu-1" }],
  ])("%s sees no edit or mark actions", async (_label, detail) => {
    serve(detail);
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: "Ubah data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tandai formulir masuk" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Ubah data" })).not.toBeInTheDocument();
  });

  it("Tandai formulir masuk is only for a formulir that is still INVITED", async () => {
    serve({ ...invited, status: "SUBMITTED" });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: "Tandai formulir masuk" })).not.toBeInTheDocument();
  });

  it("when the header is already full, Ubah data moves into the overflow menu", async () => {
    serve({ ...invited, status: "ACCEPTED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByRole("button", { name: "Konversi ke Siswa" });
    expect(screen.queryByRole("button", { name: "Ubah data" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    expect(await screen.findByRole("menuitem", { name: "Ubah data" })).toBeInTheDocument();
  });

  it("Ubah data swaps the body for the editor and hides the stage actions; Batal comes back with focus on the action", async () => {
    serve(invited);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Ubah data" }));

    expect(await screen.findByRole("heading", { name: "Ubah data formulir" })).toBeInTheDocument();
    expect(screen.queryByText("Isi formulir")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tandai formulir masuk" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(await screen.findByText("Isi formulir")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ubah data formulir" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ubah data" })).toHaveFocus());
  });

  it("a saved edit reloads the detail and leaves edit mode", async () => {
    const fetchMock = serve(invited);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Ubah data" }));
    await user.type(await screen.findByLabelText("Nama panggilan"), "Aisy");
    const detailLoads = () => fetchMock.mock.calls.filter(([u, init]) => String(u) === "/api/enrollments/ea-1" && !init?.method).length;
    const before = detailLoads();
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Ubah data formulir" })).not.toBeInTheDocument());
    expect(detailLoads()).toBeGreaterThan(before);
    expect(await screen.findByText("Isi formulir")).toBeInTheDocument();
  });

  it("when Ubah data sits in the overflow menu, focus returns to the menu trigger after Batal", async () => {
    serve({ ...invited, status: "ACCEPTED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByRole("button", { name: "Konversi ke Siswa" });
    await user.click(screen.getByRole("button", { name: "Aksi lainnya" }));
    await user.click(await screen.findByRole("menuitem", { name: "Ubah data" }));
    await user.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Aksi lainnya" })).toHaveFocus());
  });

  it("with nowhere else to land, focus returns to the page heading", async () => {
    // No edit action is rendered for a viewer, so a finished action can only fall back to the heading.
    const fetchMock = serve(invited);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Tandai formulir masuk" }));
    // The refreshed detail drops every action (viewer / converted meanwhile).
    fetchMock.mockImplementation((input) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (String(input).endsWith("/mark-submitted") ? { id: "ea-1", status: "SUBMITTED" } : { ...invited, canEdit: false }),
      } as Response),
    );
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tandai masuk" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Aisyah/ })).toHaveFocus());
  });

  it("Tandai formulir masuk confirms with the consent wording, then posts and reloads", async () => {
    vi.mocked(toast.success).mockClear();
    const fetchMock = serve(invited);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await user.click(await screen.findByRole("button", { name: "Tandai formulir masuk" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        'Orang tua tidak perlu mengisi lagi. Persetujuan dicatat sebagai "disetujui langsung di sekolah" atas nama Anda.',
      ),
    ).toBeInTheDocument();
    expect(marks(fetchMock)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Tandai masuk" }));
    await waitFor(() => expect(marks(fetchMock)).toHaveLength(1));
    expect(marks(fetchMock)[0][1]).toMatchObject({ method: "POST" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Formulir ditandai masuk."));
  });

  it("cancelling the confirm posts nothing", async () => {
    const fetchMock = serve(invited);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Tandai formulir masuk" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Batal" }));
    expect(marks(fetchMock)).toHaveLength(0);
  });

  it("a 400 shows the server message and offers to open Ubah data", async () => {
    vi.mocked(toast.error).mockClear();
    // The server's real envelope: a generic error plus one message per missing field.
    const missingChild = "Nama anak belum diisi. Lengkapi lewat Ubah data.";
    const missingParent = "Nama Ayah atau Ibu belum diisi. Lengkapi lewat Ubah data.";
    serve(invited, {
      ok: false,
      status: 400,
      body: {
        error: "Validasi gagal",
        errors: [
          { field: "childName", message: missingChild },
          { field: "ayahData.name", message: missingParent },
        ],
      },
    });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Tandai formulir masuk" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tandai masuk" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [shown, options] = vi.mocked(toast.error).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(shown).toBe(`${missingChild} ${missingParent}`);
    expect(options.action.label).toBe("Ubah data");
    act(() => options.action.onClick());
    expect(await screen.findByRole("heading", { name: "Ubah data formulir" })).toBeInTheDocument();
  });

  it("a 409 shows the server message and refreshes the page", async () => {
    vi.mocked(toast.error).mockClear();
    const message = "Formulir ini sudah ditandai masuk atau sedang diproses.";
    const fetchMock = serve(invited, { ok: false, status: 409, body: { error: message } });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Tandai formulir masuk" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Tandai masuk" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(fetchMock.mock.calls.filter(([u, init]) => String(u) === "/api/enrollments/ea-1" && !init?.method).length).toBeGreaterThan(1);
  });
});
