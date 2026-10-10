/**
 * Pendaftaran (registration) fee math. Pure: no DB, no clock, so the parent
 * form (display) and the submit route (authoritative) compute the identical
 * number. The client never sends an amount.
 *
 * Rules (cycle 2026-10-10-pendaftaran-fee-payment, assumptions A1/A4):
 *  - base = the chosen program's fee, PLUS the Day Care program's fee when the
 *    Day Care add-on is ticked and the chosen program is not itself Day Care.
 *  - discount is a whole percent, 0-100, set by staff while the fee is unpaid.
 *  - amount = base - round(base * percent / 100). All values are whole rupiah.
 */

/** The Program.code that marks the Day Care program. */
export const DAYCARE_PROGRAM_CODE = "DCARE";

export type FeeProgram = { id: string; code: string; enrollmentFee: number };

export type FeeBreakdown = {
  /** Fee of the chosen program. */
  programFee: number;
  /** Day Care fee added by the add-on; 0 when not applicable. */
  dcareAddonFee: number;
  /** programFee + dcareAddonFee, before discount. */
  baseAmount: number;
  discountPercent: number;
  discountAmount: number;
  /** What the parent pays. */
  amount: number;
};

/** What a fee row starts as: no payment step, owed, or fully discounted. */
export type InitialFeeStatus = "NONE" | "UNPAID" | "WAIVED";

export function isDayCareProgram(code: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === DAYCARE_PROGRAM_CODE;
}

/** Whole, non-negative rupiah; anything non-finite becomes 0. */
export function toRupiah(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Integer percent clamped to 0-100; anything non-finite becomes 0. */
export function clampPercent(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Fee for `programId` out of the school's active `programs`.
 * An unknown / empty program yields a zero fee (no payment step), never a throw:
 * the submit route validates the program separately.
 */
export function computeEnrollmentFee(input: {
  programs: readonly FeeProgram[];
  programId: string | null | undefined;
  dcareAddon: boolean;
  discountPercent?: number;
}): FeeBreakdown {
  const chosen = input.programs.find((p) => p.id === input.programId);
  const programFee = toRupiah(chosen?.enrollmentFee);

  let dcareAddonFee = 0;
  if (chosen && input.dcareAddon && !isDayCareProgram(chosen.code)) {
    const dcare = input.programs.find((p) => isDayCareProgram(p.code));
    dcareAddonFee = toRupiah(dcare?.enrollmentFee);
  }

  const baseAmount = programFee + dcareAddonFee;
  const discountPercent = clampPercent(input.discountPercent ?? 0);
  const discountAmount = Math.round((baseAmount * discountPercent) / 100);
  return {
    programFee,
    dcareAddonFee,
    baseAmount,
    discountPercent,
    discountAmount,
    amount: baseAmount - discountAmount,
  };
}

/** Re-apply a new percent to an already snapshotted base amount (staff discount). */
export function applyDiscount(baseAmount: number, discountPercent: number): { discountPercent: number; discountAmount: number; amount: number } {
  const base = toRupiah(baseAmount);
  const percent = clampPercent(discountPercent);
  const discountAmount = Math.round((base * percent) / 100);
  return { discountPercent: percent, discountAmount, amount: base - discountAmount };
}

export function initialFeeStatus(fee: Pick<FeeBreakdown, "baseAmount" | "amount">): InitialFeeStatus {
  if (fee.baseAmount <= 0) return "NONE";
  return fee.amount > 0 ? "UNPAID" : "WAIVED";
}
