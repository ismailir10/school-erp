import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  OTHER_FEES_MONTH_LABEL_MESSAGE,
  PREPAY_NOTHING_CHOSEN_MESSAGE,
  sppPrepayConfirmSchema,
  sppPrepayFormSchema,
  sppPrepayPartsFromForm,
  sppPrepayPreviewSchema,
} from "@/lib/validations/spp-prepay";
import { DUPLICATE_LINES_MESSAGE } from "@/lib/validations/invoice";

/**
 * Schemas of "Catat pembayaran di muka" (cycle 2026-10-30-prepay-other-fees): the SPP
 * part and the one-time part are each optional, and a confirm needs at least one.
 */

// "Today" is 27 Oktober 2026 so a paid date of that day is valid and the next day is the future.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T05:00:00Z"));
});
afterAll(() => vi.useRealTimers());

const KEY = "0b8f6e2e-3f6c-4d2b-9f0a-2f6f5f1a7c11";
const otherFees = {
  label: "Biaya Sekolah Tahap 1 TA 2027/2028",
  lines: [
    { feeComponentId: "fc-pangkal", amount: 5_000_000 },
    { feeComponentId: "fc-sarana", amount: 1_500_000 },
  ],
};
const confirmBase = {
  studentId: "s-1",
  method: "CASH",
  paidAt: "2026-10-27",
  idempotencyKey: KEY,
  fingerprint: "f".repeat(64),
};

const issues = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  (r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]);

describe("sppPrepayPreviewSchema", () => {
  it("accepts a student-only call (neither part): the dialog's first call after picking the student", () => {
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "s-1" }).success).toBe(true);
  });

  it("accepts SPP only, one-time only, and both", () => {
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", from: "2026-10", to: "2026-12" }).success).toBe(true);
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", otherFees }).success).toBe(true);
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", from: "2026-10", to: "2026-12", otherFees }).success).toBe(true);
  });

  it("accepts null for an absent part", () => {
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", from: null, to: null, otherFees: null }).success).toBe(true);
  });

  it("one month alone is refused on the missing field", () => {
    expect(issues(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", from: "2026-10" }))).toEqual([
      ["to", "Isi bulan awal dan bulan akhir, atau pilih Tanpa SPP"],
    ]);
    expect(issues(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", to: "2026-10" }))).toEqual([
      ["from", "Isi bulan awal dan bulan akhir, atau pilih Tanpa SPP"],
    ]);
  });

  it("keeps the month format message and requires a student", () => {
    expect(issues(sppPrepayPreviewSchema.safeParse({ studentId: "s-1", from: "2026-13", to: "2026-12" }))).toEqual([
      ["from", "Format bulan harus YYYY-MM"],
    ]);
    expect(sppPrepayPreviewSchema.safeParse({ studentId: "" }).success).toBe(false);
  });
});

describe("sppPrepayConfirmSchema", () => {
  it("accepts SPP only, one-time only (Tanpa SPP) and both", () => {
    expect(sppPrepayConfirmSchema.safeParse({ ...confirmBase, from: "2026-10", to: "2026-12" }).success).toBe(true);
    expect(sppPrepayConfirmSchema.safeParse({ ...confirmBase, otherFees }).success).toBe(true);
    expect(sppPrepayConfirmSchema.safeParse({ ...confirmBase, from: "2026-10", to: "2026-12", otherFees }).success).toBe(true);
  });

  it("refuses both parts empty with a plain message", () => {
    expect(issues(sppPrepayConfirmSchema.safeParse(confirmBase))).toEqual([["parts", PREPAY_NOTHING_CHOSEN_MESSAGE]]);
    expect(issues(sppPrepayConfirmSchema.safeParse({ ...confirmBase, from: null, to: null, otherFees: null }))).toEqual([
      ["parts", PREPAY_NOTHING_CHOSEN_MESSAGE],
    ]);
  });

  it("still needs method, a real not-future paid date, an idempotency key and a fingerprint", () => {
    const base = { ...confirmBase, otherFees };
    expect(issues(sppPrepayConfirmSchema.safeParse({ ...base, method: "XENDIT" }))).toEqual([
      ["method", "Pilih Tunai, Transfer Bank, atau Lainnya."],
    ]);
    expect(issues(sppPrepayConfirmSchema.safeParse({ ...base, paidAt: "2026-10-28" }))).toEqual([
      ["paidAt", "Tanggal bayar tidak boleh di masa depan."],
    ]);
    expect(sppPrepayConfirmSchema.safeParse({ ...base, idempotencyKey: "abc" }).success).toBe(false);
    expect(sppPrepayConfirmSchema.safeParse({ ...base, fingerprint: undefined }).success).toBe(false);
  });
});

describe("one-time fees (otherFees)", () => {
  const parse = (o: unknown) => sppPrepayPreviewSchema.safeParse({ studentId: "s-1", otherFees: o });

  it("trims the label", () => {
    const r = parse({ ...otherFees, label: "  Biaya Sekolah Tahap 1 TA 2027/2028  " });
    expect(r.success && r.data.otherFees?.label).toBe("Biaya Sekolah Tahap 1 TA 2027/2028");
  });

  it("refuses a missing or blank label on the label field", () => {
    expect(issues(parse({ ...otherFees, label: "   " }))).toEqual([["otherFees.label", "Periode wajib diisi"]]);
    expect(issues(parse({ lines: otherFees.lines }))).toEqual([["otherFees.label", expect.any(String)]]);
  });

  it.each(["Januari 2027", "oktober 2026", "Okt 2026", "SPP Desember 2026", "Seragam Mei 2027"])(
    "refuses the label %s: it names a single month",
    (label) => {
      expect(issues(parse({ ...otherFees, label }))).toEqual([["otherFees.label", OTHER_FEES_MONTH_LABEL_MESSAGE]]);
    },
  );

  it("the month-label message explains what to write instead", () => {
    expect(OTHER_FEES_MONTH_LABEL_MESSAGE).toBe(
      'Gunakan label yang menjelaskan biaya, mis. "Biaya Sekolah Tahap 1 TA 2027/2028", bukan nama bulan.',
    );
  });

  it.each(["Biaya Sekolah Tahap 1 TA 2027/2028", "Uang Pangkal", "Seragam", "Semester 1 2026/2027", "Oktober - Desember 2026"])(
    "accepts the label %s (no single month)",
    (label) => {
      expect(parse({ ...otherFees, label }).success).toBe(true);
    },
  );

  it("refuses a label over 64 characters, like a manual invoice's Periode", () => {
    expect(parse({ ...otherFees, label: "x".repeat(65) }).success).toBe(false);
    expect(parse({ ...otherFees, label: "x".repeat(64) }).success).toBe(true);
  });

  it("needs 1 to 20 lines", () => {
    expect(issues(parse({ ...otherFees, lines: [] }))).toEqual([["otherFees.lines", "Tambahkan minimal satu biaya"]]);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ feeComponentId: `fc-${i}`, amount: 1000 }));
    expect(parse({ ...otherFees, lines: many(20) }).success).toBe(true);
    expect(issues(parse({ ...otherFees, lines: many(21) }))).toEqual([["otherFees.lines", "Maksimal 20 biaya"]]);
  });

  it.each([0, -1, 0.5, 1_000_000_001])("refuses the amount %s on that line", (amount) => {
    const r = parse({ ...otherFees, lines: [{ feeComponentId: "fc-pangkal", amount }] });
    expect(r.success).toBe(false);
    expect(issues(r)[0][0]).toBe("otherFees.lines.0.amount");
  });

  it("zero reads as 'lebih dari 0'", () => {
    expect(issues(parse({ ...otherFees, lines: [{ feeComponentId: "fc-pangkal", amount: 0 }] }))).toEqual([
      ["otherFees.lines.0.amount", "Jumlah pada setiap baris harus lebih dari 0"],
    ]);
  });

  it("accepts the largest allowed amount", () => {
    expect(parse({ ...otherFees, lines: [{ feeComponentId: "fc-pangkal", amount: 1_000_000_000 }] }).success).toBe(true);
  });

  it("refuses a line without a component", () => {
    expect(issues(parse({ ...otherFees, lines: [{ feeComponentId: "", amount: 1000 }] }))).toEqual([
      ["otherFees.lines.0.feeComponentId", "Pilih komponen biaya pada setiap baris"],
    ]);
  });

  it("refuses the same component twice (decision: duplicates are refused, like a manual invoice)", () => {
    const r = parse({
      ...otherFees,
      lines: [
        { feeComponentId: "fc-pangkal", amount: 1000 },
        { feeComponentId: "fc-pangkal", amount: 2000 },
      ],
    });
    expect(issues(r)).toEqual([["otherFees.lines", DUPLICATE_LINES_MESSAGE]]);
  });
});

describe("sppPrepayFormSchema", () => {
  const valid = {
    studentId: "s-1",
    withSpp: true,
    from: "2026-10",
    to: "2026-12",
    otherFees: { label: "", lines: [] as Array<{ feeComponentId: string; amount: number | null }> },
    method: "CASH",
    paidAt: "2026-10-27",
  };
  const parse = (over: Record<string, unknown> = {}) => sppPrepayFormSchema.safeParse({ ...valid, ...over });

  it("accepts SPP only with an empty one-time part", () => {
    expect(parse().success).toBe(true);
  });

  it("accepts Tanpa SPP with one-time lines, ignoring blank months", () => {
    const r = parse({ withSpp: false, from: "", to: "", otherFees });
    expect(r.success).toBe(true);
  });

  it("refuses neither part (Tanpa SPP and no line) with the plain message", () => {
    expect(issues(parse({ withSpp: false }))).toEqual([["parts", PREPAY_NOTHING_CHOSEN_MESSAGE]]);
  });

  it("SPP chosen needs both months, in order", () => {
    expect(issues(parse({ from: "", to: "" }))).toEqual([
      ["from", "Bulan awal wajib diisi"],
      ["to", "Bulan akhir wajib diisi"],
    ]);
    expect(issues(parse({ from: "2026-12", to: "2026-10" }))).toEqual([["to", "Bulan akhir tidak boleh sebelum bulan awal"]]);
  });

  it("a one-time line makes the label required and refuses a month label", () => {
    const line = { feeComponentId: "fc-pangkal", amount: 1000 };
    expect(issues(parse({ otherFees: { label: "", lines: [line] } }))).toEqual([["otherFees.label", "Periode wajib diisi"]]);
    expect(issues(parse({ otherFees: { label: "Januari 2027", lines: [line] } }))).toEqual([
      ["otherFees.label", OTHER_FEES_MONTH_LABEL_MESSAGE],
    ]);
    // No lines: the label is not looked at.
    expect(parse({ otherFees: { label: "Januari 2027", lines: [] } }).success).toBe(true);
  });

  it("refuses an empty, zero or missing amount and an unpicked component on the row", () => {
    const label = "Biaya Sekolah Tahap 1 TA 2027/2028";
    expect(issues(parse({ otherFees: { label, lines: [{ feeComponentId: "fc-pangkal", amount: null }] } }))).toEqual([
      ["otherFees.lines.0.amount", "Jumlah pada setiap baris harus lebih dari 0"],
    ]);
    expect(issues(parse({ otherFees: { label, lines: [{ feeComponentId: "fc-pangkal", amount: 0 }] } }))).toEqual([
      ["otherFees.lines.0.amount", "Jumlah pada setiap baris harus lebih dari 0"],
    ]);
    expect(issues(parse({ otherFees: { label, lines: [{ feeComponentId: "", amount: 1000 }] } }))).toEqual([
      ["otherFees.lines.0.feeComponentId", "Pilih komponen biaya pada setiap baris"],
    ]);
  });

  it("refuses a duplicate component", () => {
    const label = "Biaya Sekolah Tahap 1 TA 2027/2028";
    const line = { feeComponentId: "fc-pangkal", amount: 1000 };
    expect(issues(parse({ otherFees: { label, lines: [line, line] } }))).toEqual([["otherFees.lines", DUPLICATE_LINES_MESSAGE]]);
  });

  it("keeps the payment rules: method and a not-future date", () => {
    expect(issues(parse({ method: "DOKU" }))).toEqual([["method", "Pilih Tunai, Transfer Bank, atau Lainnya."]]);
    expect(issues(parse({ paidAt: "" }))).toEqual([["paidAt", "Tanggal bayar wajib diisi"]]);
    expect(issues(parse({ paidAt: "2026-10-28" }))).toEqual([["paidAt", "Tanggal bayar tidak boleh di masa depan."]]);
  });
});

describe("sppPrepayPartsFromForm", () => {
  const form = (over: Record<string, unknown> = {}) => ({
    withSpp: true,
    from: "2026-10",
    to: "2026-12",
    otherFees: { label: "", lines: [] as Array<{ feeComponentId: string; amount: number | null }> },
    ...over,
  });

  it("SPP only: months, no otherFees key", () => {
    expect(sppPrepayPartsFromForm(form())).toEqual({ from: "2026-10", to: "2026-12" });
  });

  it("Tanpa SPP: no months, whatever the pickers still hold", () => {
    const parts = sppPrepayPartsFromForm(form({ withSpp: false, otherFees }));
    expect(parts).toEqual({ otherFees });
    expect(parts).not.toHaveProperty("from");
  });

  it("is safe on a half-filled form: incomplete lines and a missing label leave the part out", () => {
    const label = "  Biaya Sekolah Tahap 1 TA 2027/2028 ";
    expect(
      sppPrepayPartsFromForm(
        form({
          withSpp: false,
          otherFees: {
            label,
            lines: [
              { feeComponentId: "fc-pangkal", amount: 5000000 },
              { feeComponentId: "fc-sarana", amount: null },
              { feeComponentId: "", amount: 100 },
              { feeComponentId: "fc-seragam", amount: 0 },
            ],
          },
        }),
      ),
    ).toEqual({ otherFees: { label: "Biaya Sekolah Tahap 1 TA 2027/2028", lines: [{ feeComponentId: "fc-pangkal", amount: 5000000 }] } });
    expect(sppPrepayPartsFromForm(form({ withSpp: false, otherFees: { label: "  ", lines: otherFees.lines } }))).toEqual({});
    expect(sppPrepayPartsFromForm(form({ withSpp: false, otherFees: { label, lines: [] } }))).toEqual({});
  });

  it("both parts together", () => {
    expect(sppPrepayPartsFromForm(form({ otherFees }))).toEqual({ from: "2026-10", to: "2026-12", otherFees });
  });
});
