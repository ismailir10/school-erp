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
 * Also covers the stage actions, the single-click convert (with its duplicate / wali questions) and Tolak / Buka lagi.
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

const baseDetail = {
  id: "ea-1",
  canEdit: true,
  status: "SUBMITTED",
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

type Reply = { ok: boolean; status: number; body: unknown };
const okReply = (body: unknown = {}): Reply => ({ ok: true, status: 200, body });
const errReply = (status: number, body: unknown): Reply => ({ ok: false, status, body });

/** Detail GETs return `detail`; each convert POST takes the next reply (the last one repeats); PATCH answers ok. */
function serveDetail(detail: Record<string, unknown>, convertReplies: Reply[] = [okReply()]) {
  let n = 0;
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = String(input);
    if (url.endsWith("/convert") && init?.method === "POST") {
      const r = convertReplies[Math.min(n++, convertReplies.length - 1)];
      return Promise.resolve({ ok: r.ok, status: r.status, json: async () => r.body } as Response);
    }
    if (init?.method === "PATCH") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => detail } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const converts = (f: ReturnType<typeof serveDetail>) =>
  f.mock.calls.filter(([u, init]) => String(u).endsWith("/convert") && init?.method === "POST");
const convertBody = (f: ReturnType<typeof serveDetail>, i: number) =>
  JSON.parse(converts(f)[i][1]!.body as string);
const patches = (f: ReturnType<typeof serveDetail>) => f.mock.calls.filter(([, init]) => init?.method === "PATCH");
const detailLoads = (f: ReturnType<typeof serveDetail>) =>
  f.mock.calls.filter(([u, init]) => String(u) === "/api/enrollments/ea-1" && !init?.method).length;

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Aksi lainnya" }));
}

/** Header "Terima & Jadikan Siswa" → confirm dialog → confirm. */
async function acceptAndConvert(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Terima & Jadikan Siswa" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Terima & Jadikan Siswa" }));
}

describe("EnrollmentDetailPage — read-only admissions access", () => {
  it("does not render any stage action when canEdit is false", async () => {
    serveDetail({ ...baseDetail, canEdit: false, status: "ACCEPTED" });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    expect(await screen.findByText("Aisyah")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terima & Jadikan Siswa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aksi lainnya" })).not.toBeInTheDocument();
  });
});

describe("EnrollmentDetailPage — actions by stage", () => {
  const retired = ["Mulai Tinjau", "Kembali ke Tinjau", "Tinjau Ulang", "Terima", "Konversi ke Siswa"];

  it.each(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED"])(
    "%s has exactly one primary button, Terima & Jadikan Siswa; Ubah data and Tolak wait in the menu",
    async (status) => {
      serveDetail({ ...baseDetail, status });
      const user = userEvent.setup();
      render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

      await screen.findByRole("button", { name: "Terima & Jadikan Siswa" });
      expect(screen.getAllByRole("button", { name: "Terima & Jadikan Siswa" })).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Ubah data" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Tolak" })).not.toBeInTheDocument();
      for (const label of retired) expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();

      await openMenu(user);
      expect(await screen.findByRole("menuitem", { name: "Ubah data" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Tolak" })).toBeInTheDocument();
      for (const label of retired) expect(screen.queryByRole("menuitem", { name: label })).not.toBeInTheDocument();
    },
  );

  it("INVITED offers Ubah data and Tandai formulir masuk, with Jadikan siswa in the menu", async () => {
    serveDetail({ ...baseDetail, status: "INVITED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    expect(await screen.findByRole("button", { name: "Ubah data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tandai formulir masuk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terima & Jadikan Siswa" })).not.toBeInTheDocument();
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Jadikan siswa" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tolak" })).not.toBeInTheDocument();
  });

  it("REJECTED shows no visible stage button; Buka lagi and Ubah data are in the menu", async () => {
    serveDetail({ ...baseDetail, status: "REJECTED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await screen.findByText("Aisyah");
    expect(screen.queryByRole("button", { name: "Terima & Jadikan Siswa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ubah data" })).not.toBeInTheDocument();
    await openMenu(user);
    expect(await screen.findByRole("menuitem", { name: "Buka lagi" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ubah data" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tolak" })).not.toBeInTheDocument();
  });

  it("a converted form has no actions, only a link to the student", async () => {
    serveDetail({ ...baseDetail, status: "ACCEPTED", studentId: "stu-9" });
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    const link = await screen.findByRole("link", { name: "Lihat siswa" });
    expect(link).toHaveAttribute("href", "/admin/students/stu-9");
    expect(screen.queryByRole("button", { name: "Terima & Jadikan Siswa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aksi lainnya" })).not.toBeInTheDocument();
  });

  it("the primary button sits in the header, before the page body", async () => {
    serveDetail(baseDetail);
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    const convert = await screen.findByRole("button", { name: "Terima & Jadikan Siswa" });
    expect(convert.compareDocumentPosition(screen.getByText("Isi formulir")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("EnrollmentDetailPage — Tolak and Buka lagi", () => {
  it("Tolak opens a destructive confirm; cancelling sends nothing", async () => {
    const fetchMock = serveDetail(baseDetail);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Tolak" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Tolak pendaftaran Aisyah?")).toBeInTheDocument();
    expect(within(dialog).getByText(/keluarga diberi tahu/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("Tolak confirm sends REJECTED", async () => {
    vi.mocked(toast.success).mockClear();
    const fetchMock = serveDetail(baseDetail);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Tolak" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Tolak" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(JSON.parse(patches(fetchMock)[0][1]!.body as string)).toEqual({ status: "REJECTED" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pendaftaran ditolak."));
  });

  it("Buka lagi sends SUBMITTED straight away and reloads", async () => {
    vi.mocked(toast.success).mockClear();
    const fetchMock = serveDetail({ ...baseDetail, status: "REJECTED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await screen.findByText("Aisyah");
    const before = detailLoads(fetchMock);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Buka lagi" }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(JSON.parse(patches(fetchMock)[0][1]!.body as string)).toEqual({ status: "SUBMITTED" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pendaftaran dibuka lagi."));
    await waitFor(() => expect(detailLoads(fetchMock)).toBeGreaterThan(before));
  });

  it("a refused status change shows the server text", async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = serveDetail({ ...baseDetail, status: "REJECTED" });
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(
        init?.method === "PATCH"
          ? ({ ok: false, status: 409, json: async () => ({ error: "Formulir ini sudah dijadikan siswa." }) } as Response)
          : ({ ok: true, status: 200, json: async () => ({ ...baseDetail, status: "REJECTED" }) } as Response),
      ),
    );
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Buka lagi" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Formulir ini sudah dijadikan siswa."));
  });
});

describe("EnrollmentDetailPage — Terima & Jadikan Siswa", () => {
  it("opens a confirm and posts only once it is confirmed", async () => {
    const fetchMock = serveDetail(baseDetail);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await user.click(await screen.findByRole("button", { name: "Terima & Jadikan Siswa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Terima Aisyah dan jadikan siswa?")).toBeInTheDocument();
    expect(converts(fetchMock)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Terima & Jadikan Siswa" }));
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(1));
    expect(convertBody(fetchMock, 0)).toEqual({});
    // No separate Terima PATCH: the convert route moves the stage itself.
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("Batal posts nothing", async () => {
    const fetchMock = serveDetail(baseDetail);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Terima & Jadikan Siswa" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Batal" }));
    expect(converts(fetchMock)).toHaveLength(0);
  });

  it("converts straight from INVITED through the menu, with a note that the parent has not sent the form", async () => {
    const fetchMock = serveDetail({ ...baseDetail, status: "INVITED" });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Jadikan siswa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Jadikan Aisyah siswa?")).toBeInTheDocument();
    expect(within(dialog).getByText(/belum mengirim formulir/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Jadikan siswa" }));
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(1));
    expect(convertBody(fetchMock, 0)).toEqual({});
  });
});

describe("EnrollmentDetailPage — convert result toast", () => {
  async function convertWith(body: unknown) {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.warning).mockClear();
    serveDetail(baseDetail, [okReply(body)]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    return vi.mocked(toast.success).mock.calls[0] as [string, { description?: React.ReactNode; action: { label: string; onClick: () => void }; cancel: { label: string; onClick: () => void } }];
  }

  it("names the documents copied to the guardians", async () => {
    const [message] = await convertWith({ student: { id: "stu-9" }, documentsCopied: { ktpAyah: "copied", ktpIbu: "copied", kk: "copied" } });
    expect(message).toBe("Siswa berhasil dibuat dari formulir. KTP Ayah, KTP Ibu, KK disalin ke data wali.");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns when some copies failed and lists only what was copied", async () => {
    const [message] = await convertWith({ student: { id: "stu-9" }, documentsCopied: { ktpAyah: "copied", ktpIbu: "failed", kk: "missing" } });
    expect(message).toBe("Siswa berhasil dibuat dari formulir. KTP Ayah disalin ke data wali.");
    expect(toast.warning).toHaveBeenCalledWith("Sebagian berkas gagal disalin ke data wali. Unggah manual dari halaman wali.");
  });

  it("keeps the plain success message when nothing was copied and no wali was reused", async () => {
    const [message, options] = await convertWith({
      student: { id: "stu-9" },
      documentsCopied: { ktpAyah: "missing", ktpIbu: "skipped_existing", kk: "missing" },
      reusedGuardians: [],
    });
    expect(message).toBe("Siswa berhasil dibuat dari formulir.");
    expect(options.description).toBeUndefined();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("adds one short line when an existing wali was reused", async () => {
    const [, options] = await convertWith({
      student: { id: "stu-9" },
      documentsCopied: {},
      reusedGuardians: [
        { role: "AYAH", name: "Budi Santoso", otherChildrenCount: 1 },
        { role: "IBU", name: "Dewi Lestari", otherChildrenCount: 2 },
      ],
    });
    expect(options.description).toBe("Wali sudah terdaftar; anak ditautkan ke akun yang sama.");
  });

  it("keeps the toast up for 10 seconds", async () => {
    const [, options] = await convertWith({ student: { id: "stu-9" }, documentsCopied: {} });
    expect((options as { duration?: number }).duration).toBe(10000);
  });

  it("offers Lihat siswa and Daftarkan ke kelas, each deep-linking to the student", async () => {
    push.mockClear();
    const [, options] = await convertWith({ student: { id: "stu-9" }, documentsCopied: {} });
    expect(options.action.label).toBe("Lihat siswa");
    options.action.onClick();
    expect(push).toHaveBeenLastCalledWith("/admin/students/stu-9");
    expect(options.cancel.label).toBe("Daftarkan ke kelas");
    options.cancel.onClick();
    expect(push).toHaveBeenLastCalledWith("/admin/students/stu-9?aksi=daftarkan-kelas");
  });

  it("reloads the detail after success", async () => {
    vi.mocked(toast.success).mockClear();
    const fetchMock = serveDetail(baseDetail, [okReply({ student: { id: "stu-9" }, documentsCopied: {} })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    const before = detailLoads(fetchMock);
    await acceptAndConvert(user);
    await waitFor(() => expect(detailLoads(fetchMock)).toBeGreaterThan(before));
  });
});

describe("EnrollmentDetailPage — convert asks before merging", () => {
  const duplicate = errReply(409, {
    error: "Sudah ada siswa dengan nama dan data yang mirip.",
    code: "POSSIBLE_DUPLICATE",
    candidates: [{ id: "stu-old", name: "Aisyah Putri", dateOfBirth: "2021-03-04", guardianNames: ["Budi Santoso"] }],
  });
  const mismatch = errReply(409, {
    error: "Email ini sudah terdaftar atas nama lain.",
    code: "GUARDIAN_NAME_MISMATCH",
    guardians: [{ role: "IBU", formName: "Dewi L.", existingName: "Dewi Lestari", otherChildrenCount: 2 }],
  });
  const done = okReply({ student: { id: "stu-9" }, documentsCopied: {} });

  it("a possible duplicate lists the candidates; Tetap jadikan siswa re-posts with confirmDuplicate", async () => {
    vi.mocked(toast.success).mockClear();
    const fetchMock = serveDetail(baseDetail, [duplicate, done]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);

    const dialog = await screen.findByRole("alertdialog", { name: "Sudah ada siswa dengan data mirip" });
    const list = within(dialog).getByRole("list", { name: "Siswa dengan data mirip" });
    expect(within(list).getByText("Aisyah Putri")).toBeInTheDocument();
    expect(within(list).getByText(/Wali: Budi Santoso/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Lihat siswa Aisyah Putri, tab baru" })).toHaveAttribute("href", "/admin/students/stu-old");
    expect(converts(fetchMock)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Tetap jadikan siswa" }));
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(2));
    expect(convertBody(fetchMock, 1)).toEqual({ confirmDuplicate: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("Batal on the duplicate question posts nothing more and focus goes back to the primary button", async () => {
    const fetchMock = serveDetail(baseDetail, [duplicate]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);

    const dialog = await screen.findByRole("alertdialog", { name: "Sudah ada siswa dengan data mirip" });
    await user.click(within(dialog).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(converts(fetchMock)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Terima & Jadikan Siswa" })).toHaveFocus());
  });

  it("a wali under another name shows both names; Tetap tautkan re-posts with confirmGuardians", async () => {
    const fetchMock = serveDetail(baseDetail, [mismatch, done]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);

    const dialog = await screen.findByRole("alertdialog", { name: "Email ini sudah terdaftar atas nama lain" });
    const list = within(dialog).getByRole("list", { name: "Wali dengan nama berbeda" });
    expect(within(list).getByText("Ibu")).toBeInTheDocument();
    expect(within(list).getByText("Dewi L.")).toBeInTheDocument();
    expect(within(list).getByText("Dewi Lestari")).toBeInTheDocument();
    expect(within(list).getByText("Sudah tertaut ke 2 anak lain.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Tetap tautkan" }));
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(2));
    expect(convertBody(fetchMock, 1)).toEqual({ confirmGuardians: true });
  });

  it("when both questions come up, the second post keeps the first answer and dialogs never stack", async () => {
    const fetchMock = serveDetail(baseDetail, [duplicate, mismatch, done]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    let mostOpen = 0;
    const watcher = new MutationObserver(() => {
      mostOpen = Math.max(mostOpen, document.querySelectorAll('[role="alertdialog"]').length);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    await acceptAndConvert(user);

    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Sudah ada siswa dengan data mirip" })).getByRole("button", { name: "Tetap jadikan siswa" }),
    );
    const second = await screen.findByRole("alertdialog", { name: "Email ini sudah terdaftar atas nama lain" });
    expect(converts(fetchMock)).toHaveLength(2);
    expect(convertBody(fetchMock, 1)).toEqual({ confirmDuplicate: true });

    await user.click(within(second).getByRole("button", { name: "Tetap tautkan" }));
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(3));
    expect(convertBody(fetchMock, 2)).toEqual({ confirmDuplicate: true, confirmGuardians: true });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    watcher.disconnect();
    expect(mostOpen).toBe(1);
  });

  it("answers in the other order too, and a fresh convert starts without old answers", async () => {
    const fetchMock = serveDetail(baseDetail, [mismatch, duplicate, errReply(409, { error: "Pendaftaran ini sudah ditutup.", code: "LEAD_CLOSED" }), duplicate]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Email ini sudah terdaftar atas nama lain" })).getByRole("button", { name: "Tetap tautkan" }),
    );
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Sudah ada siswa dengan data mirip" })).getByRole("button", { name: "Tetap jadikan siswa" }),
    );
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(3));
    expect(convertBody(fetchMock, 2)).toEqual({ confirmGuardians: true, confirmDuplicate: true });

    // The third answer was a refusal; trying again from the button must not carry the old answers.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await acceptAndConvert(user);
    await waitFor(() => expect(converts(fetchMock)).toHaveLength(4));
    expect(convertBody(fetchMock, 3)).toEqual({});
  });
});

describe("EnrollmentDetailPage — convert errors", () => {
  it("missing child or parent name: the toast lists what is missing and offers Ubah data", async () => {
    vi.mocked(toast.error).mockClear();
    serveDetail(baseDetail, [
      errReply(400, {
        error: "Validasi gagal",
        errors: [
          { field: "studentData.childName", message: "Nama anak belum diisi." },
          { field: "ayahData.name", message: "Isi nama Ayah atau Ibu." },
        ],
      }),
    ]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("Nama anak belum diisi. Isi nama Ayah atau Ibu.");
    expect(options.action.label).toBe("Ubah data");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    act(() => options.action.onClick());
    expect(await screen.findByRole("heading", { name: "Ubah data formulir" })).toBeInTheDocument();
  });

  it("ALREADY_CONVERTED shows the server text and reloads the page", async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = serveDetail(baseDetail, [
      errReply(409, { error: "Pendaftaran ini sudah dikonversi menjadi siswa.", code: "ALREADY_CONVERTED" }),
    ]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    const before = detailLoads(fetchMock);
    await acceptAndConvert(user);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Pendaftaran ini sudah dikonversi menjadi siswa."));
    await waitFor(() => expect(detailLoads(fetchMock)).toBeGreaterThan(before));
  });

  it.each([
    [409, "GUARDIAN_RACE", "Data wali baru saja berubah. Coba lagi."],
    [409, "LEAD_CLOSED", "Pendaftaran ini sudah dibatalkan, jadi tidak bisa dijadikan siswa."],
    [400, "NOT_CONVERTIBLE", "Formulir ini sudah ditolak. Buka lagi dulu kalau ingin melanjutkan."],
  ])("%s %s shows the server text and keeps the page as it is", async (status, code, error) => {
    vi.mocked(toast.error).mockClear();
    serveDetail(baseDetail, [errReply(status, { error, code })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("NOT_CONVERTIBLE also reloads the page", async () => {
    const fetchMock = serveDetail(baseDetail, [errReply(400, { error: "Formulir ini sudah ditolak.", code: "NOT_CONVERTIBLE" })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await screen.findByText("Aisyah");
    const before = detailLoads(fetchMock);
    await acceptAndConvert(user);
    await waitFor(() => expect(detailLoads(fetchMock)).toBeGreaterThan(before));
  });

  it("GUARDIAN_INACTIVE offers Ubah data", async () => {
    vi.mocked(toast.error).mockClear();
    serveDetail(baseDetail, [errReply(409, { error: "Wali ini sudah dinonaktifkan.", code: "GUARDIAN_INACTIVE" })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe("Wali ini sudah dinonaktifkan.");
    expect(options.action.label).toBe("Ubah data");
    act(() => options.action.onClick());
    expect(await screen.findByRole("heading", { name: "Ubah data formulir" })).toBeInTheDocument();
  });

  it("a 404 never shows the English server text", async () => {
    vi.mocked(toast.error).mockClear();
    serveDetail(baseDetail, [errReply(404, { error: "Not found" })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Formulir tidak ditemukan. Muat ulang halaman."));
  });

  it("a bare 403 gets Indonesian copy, and a dropped connection a retry hint", async () => {
    vi.mocked(toast.error).mockClear();
    const fetchMock = serveDetail(baseDetail, [errReply(403, { error: "Forbidden" })]);
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Anda tidak memiliki izin untuk tindakan ini."));

    fetchMock.mockImplementation((input, init) =>
      String(input).endsWith("/convert") && init?.method === "POST"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve({ ok: true, status: 200, json: async () => baseDetail } as Response),
    );
    await acceptAndConvert(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gagal menjadikan siswa. Periksa koneksi, lalu coba lagi."));
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
    await user.click(await screen.findByRole("button", { name: "Terima & Jadikan Siswa" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/belum dibayar/)).toBeInTheDocument();
    expect(within(dialog).getByText(/300\.000/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Terima & Jadikan Siswa" })).toBeEnabled();
  });

  it("converting a paid or waived application shows the plain confirm", async () => {
    serve({ ...base, fee: { ...unpaidFee, status: "PAID" }, followUp: null });
    const user = userEvent.setup();
    render(<EnrollmentDetailPage params={fulfilledParams({ id: "ea-1" })} />);
    await user.click(await screen.findByRole("button", { name: "Terima & Jadikan Siswa" }));

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
    await screen.findByRole("button", { name: "Terima & Jadikan Siswa" });
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
    await screen.findByRole("button", { name: "Terima & Jadikan Siswa" });
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
