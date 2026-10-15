/**
 * "Ubah data" editor on the admin enrollment detail page: what it shows, the
 * PATCH body it builds (only what changed, blank = clear), how server field
 * errors land on inputs, and the toasts that follow a save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EnrollmentApplicationEditor, type EditorApplication } from "../enrollment-application-editor";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const guard = vi.hoisted(() => vi.fn());
vi.mock("@/components/admin/unsaved-changes-provider", () => ({ useUnsavedChangesGuard: guard }));

const PROGRAMS = [
  { id: "p-tka", code: "TKA", name: "TK A", enrollmentFee: 300_000 },
  { id: "p-tkb", code: "TKB", name: "TK B", enrollmentFee: 400_000 },
  { id: "p-dcare", code: "DCARE", name: "Day Care", enrollmentFee: 100_000 },
  { id: "p-free", code: "GRATIS", name: "Program Gratis", enrollmentFee: 0 },
];

const feeOf = (status: AdminFeeView["status"], amount = 300_000): AdminFeeView => ({
  status,
  method: null,
  baseAmount: amount,
  discountPercent: 0,
  discountReason: null,
  amount,
  paidAt: null,
  note: null,
  linkError: null,
  lastCheckedAt: null,
  linkActive: false,
});

const application: EditorApplication = {
  id: "app-1",
  studentData: {
    childName: "Aisyah Putri",
    nickname: "Aisy",
    childGender: "P",
    birthPlace: "Bandung",
    dateOfBirth: "2021-03-15",
    agama: "ISLAM",
    kewarganegaraan: "WNI",
    weightKg: 14.5,
    address: { perumahan: "Griya Asri", kodePos: "40123" },
    priorFamilyAttendees: [],
  },
  ayahData: { name: "Budi Santoso", phone: "081234567890", email: "budi@example.com" },
  ibuData: { name: "Siti Rahma", phone: "081200000000" },
  consentData: { agreed: true },
  program: { id: "p-tka", name: "TK A" },
  dcareAddon: false,
  fee: feeOf("UNPAID"),
  canAdjustFee: true,
};

let configMode: "ok" | "fail" | "pending";
type Reply = { status?: number; body?: unknown } | "network";
let patchReply: Reply;
const patchBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));

const fetchMock = vi.fn();

/** A named section (`Data anak`, `Data Ayah`, `Data Ibu`, `Program & Day Care`). */
const region = (name: string) => within(screen.getByRole("region", { name }));

function setup(over: Partial<EditorApplication> = {}) {
  const onDone = vi.fn();
  render(<EnrollmentApplicationEditor application={{ ...application, ...over }} onDone={onDone} />);
  return { onDone, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  patchReply = { body: { id: "app-1", status: "INVITED" } };
  configMode = "ok";
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const reply = patchReply;
      if (reply === "network") throw new TypeError("Failed to fetch");
      const status = reply.status ?? 200;
      return { ok: status < 400, status, json: async () => reply.body ?? {} } as Response;
    }
    if (url === "/api/config/enrollment") {
      if (configMode === "pending") return new Promise<Response>(() => {});
      if (configMode === "fail") return { ok: false, status: 500, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => ({ programs: PROGRAMS }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("EnrollmentApplicationEditor — seeded values", () => {
  it("fills every section from the stored application", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "Ubah data formulir" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nama lengkap")).toHaveValue("Aisyah Putri");
    expect(screen.getByLabelText("Nama panggilan")).toHaveValue("Aisy");
    expect(screen.getByLabelText("Jenis kelamin")).toHaveValue("P");
    expect(region("Data anak").getByLabelText("Tanggal lahir")).toHaveValue("2021-03-15");
    expect(screen.getByLabelText("Berat badan (kg)")).toHaveValue(14.5);
    expect(region("Data anak").getByLabelText("Perumahan / Jalan")).toHaveValue("Griya Asri");
    expect(region("Data Ayah").getByLabelText("No. HP")).toHaveValue("081234567890");
    expect(region("Data Ibu").getByLabelText("No. HP")).toHaveValue("081200000000");
    expect(region("Data Ayah").getByLabelText("Email")).toHaveValue("budi@example.com");
    // Program arrives from the config endpoint.
    await waitFor(() => expect(screen.getByRole("option", { name: "TK B" })).toBeInTheDocument());
    expect(screen.getByLabelText("Program")).toHaveValue("p-tka");
  });

  it("moves focus to the editor heading so the change is announced", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Ubah data formulir" })).toHaveFocus();
  });
});

describe("EnrollmentApplicationEditor — save", () => {
  it("sends only the fields that changed; a blank clears", async () => {
    const { user, onDone } = setup();
    await user.clear(screen.getByLabelText("Nama panggilan"));
    await user.type(screen.getByLabelText("Nama panggilan"), "Aisyah");
    const ayahPhone = region("Data Ayah").getByLabelText("No. HP");
    await user.clear(ayahPhone);
    await user.type(ayahPhone, "0856 1111 2222");
    await user.clear(region("Data Ayah").getByLabelText("Email")); // clearing an email
    await user.clear(region("Data anak").getByLabelText("Kode pos")); // clearing one address part
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith("saved"));
    expect(patchBodies()).toEqual([
      {
        studentData: { nickname: "Aisyah", address: { kodePos: "" } },
        ayahData: { phone: "0856 1111 2222", email: "" },
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Data formulir disimpan.", undefined);
  });

  it("sends the program, Day Care and who fills the form as top-level changes", async () => {
    const { user } = setup();
    await waitFor(() => expect(screen.getByRole("option", { name: "TK B" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Program"), "p-tkb");
    await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
    await user.selectOptions(screen.getByLabelText("Pengisi formulir"), "ayah");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0]).toEqual({
      consentData: { onlyParent: "ayah" },
      programId: "p-tkb",
      dcareAddon: true,
    });
  });

  it("sends nothing when nothing changed", async () => {
    const { user, onDone } = setup();
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("cancelled"));
    expect(patchBodies()).toHaveLength(0);
    expect(toast.info).toHaveBeenCalledWith("Tidak ada perubahan untuk disimpan.");
  });

  it("adds a prior-family row and sends the list", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Tambah" }));
    await user.type(screen.getByLabelText("Nama (1)"), "Kakak Rani");
    await user.type(screen.getByLabelText("Tahun masuk (1)"), "2019");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0]).toEqual({
      studentData: { priorFamilyAttendees: [{ name: "Kakak Rani", yearEntered: "2019" }] },
    });
  });
});

describe("EnrollmentApplicationEditor — address", () => {
  it("shows the eight address boxes in order for each person and seeds the region keys", () => {
    setup({ studentData: { ...(application.studentData as object), address: { kodePos: "40115", kelurahan: "Citarum", kotaKab: "Kota Bandung", provinsi: "Jawa Barat" } } });
    const anak = region("Data anak");
    expect(anak.getByLabelText("Kelurahan / Desa")).toHaveValue("Citarum");
    expect(anak.getByLabelText("Kota / Kabupaten")).toHaveValue("Kota Bandung");
    expect(anak.getByLabelText("Provinsi")).toHaveValue("Jawa Barat");
    const labels = ["Perumahan / Jalan", "Blok / Cluster", "RT / RW", "Kode pos", "Kelurahan / Desa", "Kecamatan", "Kota / Kabupaten", "Provinsi"];
    const inputs = labels.map((l) => anak.getByLabelText(l));
    for (let i = 1; i < inputs.length; i++) {
      expect(inputs[i - 1].compareDocumentPosition(inputs[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const section of ["Data Ayah", "Data Ibu"]) {
      for (const l of labels) expect(region(section).getByLabelText(l)).toBeInTheDocument();
    }
  });

  it("sends an edited region key under address", async () => {
    const { user } = setup();
    await user.type(region("Data Ayah").getByLabelText("Kota / Kabupaten"), "Kota Bekasi");
    await user.type(region("Data Ibu").getByLabelText("Provinsi"), "Jawa Barat");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(patchBodies()).toHaveLength(1));
    expect(patchBodies()[0]).toEqual({
      ayahData: { address: { kotaKab: "Kota Bekasi" } },
      ibuData: { address: { provinsi: "Jawa Barat" } },
    });
  });
});

describe("EnrollmentApplicationEditor — validation", () => {
  it("shows a malformed phone inline and saves nothing", async () => {
    const { user, onDone } = setup();
    const phone = region("Data Ayah").getByLabelText("No. HP");
    await user.clear(phone);
    await user.type(phone, "abc");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    const error = await screen.findByText("Nomor telepon tidak valid");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone.getAttribute("aria-describedby")).toContain(error.id);
    expect(phone).toHaveFocus();
    expect(patchBodies()).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("rejects a malformed email and a bad number the same way", async () => {
    const { user } = setup();
    const email = region("Data Ibu").getByLabelText("Email");
    await user.type(email, "bukan-email");
    await user.type(screen.getByLabelText("Tinggi badan (cm)"), "-5");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByText("Email tidak valid")).toBeInTheDocument();
    expect(screen.getByText("Tinggi badan tidak valid")).toBeInTheDocument();
    expect(patchBodies()).toHaveLength(0);
  });

  it("lets staff clear a field the parent form would require", async () => {
    const { user, onDone } = setup();
    await user.clear(region("Data anak").getByLabelText("Tempat lahir"));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("saved"));
    expect(patchBodies()[0]).toEqual({ studentData: { birthPlace: "" } });
  });
});

describe("EnrollmentApplicationEditor — server answers", () => {
  it("lands server field errors on the matching inputs and stays in edit mode", async () => {
    patchReply = {
      status: 400,
      body: {
        error: "Validasi gagal",
        errors: [
          { field: "ayahData.phone", message: "Nomor telepon tidak valid" },
          { field: "studentData.address.kodePos", message: "Kode pos terlalu panjang" },
        ],
      },
    };
    const { user, onDone } = setup();
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    expect(await screen.findByText("Kode pos terlalu panjang")).toBeInTheDocument();
    expect(screen.getByText("Nomor telepon tidak valid")).toBeInTheDocument();
    expect(region("Data anak").getByLabelText("Kode pos")).toHaveAttribute("aria-invalid", "true");
    expect(region("Data Ayah").getByLabelText("No. HP")).toHaveAttribute("aria-invalid", "true");
    expect(toast.error).toHaveBeenCalledWith("Gagal menyimpan. Periksa kolom yang ditandai.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("repriced: second toast line names the new amount", async () => {
    patchReply = { body: { id: "app-1", status: "INVITED", feeNote: "repriced", fee: feeOf("UNPAID", 400_000) } };
    const { user, onDone } = setup();
    await waitFor(() => expect(screen.getByRole("option", { name: "TK B" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Program"), "p-tkb");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("saved"));
    expect(toast.success).toHaveBeenCalledWith("Data formulir disimpan.", {
      description: "Biaya pendaftaran dihitung ulang: Rp 400.000",
    });
  });

  it.each([
    ["unchanged_paid", "Biaya sudah lunas, tidak berubah."],
    ["unchanged_waived", "Biaya sudah dibebaskan, tidak berubah."],
    ["unchanged_inactive_program", "Program sudah tidak aktif, biaya tidak berubah."],
  ])("%s: says the fee did not move", async (feeNote, line) => {
    patchReply = { body: { id: "app-1", status: "INVITED", feeNote, fee: feeOf("PAID") } };
    const { user, onDone } = setup({ fee: feeOf("PAID") });
    await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("saved"));
    expect(toast.success).toHaveBeenCalledWith("Data formulir disimpan.", { description: line });
  });

  it("409 (converted meanwhile): shows the server message and leaves edit mode", async () => {
    patchReply = { status: 409, body: { error: "Pendaftaran ini sudah dikonversi menjadi siswa dan tidak bisa diubah." } };
    const { user, onDone } = setup();
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("locked"));
    expect(toast.error).toHaveBeenCalledWith("Pendaftaran ini sudah dikonversi menjadi siswa dan tidak bisa diubah.");
  });

  it("network failure: friendly message, never the raw error", async () => {
    patchReply = "network";
    const { user, onDone } = setup();
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Gagal menyimpan. Periksa koneksi, lalu coba lagi.");
    expect(document.body).not.toHaveTextContent("Failed to fetch");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("EnrollmentApplicationEditor — cancel", () => {
  it("leaves at once when nothing was touched", async () => {
    const { user, onDone } = setup();
    await user.click(screen.getByRole("button", { name: "Batal" }));
    expect(onDone).toHaveBeenCalledWith("cancelled");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks before discarding edits; keep editing sends nothing", async () => {
    const { user, onDone } = setup();
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await user.click(screen.getByRole("button", { name: "Batal" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Buang perubahan?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Lanjut mengubah" }));
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Batal" }));
    await user.click(await within(await screen.findByRole("alertdialog")).findByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("cancelled"));
    expect(patchBodies()).toHaveLength(0);
  });
});

describe("EnrollmentApplicationEditor — program, Day Care and fee", () => {
  it("previews the fee from the chosen program and Day Care", async () => {
    const { user } = setup({ fee: null });
    await waitFor(() => expect(screen.getByTestId("fee-summary")).toHaveTextContent("Rp 300.000"));
    await user.click(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" }));
    expect(screen.getByTestId("fee-summary")).toHaveTextContent("Rp 400.000");
    await user.selectOptions(screen.getByLabelText("Program"), "p-tkb");
    expect(screen.getByTestId("fee-summary")).toHaveTextContent("Rp 500.000");
  });

  it("says an unpaid fee is recalculated", async () => {
    setup({ fee: feeOf("UNPAID") });
    expect(screen.getByText("Biaya belum lunas akan dihitung ulang.")).toBeInTheDocument();
  });

  it("says a paid fee keeps its amount and shows the recorded one", async () => {
    setup({ fee: feeOf("PAID", 300_000) });
    expect(screen.getByText("Biaya sudah lunas, nominal tidak berubah.")).toBeInTheDocument();
    expect(screen.getByTestId("fee-summary")).toHaveTextContent("Rp 300.000");
  });

  it("says a waived fee keeps its amount", async () => {
    setup({ fee: feeOf("WAIVED") });
    expect(screen.getByText("Biaya sudah dibebaskan, nominal tidak berubah.")).toBeInTheDocument();
  });

  it("keeps a retired program selectable instead of dropping it", async () => {
    setup({ program: { id: "p-old", name: "TK Lama" } });
    expect(await screen.findByRole("option", { name: "TK Lama (tidak aktif)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toHaveValue("p-old");
  });

  it("explains when the program list cannot be loaded", async () => {
    configMode = "fail";
    setup();
    expect(await screen.findByText(/Daftar program belum bisa dimuat/)).toBeInTheDocument();
  });
});

describe("EnrollmentApplicationEditor — fee preview never overclaims", () => {
  const summary = () => screen.getByTestId("fee-summary");

  it("says the fee is loading while the program list is on its way", () => {
    configMode = "pending";
    setup({ fee: null });
    expect(summary()).toHaveTextContent("Memuat biaya…");
    expect(summary()).not.toHaveTextContent("tanpa biaya");
  });

  it("asks for a program when none is chosen", async () => {
    setup({ fee: null, program: null });
    await waitFor(() => expect(summary()).toHaveTextContent("Pilih program untuk melihat perkiraan biaya."));
  });

  it("is neutral when the list failed to load", async () => {
    configMode = "fail";
    setup({ fee: null });
    await waitFor(() => expect(summary()).toHaveTextContent("Perkiraan biaya belum tersedia."));
    expect(summary()).not.toHaveTextContent("tanpa biaya");
  });

  it("is neutral for a program that is not in the active list (retired)", async () => {
    setup({ fee: null, program: { id: "p-old", name: "TK Lama" } });
    await waitFor(() => expect(summary()).toHaveTextContent("Perkiraan biaya belum tersedia."));
    expect(summary()).not.toHaveTextContent("tanpa biaya");
  });

  it("says free only for a loaded program whose fee is 0", async () => {
    setup({ fee: null, program: { id: "p-free", name: "Program Gratis" } });
    await waitFor(() => expect(summary()).toHaveTextContent("Program ini tanpa biaya pendaftaran."));
  });

  it("an auto-waived fee (free program) explains it will be recalculated for a paid program", () => {
    setup({ fee: { ...feeOf("WAIVED", 0), note: "Program tanpa biaya pendaftaran" } });
    expect(
      screen.getByText("Biaya dibebaskan karena program gratis; akan dihitung ulang jika Anda memilih program berbiaya."),
    ).toBeInTheDocument();
    expect(summary()).not.toHaveTextContent("tercatat");
  });
});

describe("EnrollmentApplicationEditor — finance permission", () => {
  it("without fees.edit, an unpaid fee locks Program and Day Care with a reason", async () => {
    setup({ canAdjustFee: false });
    expect(screen.getByLabelText("Program")).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Tambahan Day Care (penitipan)" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Mengubah program mengubah biaya; butuh izin keuangan.")).toBeInTheDocument();
  });

  it("without fees.edit, a paid fee leaves the controls open (nothing reprices)", () => {
    setup({ canAdjustFee: false, fee: feeOf("PAID") });
    expect(screen.getByLabelText("Program")).toBeEnabled();
    expect(screen.queryByText("Mengubah program mengubah biaya; butuh izin keuangan.")).not.toBeInTheDocument();
  });

  it("with fees.edit the controls are open", () => {
    setup();
    expect(screen.getByLabelText("Program")).toBeEnabled();
  });

  it("the server's 403 lands in the form-level error", async () => {
    patchReply = { status: 403, body: { error: "Mengubah program mengubah biaya pendaftaran; butuh izin keuangan." } };
    const { user, onDone } = setup();
    await waitFor(() => expect(screen.getByRole("option", { name: "TK B" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Program"), "p-tkb");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mengubah program mengubah biaya pendaftaran; butuh izin keuangan.");
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("EnrollmentApplicationEditor — only the changed fields are validated", () => {
  const legacy = {
    studentData: { ...application.studentData as object, agama: "islam", dateOfBirth: "15 Maret 2021" },
    ayahData: { name: "Budi Santoso", phone: "08-ab" },
  };

  it("a stored value that is invalid or outside the option list does not block Save", async () => {
    const { user, onDone } = setup(legacy);
    // The unknown stored option stays visible instead of being swallowed.
    expect(region("Data anak").getByLabelText("Agama")).toHaveValue("islam");
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("saved"));
    expect(patchBodies()).toEqual([{ studentData: { nickname: "Aisyx" } }]);
  });

  it("but a field staff do change is still checked", async () => {
    const { user } = setup(legacy);
    const phone = region("Data Ayah").getByLabelText("No. HP");
    await user.clear(phone);
    await user.type(phone, "abc");
    await user.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(await screen.findByText("Nomor telepon tidak valid")).toBeInTheDocument();
    expect(patchBodies()).toHaveLength(0);
  });
});

describe("EnrollmentApplicationEditor — unsaved-changes guard", () => {
  it("registers as dirty only once something was edited", async () => {
    const { user } = setup();
    expect(guard).toHaveBeenLastCalledWith(false, expect.any(String));
    await user.type(screen.getByLabelText("Nama panggilan"), "x");
    await waitFor(() => expect(guard).toHaveBeenLastCalledWith(true, expect.any(String)));
  });
});

describe("EnrollmentApplicationEditor — structure", () => {
  it("names the sections and sub-groups", () => {
    setup();
    for (const name of ["Data anak", "Data Ayah", "Data Ibu", "Program & Day Care"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("region", { name: "Data Ayah" })).getByRole("group", { name: "Alamat" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Data anak" })).getByRole("group", { name: "Jumlah saudara" })).toBeInTheDocument();
  });

  it("whole-number fields get the numeric keypad; weight keeps the decimal one", () => {
    setup();
    expect(screen.getByLabelText("Saudara kandung")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Anak ke-")).toHaveAttribute("inputmode", "numeric");
    expect(screen.getByLabelText("Berat badan (kg)")).toHaveAttribute("inputmode", "decimal");
  });
});
