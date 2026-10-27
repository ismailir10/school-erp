/**
 * The fee components a billing run bills every period: enabled and recurring.
 * One definition shared by the billing-run builder and the class program-change
 * preview, so "what changes if this class moves program" is exactly what the
 * next run would bill.
 */
export const BILLABLE_FEE_COMPONENT_WHERE = { isEnabled: true, isRecurring: true } as const;
