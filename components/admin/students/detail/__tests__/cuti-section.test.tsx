/**
 * `CutiSection` — the "Cuti" row of the student dossier (cycle
 * 2026-10-29-student-enrollment-leave, T5). The API is stubbed with `fetch`; the
 * dialogs are driven through their real UI.
 *
 * "Today" is pinned to 2026-12-15 (Jakarta) so the create dialog's prefilled
 * month is Desember 2026 whatever day the suite runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/attendance/timezone", () => ({
  getTodayInTimezone: () => "2026-12-15",
}));

import { toast } from "sonner";
import { CutiSection } from "../cuti-section";
import type { LeaveEnrollmentOption, OpenInvoice, StudentLeave } from "../cuti-types";

const DAYCARE: LeaveEnrollmentOption = {
  id: "enr-dc",
  status: "ACTIVE",
  className: "Daycare Pagi",
  programName: "Daycare",
  academicYearName: "2026/2027",
  eligible: true,
  ineligibleReason: null,
  window: { from: "2026-07", to: "2027-06" },
};
const SCHOOL: LeaveEnrollmentOption = {
  id: "enr-kb",
  status: "ACTIVE",
  className: "KB A",
  programName: "KB",
  academicYearName: "2026/2027",
  eligible: true,
  ineligibleReason: null,
  window: { from: "2026-07", to: "2027-06" },
};
const STALE: LeaveEnrollmentOption = {
  id: "enr-old",
  status: "ACTIVE",
  className: "KB A",
  programName: "KB",
  academicYearName: "2024/2025",
  eligible: false,
  ineligibleReason: "Tahun ajaran sudah diarsipkan.",
  window: null,
};

function leave(over: Partial<StudentLeave> = {}): StudentLeave {
  return {
    id: "lv-1",
    enrollmentId: DAYCARE.id,
    startMonth: "2026-12",
    endMonth: "2027-01",
    reason: "Pulang kampung",
    status: "ACTIVE",
    createdAt: "2026-11-01T00:00:00.000Z",
    cancelledAt: null,
    enrollment: {
      id: DAYCARE.id,
      status: "ACTIVE",
      className: DAYCARE.className,
      programName: DAYCARE.programName,
      academicYearName: DAYCARE.academicYearName,
    },
    ...over,
  };
}

const INVOICE: OpenInvoice = {
  id: "inv-1",
  invoiceNumber: "INV-2026-0042",
  periodLabel: "Desember 2026",
  status: "OVERDUE",
  totalDue: 1500000,
  dueDate: "2026-12-10",
  lines: [
    { label: "SPP Bulanan", finalAmount: 1000000, isRecurring: true },
    { label: "Seragam", finalAmount: 500000, isRecurring: false },
  ],
  hasOneOffLines: true,
};

type Reply = { status?: number; body: unknown };

type Routes = {
  list?: Reply[];
  create?: Reply;
  cancel?: Reply;
  openInvoices?: Reply;
  voidInvoice?: Reply;
};

/** Routes the Cuti API; the list reply advances on each GET so a reload can show new data. */
function fixture(routes: Routes = {}) {
  let listCall = 0;
  const lists = routes.list ?? [{ body: { data: [], enrollments: [DAYCARE] } }];
  const reply = (r: Reply) => {
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.body };
  };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/open-invoices")) {
      return reply(routes.openInvoices ?? { body: { openInvoices: [], canVoid: false, otherActiveEnrollments: false } });
    }
    if (url.includes("/api/invoices/") && url.endsWith("/void")) {
      return reply(routes.voidInvoice ?? { body: { ok: true } });
    }
    if (url === "/api/students/s1/leaves" && method === "POST") {
      return reply(routes.create ?? { status: 201, body: { leave: { id: "lv-new" }, affectedRuns: [], openInvoices: [], canVoid: false, otherActiveEnrollments: false } });
    }
    if (url.startsWith("/api/students/s1/leaves/") && method === "PUT") {
      return reply(routes.cancel ?? { body: { leave: { id: "lv-1" }, affectedRuns: [] } });
    }
    if (url === "/api/students/s1/leaves") {
      return reply(lists[Math.min(listCall++, lists.length - 1)]!);
    }
    return reply({ body: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (f: ReturnType<typeof fixture>, method: string, urlPart: string) =>
  f.mock.calls.filter(([u, init]) => String(u).includes(urlPart) && ((init as RequestInit | undefined)?.method ?? "GET") === method);
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

function renderSection(props: Partial<React.ComponentProps<typeof CutiSection>> = {}) {
  return render(<CutiSection studentId="s1" active canManage {...props} />);
}

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Catat cuti" }));
  return await screen.findByRole("dialog", { name: "Catat cuti" });
}

async function pickMonth(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, label: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("CutiSection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requests nothing until the row is opened (active=false), then loads once", async () => {
    const f = fixture();
    const { rerender } = render(<CutiSection studentId="s1" active={false} canManage />);
    expect(f).not.toHaveBeenCalled();
    rerender(<CutiSection studentId="s1" active canManage />);
    await screen.findByText("Belum ada cuti");
    expect(callsTo(f, "GET", "/api/students/s1/leaves")).toHaveLength(1);
    rerender(<CutiSection studentId="s1" active canManage />);
    expect(callsTo(f, "GET", "/api/students/s1/leaves")).toHaveLength(1);
  });

  it("lists leaves: placement, range, reason, status; actions only on an active one; reports the active count", async () => {
    fixture({
      list: [
        {
          body: {
            data: [
              leave(),
              leave({ id: "lv-2", status: "INACTIVE", startMonth: "2026-09", endMonth: "2026-09", reason: "Sakit lama", cancelledAt: "2026-09-20T00:00:00.000Z" }),
            ],
            enrollments: [DAYCARE],
          },
        },
      ],
    });
    const onCountChange = vi.fn();
    renderSection({ onCountChange });

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const [active, cancelled] = rows as [HTMLElement, HTMLElement];
    expect(within(active).getByText("Daycare · Daycare Pagi")).toBeInTheDocument();
    expect(within(active).getByText(/Des 2026 – Jan 2027/)).toBeInTheDocument();
    expect(within(active).getByText("Pulang kampung")).toBeInTheDocument();
    expect(within(active).getByText("Aktif")).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Cek tagihan" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Batalkan cuti" })).toBeInTheDocument();

    expect(within(cancelled).getByText("Dibatalkan")).toBeInTheDocument();
    expect(within(cancelled).getByText(/^Sep 2026 · /)).toBeInTheDocument();
    expect(within(cancelled).queryByRole("button")).not.toBeInTheDocument();
    expect(onCountChange).toHaveBeenCalledWith(1);
  });

  it("shows the empty state", async () => {
    fixture();
    renderSection();
    expect(await screen.findByText("Belum ada cuti")).toBeInTheDocument();
    expect(
      screen.getByText("Catat cuti kalau siswa berhenti sementara dan tidak perlu ditagih."),
    ).toBeInTheDocument();
  });

  it("hides 'Catat cuti' and 'Batalkan cuti' without the manage right, but keeps 'Cek tagihan'", async () => {
    fixture({ list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }] });
    renderSection({ canManage: false });
    await screen.findByText("Pulang kampung");
    expect(screen.queryByRole("button", { name: "Catat cuti" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Batalkan cuti" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cek tagihan" })).toBeInTheDocument();
  });

  it("offers no 'Catat cuti' when no enrollment is eligible, and says why", async () => {
    fixture({ list: [{ body: { data: [], enrollments: [STALE] } }] });
    renderSection();
    expect(await screen.findByText(/Cuti belum bisa dicatat\./)).toHaveTextContent("Tahun ajaran sudah diarsipkan.");
    expect(screen.queryByRole("button", { name: "Catat cuti" })).not.toBeInTheDocument();
  });

  it("shows a load error with retry", async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    renderSection();
    expect(await screen.findByText("Gagal memuat data cuti.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeInTheDocument();
  });

  describe("create dialog", () => {
    it("hides the enrollment picker when exactly one enrollment is eligible (ineligible ones are never offered)", async () => {
      fixture({ list: [{ body: { data: [], enrollments: [DAYCARE, STALE] } }] });
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      expect(within(dialog).queryByLabelText(/Pendaftaran kelas/)).not.toBeInTheDocument();
      expect(within(dialog).getByText("Daycare · Daycare Pagi (2026/2027)")).toBeInTheDocument();
      // Mulai bulan, Sampai bulan: no third combobox.
      expect(within(dialog).getAllByRole("combobox")).toHaveLength(2);
    });

    it("shows the enrollment picker when more than one is eligible", async () => {
      fixture({ list: [{ body: { data: [], enrollments: [SCHOOL, DAYCARE, STALE] } }] });
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      const picker = within(dialog).getByLabelText(/Pendaftaran kelas/);
      await user.click(picker);
      expect(await screen.findByRole("option", { name: "KB · KB A (2026/2027)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Daycare · Daycare Pagi (2026/2027)" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /2024\/2025/ })).not.toBeInTheDocument();
    });

    it("prefills this month, posts the chosen range, then toasts and reloads the list", async () => {
      const f = fixture({
        list: [
          { body: { data: [], enrollments: [DAYCARE] } },
          { body: { data: [leave({ startMonth: "2026-12", endMonth: "2027-02" })], enrollments: [DAYCARE] } },
        ],
      });
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);

      const [start, end] = within(dialog).getAllByRole("combobox") as [HTMLElement, HTMLElement];
      expect(start).toHaveTextContent("Desember 2026");
      expect(end).toHaveTextContent("Desember 2026");

      await pickMonth(user, end, "Februari 2027");
      await user.type(within(dialog).getByLabelText(/Alasan/), "Pulang kampung");
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));

      await waitFor(() => expect(callsTo(f, "POST", "/api/students/s1/leaves")).toHaveLength(1));
      expect(bodyOf(callsTo(f, "POST", "/api/students/s1/leaves")[0]!)).toEqual({
        enrollmentId: "enr-dc",
        startMonth: "2026-12",
        endMonth: "2027-02",
        reason: "Pulang kampung",
      });
      expect(toast.success).toHaveBeenCalledWith("Cuti dicatat");
      // The list was reloaded and now shows the new range.
      expect(await screen.findByText(/Des 2026 – Feb 2027/)).toBeInTheDocument();
      await waitFor(() => expect(callsTo(f, "GET", "/api/students/s1/leaves")).toHaveLength(2));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Catat cuti" })).not.toBeInTheDocument());
    });

    it("moves 'Sampai bulan' up with 'Mulai bulan' so the range never inverts", async () => {
      const f = fixture();
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      const [start, end] = within(dialog).getAllByRole("combobox") as [HTMLElement, HTMLElement];

      await pickMonth(user, start, "Maret 2027");
      expect(end).toHaveTextContent("Maret 2027");
      await user.type(within(dialog).getByLabelText(/Alasan/), "Liburan panjang");
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));
      await waitFor(() => expect(callsTo(f, "POST", "/api/students/s1/leaves")).toHaveLength(1));
      expect(bodyOf(callsTo(f, "POST", "/api/students/s1/leaves")[0]!)).toMatchObject({
        startMonth: "2027-03",
        endMonth: "2027-03",
      });
    });

    it("limits the months to the enrollment's academic-year window", async () => {
      fixture();
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      await user.click(within(dialog).getAllByRole("combobox")[0]!);
      expect(await screen.findByRole("option", { name: "Juli 2026" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Juni 2027" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Juni 2026" })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Juli 2027" })).not.toBeInTheDocument();
    });

    it("asks for a reason before sending anything", async () => {
      const f = fixture();
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));
      expect(await within(dialog).findByText("Alasan minimal 3 karakter")).toBeInTheDocument();
      expect(callsTo(f, "POST", "/api/students/s1/leaves")).toHaveLength(0);
    });

    it("shows the server's overlap message and keeps the dialog open", async () => {
      fixture({
        create: { status: 409, body: { error: "Cuti ini tumpang tindih dengan cuti lain.", code: "LEAVE_OVERLAP" } },
      });
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      await user.type(within(dialog).getByLabelText(/Alasan/), "Pulang kampung");
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));

      expect(await within(dialog).findByText("Cuti ini tumpang tindih dengan cuti lain.")).toBeInTheDocument();
      expect(toast.error).toHaveBeenCalledWith("Cuti ini tumpang tindih dengan cuti lain.");
      expect(screen.getByRole("dialog", { name: "Catat cuti" })).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("turns a 403 into a plain no-access message", async () => {
      fixture({ create: { status: 403, body: { error: "forbidden", missing: "invoices.create" } } });
      const user = userEvent.setup();
      renderSection();
      const dialog = await openCreateDialog(user);
      await user.type(within(dialog).getByLabelText(/Alasan/), "Pulang kampung");
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));
      expect(await within(dialog).findByText("Anda tidak punya akses untuk mencatat cuti.")).toBeInTheDocument();
    });
  });

  describe("after saving", () => {
    const afterCreate = (over: Record<string, unknown>) => ({
      status: 201,
      body: {
        leave: { id: "lv-new" },
        affectedRuns: [],
        openInvoices: [],
        canVoid: false,
        otherActiveEnrollments: false,
        ...over,
      },
    });

    async function createLeave(user: ReturnType<typeof userEvent.setup>) {
      const dialog = await openCreateDialog(user);
      await user.type(within(dialog).getByLabelText(/Alasan/), "Pulang kampung");
      await user.click(within(dialog).getByRole("button", { name: "Catat cuti" }));
    }

    it("tells the admin which drafts were touched", async () => {
      fixture({
        create: afterCreate({
          affectedRuns: [
            { id: "run-1", periodLabel: "Desember 2026", status: "DRAFT" },
            { id: "run-2", periodLabel: "Januari 2027", status: "COMMITTING" },
          ],
        }),
      });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);
      expect(
        await screen.findByText(
          "Draf tagihan Desember 2026 dan Januari 2027 dibuat sebelum cuti ini; siswa dikecualikan. Hitung ulang draf agar biaya lain tetap ditagih.",
        ),
      ).toBeInTheDocument();
    });

    it("shows no draft notice and no follow-up when nothing was touched or open", async () => {
      fixture({ create: afterCreate({}) });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cuti dicatat"));
      expect(screen.queryByText(/Draf tagihan/)).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Tagihan yang masih terbuka" })).not.toBeInTheDocument();
    });

    it("skips the follow-up silently when the server withheld the invoices (no invoice-view right)", async () => {
      fixture({ create: afterCreate({ openInvoices: null }) });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cuti dicatat"));
      expect(screen.queryByRole("dialog", { name: "Tagihan yang masih terbuka" })).not.toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("opens 'Tagihan yang masih terbuka' with a cancel button per invoice when canVoid", async () => {
      fixture({
        create: afterCreate({ openInvoices: [INVOICE], canVoid: true, otherActiveEnrollments: true }),
      });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);

      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      expect(within(dialog).getByText("INV-2026-0042")).toBeInTheDocument();
      expect(within(dialog).getByText(/Desember 2026 · Jatuh tempo/)).toBeInTheDocument();
      expect(within(dialog).getByText("Lewat Tempo")).toBeInTheDocument();
      expect(within(dialog).getByText("Rp 1.500.000")).toBeInTheDocument();
      expect(within(dialog).getByText("SPP Bulanan")).toBeInTheDocument();
      // The one-off line is flagged, the recurring one is not.
      expect(within(dialog).getAllByText("Sekali bayar")).toHaveLength(1);
      expect(
        within(dialog).getByText(/Tagihan ini mungkin memuat biaya kelas lain\. Kalau dibatalkan, buat tagihan baru manual untuk biaya itu\./),
      ).toBeInTheDocument();
      expect(within(dialog).getByText("Tagihan dengan label periode lain tidak ditampilkan.")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Batalkan tagihan" })).toBeInTheDocument();
      // The footer button and the corner X both close it.
      expect(within(dialog).getAllByRole("button", { name: "Tutup" })).toHaveLength(2);
    });

    it("offers no cancel button without the void right, and closing is fine", async () => {
      fixture({ create: afterCreate({ openInvoices: [INVOICE], canVoid: false }) });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);

      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      expect(within(dialog).queryByRole("button", { name: "Batalkan tagihan" })).not.toBeInTheDocument();
      expect(within(dialog).queryByText(/biaya kelas lain/)).not.toBeInTheDocument();
      await user.click(within(dialog).getAllByRole("button", { name: "Tutup" })[0]!);
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Tagihan yang masih terbuka" })).not.toBeInTheDocument(),
      );
    });

    it("cancels an invoice through POST /api/invoices/{id}/void after a confirm, then drops the row and refreshes", async () => {
      const f = fixture({
        create: afterCreate({ openInvoices: [INVOICE, { ...INVOICE, id: "inv-2", invoiceNumber: "INV-2026-0043" }], canVoid: true }),
      });
      const onInvoiceVoided = vi.fn();
      const user = userEvent.setup();
      renderSection({ onInvoiceVoided });
      await createLeave(user);

      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      const [firstButton] = within(dialog).getAllByRole("button", { name: "Batalkan tagihan" });
      await user.click(firstButton!);

      // Asked inside the dialog, not in a second overlay; nothing sent yet.
      expect(within(dialog).getByText("Tagihan tidak bisa dibayar lagi. Riwayat tetap tersimpan.")).toBeInTheDocument();
      expect(callsTo(f, "POST", "/void")).toHaveLength(0);
      await user.click(within(dialog).getByRole("button", { name: "Ya, batalkan" }));

      await waitFor(() => expect(callsTo(f, "POST", "/api/invoices/inv-1/void")).toHaveLength(1));
      expect(toast.success).toHaveBeenCalledWith("Tagihan dibatalkan");
      await waitFor(() => expect(within(dialog).queryByText("INV-2026-0042")).not.toBeInTheDocument());
      expect(within(dialog).getByText("INV-2026-0043")).toBeInTheDocument();
      expect(onInvoiceVoided).toHaveBeenCalledTimes(1);
    });

    it("keeps the invoice and says so when the cancel fails", async () => {
      fixture({
        create: afterCreate({ openInvoices: [INVOICE], canVoid: true }),
        voidInvoice: { status: 409, body: { error: "Tagihan sudah menerima pembayaran." } },
      });
      const user = userEvent.setup();
      renderSection();
      await createLeave(user);
      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      await user.click(within(dialog).getByRole("button", { name: "Batalkan tagihan" }));
      await user.click(within(dialog).getByRole("button", { name: "Ya, batalkan" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tagihan sudah menerima pembayaran."));
      expect(within(dialog).getByText("INV-2026-0042")).toBeInTheDocument();
    });
  });

  describe("Cek tagihan", () => {
    it("reopens the list for an active leave", async () => {
      const f = fixture({
        list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }],
        openInvoices: { body: { openInvoices: [INVOICE], canVoid: true, otherActiveEnrollments: false, note: "x" } },
      });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Cek tagihan" }));
      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      expect(callsTo(f, "GET", "/api/students/s1/leaves/lv-1/open-invoices")).toHaveLength(1);
      expect(within(dialog).getByText("INV-2026-0042")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Batalkan tagihan" })).toBeInTheDocument();
    });

    it("says so when nothing is open", async () => {
      fixture({ list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }] });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Cek tagihan" }));
      const dialog = await screen.findByRole("dialog", { name: "Tagihan yang masih terbuka" });
      expect(within(dialog).getByText("Tidak ada tagihan yang masih terbuka untuk bulan cuti ini.")).toBeInTheDocument();
    });

    it("answers a 403 with a plain toast instead of a dialog", async () => {
      fixture({
        list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }],
        openInvoices: { status: 403, body: { error: "forbidden" } },
      });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Cek tagihan" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Anda tidak punya akses untuk melihat tagihan."));
      expect(screen.queryByRole("dialog", { name: "Tagihan yang masih terbuka" })).not.toBeInTheDocument();
    });
  });

  describe("Batalkan cuti", () => {
    it("asks first, then PUTs INACTIVE and reloads the list", async () => {
      const f = fixture({
        list: [
          { body: { data: [leave()], enrollments: [DAYCARE] } },
          { body: { data: [leave({ status: "INACTIVE", cancelledAt: "2026-12-16T00:00:00.000Z" })], enrollments: [DAYCARE] } },
        ],
      });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Batalkan cuti" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Batalkan cuti?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          "Siswa akan ditagih lagi di tagihan berikutnya. Tagihan yang sudah dibatalkan tidak dibuat ulang otomatis.",
        ),
      ).toBeInTheDocument();
      expect(callsTo(f, "PUT", "/leaves/lv-1")).toHaveLength(0);

      await user.click(within(dialog).getByRole("button", { name: "Ya, batalkan" }));
      await waitFor(() => expect(callsTo(f, "PUT", "/api/students/s1/leaves/lv-1")).toHaveLength(1));
      expect(bodyOf(callsTo(f, "PUT", "/leaves/lv-1")[0]!)).toEqual({ status: "INACTIVE" });
      expect(toast.success).toHaveBeenCalledWith("Cuti dibatalkan");
      expect(await screen.findByText("Dibatalkan")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Batalkan cuti" })).not.toBeInTheDocument();
    });

    it("tells the admin to recalculate drafts that may still exclude the student", async () => {
      fixture({
        list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }],
        cancel: { body: { leave: { id: "lv-1" }, affectedRuns: [{ id: "run-1", periodLabel: "Desember 2026", status: "DRAFT" }] } },
      });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Batalkan cuti" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Ya, batalkan" }));
      expect(await screen.findByText(/Kalau ada draf tagihan Desember 2026/)).toHaveTextContent("hitung ulang draf");
    });

    it("keeps the question open and toasts when the server refuses", async () => {
      fixture({
        list: [{ body: { data: [leave()], enrollments: [DAYCARE] } }],
        cancel: { status: 500, body: { error: "Terjadi kesalahan server" } },
      });
      const user = userEvent.setup();
      renderSection();
      await user.click(await screen.findByRole("button", { name: "Batalkan cuti" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Ya, batalkan" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });
});
