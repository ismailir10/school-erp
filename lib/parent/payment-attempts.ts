/** Browser hints only: never evidence that money was received. */
export type PaymentScope = { tenantId: string; guardianId: string; childId: string };
export type PaymentAttempt = {
  version: 1;
  totalPaid: number;
  startedAt: number;
  phase: "checkout" | "confirming";
};
export type AttemptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function paymentAttemptKey(scope: PaymentScope, invoiceId: string): string {
  return `talib:payment-attempt:${JSON.stringify([scope.tenantId, scope.guardianId, scope.childId, invoiceId])}`;
}

export function readPaymentAttempt(storage: AttemptStorage | null, key: string): PaymentAttempt | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const hint = value as Partial<PaymentAttempt>;
    if (hint.version !== 1 || !Number.isFinite(hint.totalPaid) || hint.totalPaid! < 0 ||
      !Number.isSafeInteger(hint.startedAt) || hint.startedAt! < 0 ||
      (hint.phase !== "checkout" && hint.phase !== "confirming")) return null;
    return { version: 1, totalPaid: hint.totalPaid!, startedAt: hint.startedAt!, phase: hint.phase };
  } catch {
    return null;
  }
}

export function writePaymentAttempt(storage: AttemptStorage | null, key: string, hint: PaymentAttempt): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(hint));
    // Some privacy wrappers silently discard writes.
    return storage.getItem(key) === JSON.stringify(hint);
  } catch {
    return false;
  }
}

export function removePaymentAttempt(storage: AttemptStorage | null, key: string): void {
  try { storage?.removeItem(key); } catch { /* In-memory state still follows the server. */ }
}
