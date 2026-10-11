import { describe, it, expect } from "vitest";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import {
  createStudentSchema,
  updateStudentSchema,
  studentFormSchema,
  enrollStudentSchema,
} from "../student";
import { createGuardianSchema, updateGuardianSchema, guardianUpdateFormSchema } from "../guardian";
import { updateParentSchema } from "../parent";
import { createEmployeeSchema, updateEmployeeSchema, employeeEditFormSchema } from "../employee";
import { createAdmissionSchema, updateAdmissionSchema } from "../admission";
import { noteBodySchema, noteUpdateSchema } from "../student-journal";
import { createLeaveRequestSchema, rejectLeaveRequestSchema } from "../leave";
import {
  recordPaymentSchema,
  invoicePaymentFormSchema,
  createManualInvoiceSchema,
  manualInvoiceFormSchema,
  generatePlanSchema,
  generateBatchSchema,
} from "../invoice";

const NUL = "Nul\u0000Byte";
const HUGE = "A".repeat(200_000);
const NAMES = ["An Nisaa' Ibrâhim", "Siti Nurhaliza", "محمد عبد الله", "Zoë Müller-Çelik"];

describe("student schemas (STR-7)", () => {
  it.each(NAMES)("createStudentSchema accepts %s", (name) => {
    expect(createStudentSchema.safeParse({ name }).success).toBe(true);
  });

  it("createStudentSchema trims name and rejects blank / NUL / huge", () => {
    const ok = createStudentSchema.safeParse({ name: "  Aisyah  " });
    expect(ok.success && ok.data.name).toBe("Aisyah");
    expect(createStudentSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createStudentSchema.safeParse({ name: NUL }).success).toBe(false);
    expect(createStudentSchema.safeParse({ name: HUGE }).success).toBe(false);
  });

  it("createStudentSchema keeps optional/nullable semantics on optional text fields", () => {
    const r = createStudentSchema.safeParse({
      name: "Budi",
      nickname: null,
      address: "",
      notes: undefined,
      nis: null,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nickname).toBeNull();
      expect(r.data.address).toBe("");
      expect(r.data.notes).toBeUndefined();
    }
  });

  it("bounds address/notes at 2000 and rejects NUL in them", () => {
    expect(createStudentSchema.safeParse({ name: "B", address: "x".repeat(2000) }).success).toBe(true);
    expect(createStudentSchema.safeParse({ name: "B", address: "x".repeat(2001) }).success).toBe(false);
    expect(createStudentSchema.safeParse({ name: "B", notes: "a\u0000b" }).success).toBe(false);
  });

  it("nested guardians are bounded too and keep their default relationship", () => {
    const r = createStudentSchema.safeParse({ name: "B", guardians: [{ name: "Ibu Siti" }] });
    expect(r.success && r.data.guardians?.[0].relationship).toBe("WALI");
    expect(createStudentSchema.safeParse({ name: "B", guardians: [{ name: HUGE }] }).success).toBe(false);
    expect(createStudentSchema.safeParse({ name: "B", guardians: [{ name: NUL }] }).success).toBe(false);
  });

  it("updateStudentSchema stays partial: an omitted name stays omitted, a bad one is rejected", () => {
    const r = updateStudentSchema.safeParse({ status: "INACTIVE" });
    expect(r.success).toBe(true);
    if (r.success) expect("name" in r.data).toBe(false);
    expect(updateStudentSchema.safeParse({ name: NUL }).success).toBe(false);
    expect(updateStudentSchema.safeParse({ withdrawalReason: "   " }).success).toBe(false);
  });

  it("studentFormSchema still turns blank optionals into null and enforces the bounds", () => {
    const r = studentFormSchema.safeParse({
      name: "  Budi  ",
      nickname: "  ",
      dateOfBirth: "",
      gender: "",
      address: "",
      notes: "",
      nis: "",
      nisn: "",
      birthPlace: "",
      nik: "",
      kkNumber: "",
      livingWith: "",
      status: "ACTIVE",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Budi");
      expect(r.data.nickname).toBeNull();
      expect(r.data.address).toBeNull();
      expect(r.data.livingWith).toBeNull();
      expect(r.data.gender).toBeNull();
    }
    const base = { name: "B", status: "ACTIVE" };
    expect(studentFormSchema.safeParse({ ...base, address: HUGE }).success).toBe(false);
    expect(studentFormSchema.safeParse({ ...base, nickname: NUL }).success).toBe(false);
  });

  it("enrollStudentSchema bounds the age-override reason", () => {
    expect(enrollStudentSchema.safeParse({ classSectionId: "c1", ageOverrideReason: "x".repeat(501) }).success).toBe(false);
    expect(enrollStudentSchema.safeParse({ classSectionId: "c1" }).success).toBe(true);
  });
});

describe("guardian / parent schemas (STR-7)", () => {
  const base = { name: "Ibu Siti", relationship: "IBU" as const };

  it.each(NAMES)("createGuardianSchema accepts %s", (name) => {
    expect(createGuardianSchema.safeParse({ ...base, name }).success).toBe(true);
  });

  it("rejects NUL, over-120 names, trims", () => {
    expect(createGuardianSchema.safeParse({ ...base, name: NUL }).success).toBe(false);
    expect(createGuardianSchema.safeParse({ ...base, name: "A".repeat(121) }).success).toBe(false);
    const r = createGuardianSchema.safeParse({ ...base, name: "  Ibu Siti " });
    expect(r.success && r.data.name).toBe("Ibu Siti");
  });

  it("keeps the existing per-field maxima and empty-string tolerance", () => {
    expect(createGuardianSchema.safeParse({ ...base, phone: "" }).success).toBe(true);
    expect(createGuardianSchema.safeParse({ ...base, phone: "1".repeat(21) }).success).toBe(false);
    expect(createGuardianSchema.safeParse({ ...base, address: "x".repeat(501) }).success).toBe(false);
    expect(createGuardianSchema.safeParse({ ...base, address: "a\u0000" }).success).toBe(false);
    expect(createGuardianSchema.safeParse({ ...base, occupation: null }).success).toBe(true);
  });

  it("update schemas stay partial and bounded", () => {
    expect(updateGuardianSchema.safeParse({}).success).toBe(true);
    expect(updateGuardianSchema.safeParse({ name: HUGE }).success).toBe(false);
    expect(updateParentSchema.safeParse({}).success).toBe(true);
    expect(updateParentSchema.safeParse({ name: NUL }).success).toBe(false);
    expect(guardianUpdateFormSchema.safeParse({ name: "   ", childrenTotal: "", childOrder: "" }).success).toBe(false);
  });
});

describe("employee schemas (STR-7)", () => {
  const base = {
    nama: "Ustadzah Fatimah",
    email: "fatimah@example.com",
    jabatan: "Guru Kelas",
    campusId: "camp-1",
    hireDate: "2026-01-05",
  };

  it("accepts a normal employee and trims names", () => {
    const r = createEmployeeSchema.safeParse({ ...base, nama: "  Ustadzah Fatimah " });
    expect(r.success && r.data.nama).toBe("Ustadzah Fatimah");
  });

  it("rejects NUL / huge names, jabatan and bank fields", () => {
    expect(createEmployeeSchema.safeParse({ ...base, nama: NUL }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, nama: HUGE }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, jabatan: HUGE }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, bankName: "Bank", bankAccountNo: "1".repeat(51) }).success).toBe(false);
  });

  it("partial update does not resurrect defaults and still bounds present fields", () => {
    const r = updateEmployeeSchema.safeParse({ jabatan: "Kepala Sekolah" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("bpjsEnrolled" in r.data).toBe(false);
      expect("role" in r.data).toBe(false);
    }
    expect(updateEmployeeSchema.safeParse({ nama: NUL }).success).toBe(false);
  });

  it("edit form schema keeps required messages", () => {
    const r = employeeEditFormSchema.safeParse({ nama: "  ", email: "a@b.co", jabatan: "x", campusId: "c", hireDate: "2026-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Nama wajib diisi");
  });
});

describe("admission schemas (STR-7)", () => {
  const base = { childName: "Ahmad", parentName: "Bapak Budi", parentPhone: "081234567890" };

  it("accepts the minimal payload and trims names", () => {
    const r = createAdmissionSchema.safeParse({ childName: "  Ahmad ", parentName: "  Bapak Budi ", parentPhone: "0812" });
    expect(r.success && r.data.childName).toBe("Ahmad");
    expect(r.success && r.data.parentName).toBe("Bapak Budi");
  });

  it("keeps empty-string → undefined for optional fields", () => {
    const r = createAdmissionSchema.safeParse({ ...base, parentEmail: "", notes: "", dateOfBirth: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.parentEmail).toBeUndefined();
      expect(r.data.notes).toBeUndefined();
      expect(r.data.dateOfBirth).toBeUndefined();
    }
  });

  it("rejects NUL / huge values", () => {
    expect(createAdmissionSchema.safeParse({ ...base, childName: NUL }).success).toBe(false);
    expect(createAdmissionSchema.safeParse({ ...base, parentName: HUGE }).success).toBe(false);
    expect(createAdmissionSchema.safeParse({ ...base, notes: "x".repeat(2001) }).success).toBe(false);
    expect(createAdmissionSchema.safeParse({ ...base, parentPhone: HUGE }).success).toBe(false);
  });

  it("update never invents keys the client did not send", () => {
    const r = updateAdmissionSchema.safeParse({ status: "VISITED" });
    expect(r.success).toBe(true);
    if (r.success) expect("source" in r.data).toBe(false);
  });
});

describe("journal notes (STR-17)", () => {
  const base = { studentId: "s1", date: "2026-07-17" };

  it("rejects whitespace-only bodies with the Indonesian message", () => {
    for (const body of ["", "   ", "\n\t "]) {
      const r = noteBodySchema.safeParse({ ...base, body });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe("Catatan tidak boleh kosong.");
    }
    expect(noteUpdateSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("trims a valid note, allows newlines, rejects NUL and >2000", () => {
    const r = noteBodySchema.safeParse({ ...base, body: "  Hari ini sabar\nsekali  " });
    expect(r.success && r.data.body).toBe("Hari ini sabar\nsekali");
    expect(noteBodySchema.safeParse({ ...base, body: "a\u0000b" }).success).toBe(false);
    expect(noteUpdateSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("leave schema (STR-13)", () => {
  const base = { leaveType: "ANNUAL" as const, startDate: "2026-07-20", endDate: "2026-07-22", reason: "Acara keluarga" };

  it("accepts real dates", () => {
    expect(createLeaveRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects impossible and out-of-window dates", () => {
    expect(createLeaveRequestSchema.safeParse({ ...base, startDate: "2026-02-30" }).success).toBe(false);
    expect(createLeaveRequestSchema.safeParse({ ...base, endDate: "1900-01-01" }).success).toBe(false);
    expect(createLeaveRequestSchema.safeParse({ ...base, startDate: "20-07-2026" }).success).toBe(false);
  });

  it("bounds the reason and rejects NUL", () => {
    expect(createLeaveRequestSchema.safeParse({ ...base, reason: "   " }).success).toBe(false);
    expect(createLeaveRequestSchema.safeParse({ ...base, reason: "a\u0000" }).success).toBe(false);
    expect(rejectLeaveRequestSchema.safeParse({ note: HUGE }).success).toBe(false);
  });
});

describe("invoice / payment schemas (STR-7, STR-13)", () => {
  it("recordPaymentSchema: coerced whole-rupiah amounts only", () => {
    const ok = recordPaymentSchema.safeParse({ amount: "150000" });
    expect(ok.success && ok.data.amount).toBe(150000);
    expect(ok.success && ok.data.method).toBe("CASH");
    expect(recordPaymentSchema.safeParse({ amount: 0.001 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 1e13 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: "1e13" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 1_000_000_000 }).success).toBe(true);
  });

  it("recordPaymentSchema: reference / notes trimmed, bounded, NUL-free; null still allowed", () => {
    const r = recordPaymentSchema.safeParse({ amount: 1000, reference: "  TRX-1 ", notes: null });
    expect(r.success && r.data.reference).toBe("TRX-1");
    expect(r.success && r.data.notes).toBeNull();
    expect(recordPaymentSchema.safeParse({ amount: 1000, reference: HUGE }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 1000, notes: "a\u0000b" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ amount: 1000, notes: "x".repeat(2001) }).success).toBe(false);
  });

  it("invoicePaymentFormSchema keeps its null-amount message and the new bounds", () => {
    const blank = invoicePaymentFormSchema.safeParse({ amount: null, method: "CASH" });
    expect(blank.success).toBe(false);
    if (!blank.success) expect(blank.error.issues.some((i) => i.message === "Jumlah pembayaran wajib diisi")).toBe(true);
    const paidAt = getTodayInTimezone("Asia/Jakarta");
    expect(invoicePaymentFormSchema.safeParse({ amount: 5000, method: "CASH", paidAt }).success).toBe(true);
    expect(invoicePaymentFormSchema.safeParse({ amount: 5000.5, method: "CASH", paidAt }).success).toBe(false);
    expect(invoicePaymentFormSchema.safeParse({ amount: 0, method: "CASH", paidAt }).success).toBe(false);
  });

  describe("payment date — Tanggal bayar (FINX-9)", () => {
    const today = getTodayInTimezone("Asia/Jakarta");
    const shift = (ymd: string, days: number) => {
      const d = new Date(`${ymd}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const FUTURE = "Tanggal bayar tidak boleh di masa depan.";

    it("recordPaymentSchema: paidAt is optional; today and past dates pass", () => {
      expect(recordPaymentSchema.safeParse({ amount: 1000 }).success).toBe(true);
      expect(recordPaymentSchema.safeParse({ amount: 1000, paidAt: today }).success).toBe(true);
      expect(recordPaymentSchema.safeParse({ amount: 1000, paidAt: shift(today, -30) }).success).toBe(true);
    });

    it("recordPaymentSchema: a future date is rejected with the Indonesian message", () => {
      const r = recordPaymentSchema.safeParse({ amount: 1000, paidAt: shift(today, 1) });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual([FUTURE]);
    });

    it("recordPaymentSchema: malformed / impossible dates fail on calendarDate's own messages, not the future one", () => {
      const msgs = (paidAt: string) => {
        const r = recordPaymentSchema.safeParse({ amount: 1000, paidAt });
        return r.success ? [] : r.error.issues.map((i) => i.message);
      };
      expect(msgs("07-10-2026")).not.toContain(FUTURE);
      expect(msgs("07-10-2026")).not.toHaveLength(0);
      expect(msgs("2026-02-30")).toEqual(["Tanggal bayar tidak valid"]);
      expect(msgs("1999-12-31")).toEqual(["Tanggal bayar di luar rentang yang wajar"]);
    });

    it("invoicePaymentFormSchema inherits the future check and reads a cleared date as missing", () => {
      const base = { amount: 5000, method: "CASH" as const };
      const future = invoicePaymentFormSchema.safeParse({ ...base, paidAt: shift(today, 1) });
      expect(future.success).toBe(false);
      if (!future.success) expect(future.error.issues[0]?.message).toBe(FUTURE);
      const blank = invoicePaymentFormSchema.safeParse({ ...base, paidAt: "" });
      expect(blank.success).toBe(false);
      if (!blank.success) expect(blank.error.issues[0]?.message).toBe("Tanggal bayar wajib diisi");
    });
  });

  const invoice = {
    studentId: "s1",
    periodLabel: "Juli 2026",
    dueDate: "2026-07-31",
    lines: [{ feeComponentId: "fc-1", amount: 100_000 }],
  };

  it("createManualInvoiceSchema validates line amounts and due date", () => {
    expect(createManualInvoiceSchema.safeParse(invoice).success).toBe(true);
    expect(createManualInvoiceSchema.safeParse({ ...invoice, lines: [{ feeComponentId: "fc-1", amount: 0.001 }] }).success).toBe(false);
    expect(createManualInvoiceSchema.safeParse({ ...invoice, lines: [{ feeComponentId: "fc-1", amount: 1e13 }] }).success).toBe(false);
    expect(createManualInvoiceSchema.safeParse({ ...invoice, dueDate: "2026-02-30" }).success).toBe(false);
    expect(createManualInvoiceSchema.safeParse({ ...invoice, dueDate: "1900-01-01" }).success).toBe(false);
  });

  it("an empty due date still reads as missing, not malformed", () => {
    const r = createManualInvoiceSchema.safeParse({ ...invoice, dueDate: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.find((i) => i.path.includes("dueDate"))?.message).toBe("Tanggal jatuh tempo wajib diisi");
    }
  });

  it("periodLabel: trimmed, NUL rejected", () => {
    const r = createManualInvoiceSchema.safeParse({ ...invoice, periodLabel: "  Juli 2026 " });
    expect(r.success && r.data.periodLabel).toBe("Juli 2026");
    expect(createManualInvoiceSchema.safeParse({ ...invoice, periodLabel: "Jul\u0000i" }).success).toBe(false);
  });

  it("manualInvoiceFormSchema keeps the null-amount message", () => {
    const r = manualInvoiceFormSchema.safeParse({ ...invoice, lines: [{ feeComponentId: "fc-1", amount: null }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === "Jumlah pada setiap baris harus lebih dari 0")).toBe(true);
    }
  });

  it("generate schemas check the due date and period label", () => {
    expect(generatePlanSchema.safeParse({ periodLabel: "Juli 2026", dueDate: "2026-07-31", academicYearId: "ay" }).success).toBe(true);
    expect(generatePlanSchema.safeParse({ periodLabel: "Juli 2026", dueDate: "2026-02-30", academicYearId: "ay" }).success).toBe(false);
    expect(
      generateBatchSchema.safeParse({ studentIds: ["s1"], periodLabel: "x".repeat(65), dueDate: "2026-07-31", academicYearId: "ay" }).success,
    ).toBe(false);
  });
});
