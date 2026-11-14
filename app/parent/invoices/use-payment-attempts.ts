"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { paymentAttemptKey, readPaymentAttempt, removePaymentAttempt, writePaymentAttempt,
  type PaymentAttempt, type PaymentScope } from "@/lib/parent/payment-attempts";

type InvoiceBalance = { id: string; status: string; totalDue: number; totalPaid: number };
function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
const outstanding = (invoice: InvoiceBalance) =>
  invoice.status !== "PAID" && invoice.status !== "CANCELLED" && invoice.totalDue > invoice.totalPaid;

/** Scoped persistence survives reload/new tabs; only server balances resolve a payment. */
export function usePaymentAttempts(scope: PaymentScope | null, invoices: InvoiceBalance[] | null, onExternalChange: () => void) {
  const scopeKey = scope ? JSON.stringify(scope) : "";
  const keyFor = useCallback((id: string) => scopeKey
    ? paymentAttemptKey(JSON.parse(scopeKey) as PaymentScope, id) : `memory:${id}`, [scopeKey]);
  const [attempts, setAttempts] = useState<Record<string, PaymentAttempt>>({});
  const current = useRef(attempts);
  const resolved = useRef<Record<string, PaymentAttempt>>({});
  const update = useCallback((key: string, value: PaymentAttempt | null) => {
    const next = { ...current.current };
    if (value) next[key] = value;
    else delete next[key];
    current.current = next;
    setAttempts(next);
  }, []);

  const clear = useCallback((id: string, startedAt?: number) => {
    const key = keyFor(id);
    const persisted = readPaymentAttempt(browserStorage(), key);
    const hint = current.current[key] ?? persisted;
    // Storage events are queued: a new tab may have written a newer attempt
    // while this tab still holds the previous one and its check is in flight.
    if (startedAt !== undefined && (hint?.startedAt !== startedAt ||
      (persisted && persisted.startedAt !== startedAt))) return;
    removePaymentAttempt(browserStorage(), key);
    update(key, null);
  }, [keyFor, update]);

  useEffect(() => {
    function sync(event?: StorageEvent) {
      const storage = browserStorage();
      for (const invoice of invoices ?? []) {
        const key = keyFor(invoice.id);
        if (event && event.key !== null && event.key !== key) continue;
        // Preserve current-tab hints if storage is blocked; storage events reflect other tabs.
        if (event) onExternalChange();
        // Another tab clearing/replacing a hint is not proof of settlement.
        // Keep this tab protected until its own server data/check catches up.
        const persisted = readPaymentAttempt(storage, key);
        const local = current.current[key];
        const hint = persisted?.phase === "confirming" && (!local || persisted.startedAt > local.startedAt)
          ? persisted : local?.phase === "confirming" ? local
          : event ? persisted : local ?? persisted;
        if (!hint) continue;
        if (!outstanding(invoice) || (hint.phase === "confirming" && invoice.totalPaid > hint.totalPaid)) {
          resolved.current[key] = hint;
          clear(invoice.id, hint.startedAt);
        } else if (current.current[key] !== hint) update(key, hint);
      }
    }
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [invoices, keyFor, clear, update, onExternalChange]);

  const remember = useCallback((invoice: InvoiceBalance, phase: PaymentAttempt["phase"]) => {
    const key = keyFor(invoice.id);
    const persistedHint = readPaymentAttempt(browserStorage(), key);
    const local = current.current[key] ?? resolved.current[key];
    const previous = persistedHint && (!local || persistedHint.startedAt > local.startedAt) ? persistedHint : local;
    // The balance captured BEFORE leaving checkout also covers a webhook arriving before return.
    if (!outstanding(invoice) || (phase === "confirming" && previous && invoice.totalPaid > previous.totalPaid)) {
      clear(invoice.id);
      return { persisted: true, pending: false };
    }
    if (phase === "checkout" && previous?.phase === "confirming" && invoice.totalPaid <= previous.totalPaid) {
      update(key, previous);
      return { persisted: !!persistedHint, pending: true };
    }
    if (phase === "checkout") delete resolved.current[key];
    const hint: PaymentAttempt = phase === "confirming" && previous
      ? { ...previous, phase }
      : { version: 1, phase, totalPaid: invoice.totalPaid, startedAt: Math.max(Date.now(), (previous?.startedAt ?? 0) + 1) };
    const persisted = !!scopeKey && writePaymentAttempt(browserStorage(), key, hint);
    update(key, hint);
    return { persisted, pending: phase === "confirming" };
  }, [keyFor, clear, scopeKey, update]);

  const pending = useCallback((invoice: InvoiceBalance) => {
    const hint = attempts[keyFor(invoice.id)];
    return outstanding(invoice) && hint?.phase === "confirming" && invoice.totalPaid <= hint.totalPaid ? hint : null;
  }, [attempts, keyFor]);
  return { pending, remember, clear, keyFor };
}
