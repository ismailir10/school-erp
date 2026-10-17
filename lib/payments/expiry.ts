/**
 * Payment session expiry policy.
 *
 * Added in cycle 2026-08-20-invoice-due-date-to-gateway. Before that cycle the
 * gateway port carried `expiryDays?: number` and the invoice session builder
 * passed a hardcoded `7`, so every Virtual Account expired seven days after it
 * was issued no matter what due date the admin had entered. This module owns
 * the replacement policy so it can be unit tested directly instead of being
 * inlined in the session builder where it could not be exercised.
 */

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Floor for an invoice due today. Its end-of-day instant can be only hours away
 * (or seconds), so the session is still good for another 24 hours.
 *
 * Handing the parent a Virtual Account that is dead the moment it is issued
 * turns a payable debt into a support ticket, which is strictly worse than a
 * short window. A due date already in the past gets the longer
 * `OVERDUE_WINDOW_MS` instead.
 */
const MIN_WINDOW_MS = 1 * DAY_MS;

/**
 * Floor for an invoice whose due date is strictly before today (WIB). An overdue
 * invoice is still collectable — that is the entire point of chasing one — and
 * a reminder is only useful if the link in it still works when the parent gets
 * round to it.
 *
 * Seven days because a week covers a parent who reads the reminder at the
 * weekend rather than the moment it lands. It also bounds how often the nightly
 * heal has to create a fresh order for the same overdue invoice: with the old
 * 24-hour floor every overdue invoice's link died overnight and was re-created
 * every night, which is one gateway order per invoice per day.
 *
 * Added in cycle 2026-10-17-payment-link-reminders (D1). Registration fees do
 * not pass through here — they use `defaultExpiresAt`.
 */
const OVERDUE_WINDOW_MS = 7 * DAY_MS;

/** Fixed WIB (`Asia/Jakarta`) offset from UTC, in milliseconds. No DST. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Cap. DOKU publishes only `Max Length: 6` for `payment_due_date` and defers
 * the real ceiling to each payment channel, so there is no documented number to
 * respect — the safe bound is ours to choose. Xendit's own session maximum is
 * 31 days, so 30 clears both.
 *
 * The failure this avoids is asymmetric: a window clamped shorter than the
 * admin asked for is a visible inconvenience, while a rejected session is a
 * parent with no payment link at all.
 */
const MAX_WINDOW_MS = 30 * DAY_MS;

/**
 * Resolve the instant a payment session for `dueDate` should stop accepting
 * payment.
 *
 * `dueDate` is the invoice's own `YYYY-MM-DD` (Asia/Jakarta), as entered by the
 * admin in "Tanggal Jatuh Tempo". It resolves to the END of that day — an
 * invoice due the 10th is payable through 23:59:59 WIB on the 10th, because a
 * due date that stopped working at midnight as the date arrived would not match
 * anyone's reading of "jatuh tempo tanggal 10".
 *
 * WIB (`Asia/Jakarta`, see `lib/sessions/dates.ts`) is a fixed UTC+7 offset with
 * no daylight saving, so the `+07:00` literal is exact and needs no `Intl`
 * round-trip. That is the whole reason this can be a pure string concatenation
 * rather than a timezone-database lookup.
 *
 * The result is clamped to `[floor, now + 30 days]`. The floor is `now + 7 days`
 * when `dueDate` is strictly before today in WIB (`OVERDUE_WINDOW_MS`) and
 * `now + 1 day` otherwise (`MIN_WINDOW_MS`); the cap is `MAX_WINDOW_MS`.
 */
export function resolveSessionExpiry(dueDate: string, now: Date = new Date()): Date {
  const endOfDueDate = new Date(`${dueDate}T23:59:59+07:00`);

  // A malformed `dueDate` would otherwise propagate an Invalid Date into the
  // gateway payload as `NaN` minutes or "Invalid Date" ISO, failing the session
  // for reasons no log would explain. The schema validates the format on write
  // (`lib/validations/invoice.ts`), so this is a guard, not an expected path.
  if (Number.isNaN(endOfDueDate.getTime())) {
    // Log it. Falling back silently is the same shape as the bug this cycle
    // exists to fix — a wrong expiry that nothing in the system complains
    // about. If a legacy or imported row ever carries a bad `dueDate`, this
    // line is the only thing that will say so.
    console.warn("[PAYMENT EXPIRY MALFORMED DUE DATE]", {
      dueDate,
      fallback: "7d",
    });
    return defaultExpiresAt(now);
  }

  // Today's WIB calendar date, derived from the injectable `now`. Shifting by the
  // fixed +07:00 offset and reading the UTC date gives the WIB date without an
  // `Intl` round-trip. `YYYY-MM-DD` strings compare correctly as plain strings.
  const todayWib = new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  const overdue = dueDate < todayWib;

  const floor = new Date(now.getTime() + (overdue ? OVERDUE_WINDOW_MS : MIN_WINDOW_MS));
  const cap = new Date(now.getTime() + MAX_WINDOW_MS);

  if (endOfDueDate < floor) return floor;
  if (endOfDueDate > cap) return cap;
  return endOfDueDate;
}

/**
 * Fallback expiry for callers that have no invoice and therefore no due date —
 * the DOKU probe route, the reseed script, the finish-xendit script. Preserves
 * the historical 7-day behaviour for those paths only.
 *
 * The invoice path must never reach this. `resolveSessionExpiry` is what that
 * path uses, and `lib/payments/__tests__/session-expiry.test.ts` asserts the
 * gateway receives a due-date-derived instant rather than this default.
 */
export function defaultExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + 7 * DAY_MS);
}
