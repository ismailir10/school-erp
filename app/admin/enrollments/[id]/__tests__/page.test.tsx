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
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import EnrollmentDetailPage from "../page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/components/admin/enrollment-application-view", () => ({
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
