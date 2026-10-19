/**
 * T4 — "Jadikan wali utama" dossier wiring.
 *
 * The card action (`components/admin/__tests__/guardian-detail-card.test.tsx`)
 * only proves the button renders and calls back. This file proves the other
 * half: the dossier page turns that callback into a confirm dialog naming
 * both the promoted and the demoted guardian, then a bare
 * `{ isPrimary: true }` PUT to the right guardian, then a refetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentDetailPage from "@/app/admin/students/[id]/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "s1" }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    canEdit: true,
    name: "Aisyah Putri",
    nickname: null,
    dateOfBirth: "2021-01-15",
    gender: null,
    address: null,
    notes: null,
    metadata: null,
    status: "ACTIVE",
    nis: null,
    nisn: null,
    birthPlace: null,
    nik: null,
    kkNumber: null,
    livingWith: null,
    photoUrl: null,
    createdAt: null,
    withdrawalReason: null,
    withdrawalDate: null,
    graduationDate: null,
    enrollments: [],
    guardians: [
      {
        id: "sg-primary",
        relationship: "IBU",
        isPrimary: true,
        childOrder: null,
        status: "ACTIVE",
        parent: {
          id: "p-primary",
          name: "Ibu Fatimah",
          phone: "0811-0000",
          email: "fatimah@example.com",
          whatsapp: "0811-0000",
          nik: null,
          education: null,
          occupation: null,
          employer: null,
          employerAddress: null,
          employerCity: null,
          incomeRange: null,
          childrenTotal: null,
          address: null,
          hasKtp: false,
          hasKk: false,
        },
      },
      {
        id: "sg-secondary",
        relationship: "AYAH",
        isPrimary: false,
        childOrder: null,
        status: "ACTIVE",
        parent: {
          id: "p-secondary",
          name: "Pak Budi",
          phone: "0812-1111",
          email: "budi@example.com",
          whatsapp: "0812-1111",
          nik: null,
          education: null,
          occupation: null,
          employer: null,
          employerAddress: null,
          employerCity: null,
          incomeRange: null,
          childrenTotal: null,
          address: null,
          hasKtp: false,
          hasKk: false,
        },
      },
    ],
    ...overrides,
  };
}

type Calls = { url: string; method: string; body: string | undefined }[];

function stubFetch(student: ReturnType<typeof makeStudent>) {
  const calls: Calls = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });

    if (url === "/api/students/s1") {
      return Promise.resolve({ ok: true, json: async () => student } as Response);
    }
    if (url.startsWith("/api/invoices")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) } as Response);
    }
    if (url.match(/^\/api\/students\/s1\/guardians\/sg-secondary$/) && init?.method === "PUT") {
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
  return { fn, calls };
}

const urlsMatching = (calls: Calls, needle: string) => calls.filter((c) => c.url.includes(needle));

describe("student dossier — Jadikan wali utama (T4)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("keeps the dossier readable while hiding student and guardian mutations for a read-only admin", async () => {
    const { fn, calls } = stubFetch(makeStudent({ canEdit: false }));
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await waitFor(() => expect(screen.getAllByText("Ibu Fatimah").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ganti Foto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Daftarkan ke Kelas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tambah Field" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Jadikan .+ wali utama$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unggah KK di halaman wali →" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lihat data wali →" })).toBeInTheDocument();
    expect(calls.every(call => call.method === "GET")).toBe(true);
  });

  it.each([false, true])("empty sections give only permitted next steps (canEdit=%s)", async canEdit => {
    const { fn } = stubFetch(makeStudent({ canEdit, guardians: [] }));
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);
    await screen.findByRole("heading", { name: "Aisyah Putri" });
    // Said in the closed group's summary, in "Kelas saat ini" and in the Riwayat Kelas empty state.
    for (const where of ["kelas-saat-ini", "riwayat-kelas"]) {
      expect(within(document.getElementById(where)!).getByText("Belum terdaftar di kelas")).toBeInTheDocument();
    }
    expect(screen.getByText("Belum ada data wali")).toBeInTheDocument();
    const instructions = [
      /Klik “Ubah” untuk mengisi/,
      /Klik “Tambah Field” untuk menambahkan/,
      "Daftarkan siswa ke kelas melalui tombol di atas.",
      "Tambahkan orang tua atau wali siswa.",
      "Belum ada wali aktif — tambahkan wali untuk mengunggah KK.",
    ];
    for (const instruction of instructions) {
      if (canEdit) expect(screen.getByText(instruction)).toBeInTheDocument();
      else expect(screen.queryByText(instruction)).not.toBeInTheDocument();
    }
    if (!canEdit) {
      expect(screen.getByText("Belum ada data kesehatan dan kelahiran.")).toBeInTheDocument();
      expect(screen.getByText("Belum ada field tambahan.")).toBeInTheDocument();
      expect(screen.getByText("Belum ada wali aktif.")).toBeInTheDocument();
    }
  });

  it.each([403, 500])("shows the correct recovery for an invoice response of %s", async status => {
    const user = userEvent.setup();
    const { fn: fallback } = stubFetch(makeStudent());
    let invoiceStatus = status;
    let invoiceCalls = 0;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/invoices?")) {
        invoiceCalls += 1;
        return Promise.resolve({ ok: invoiceStatus === 200, status: invoiceStatus,
          json: async () => invoiceStatus === 200 ? { data: [] } : { error: "Synthetic invoice response" },
        } as Response);
      }
      return fallback(input, init);
    }));
    render(<StudentDetailPage />);
    if (status === 403) {
      expect(await screen.findByText("Anda tidak memiliki akses ke data tagihan.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Coba lagi" })).not.toBeInTheDocument();
      expect(screen.queryByText("Gagal memuat data tagihan.")).not.toBeInTheDocument();
      expect(invoiceCalls).toBe(1);
    } else {
      expect(await screen.findByText("Gagal memuat data tagihan.")).toBeInTheDocument();
      invoiceStatus = 200;
      await user.click(screen.getByRole("button", { name: "Coba lagi" }));
      expect(await screen.findByText("Belum ada tagihan")).toBeInTheDocument();
      expect(invoiceCalls).toBe(2);
    }
  });

  it("confirms naming both guardians, then PUTs a bare isPrimary:true to the promoted guardian", async () => {
    const user = userEvent.setup();
    const student = makeStudent();
    const { fn, calls } = stubFetch(student);
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("Ibu Fatimah").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Pak Budi").length).toBeGreaterThan(0);

    // Only the non-primary guardian (Pak Budi) exposes the action.
    const promoteButtons = screen.getAllByRole("button", { name: /^Jadikan .+ wali utama$/ });
    expect(promoteButtons).toHaveLength(1);
    await user.click(promoteButtons[0]);

    // Confirm dialog names both the guardian being promoted and the one
    // being demoted.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Pak Budi");
    expect(dialog).toHaveTextContent("Ibu Fatimah");

    await user.click(screen.getByRole("button", { name: "Jadikan Wali Utama" }));

    await waitFor(() =>
      expect(urlsMatching(calls, "/api/students/s1/guardians/sg-secondary")).toHaveLength(1),
    );
    const putCall = urlsMatching(calls, "/api/students/s1/guardians/sg-secondary")[0];
    expect(putCall.method).toBe("PUT");
    expect(putCall.body).toBe(JSON.stringify({ isPrimary: true }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Pak Budi kini wali utama"));
    // Refetch after the mutation.
    await waitFor(() => expect(urlsMatching(calls, "/api/students/s1").length).toBeGreaterThan(1));
  });

  it("omits the demotion sentence when there is no current primary", async () => {
    const user = userEvent.setup();
    const student = makeStudent({
      guardians: [
        {
          id: "sg-secondary",
          relationship: "AYAH",
          isPrimary: false,
          childOrder: null,
          status: "ACTIVE",
          parent: {
            id: "p-secondary",
            name: "Pak Budi",
            phone: "0812-1111",
            email: "budi@example.com",
            whatsapp: "0812-1111",
            nik: null,
            education: null,
            occupation: null,
            employer: null,
            employerAddress: null,
            employerCity: null,
            incomeRange: null,
            childrenTotal: null,
            address: null,
            hasKtp: false,
            hasKk: false,
          },
        },
      ],
    });
    const { fn } = stubFetch(student);
    vi.stubGlobal("fetch", fn);
    render(<StudentDetailPage />);

    await waitFor(() => expect(screen.getAllByText("Pak Budi").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("button", { name: /^Jadikan .+ wali utama$/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Pak Budi");
    expect(dialog).not.toHaveTextContent("menggantikan");
  });
});
