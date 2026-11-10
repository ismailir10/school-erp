import { describe, expect, it } from "vitest";

import { toDokuPaymentDueDateMinutes } from "@/lib/payments/doku/client";
import { defaultExpiresAt } from "@/lib/payments/expiry";

/**
 * Cycle 2026-08-20-invoice-due-date-to-gateway T1.
 *
 * `CreateSessionParams` carries an absolute `expiresAt` instant. Each adapter
 * converts it to whatever its own API speaks. Xendit speaks absolute ISO and
 * needs no conversion; DOKU speaks minutes-from-now, which is where the
 * arithmetic — and therefore the risk — lives.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("toDokuPaymentDueDateMinutes", () => {
  const now = new Date("2026-08-20T03:00:00.000Z");

  it("converts a whole number of days to minutes", () => {
    expect(toDokuPaymentDueDateMinutes(new Date(now.getTime() + 7 * DAY), now)).toBe(
      7 * 24 * 60,
    );
    expect(toDokuPaymentDueDateMinutes(new Date(now.getTime() + 14 * DAY), now)).toBe(
      14 * 24 * 60,
    );
  });

  it("rounds partial minutes UP so the parent is never short of the minute promised", () => {
    // 30 seconds past the 10-minute mark → 11 minutes, not 10.
    const expiresAt = new Date(now.getTime() + 10 * MINUTE + 30_000);
    expect(toDokuPaymentDueDateMinutes(expiresAt, now)).toBe(11);
  });

  it("floors at 1 for an instant that has already passed", () => {
    // A zero or negative `payment_due_date` is not a short window — it is a
    // session DOKU rejects or expires on arrival, costing the parent their
    // payment link. Business policy should never let this reach the adapter,
    // but the transport guard exists because "should never" is not "cannot".
    expect(toDokuPaymentDueDateMinutes(new Date(now.getTime() - 5 * DAY), now)).toBe(1);
    expect(toDokuPaymentDueDateMinutes(now, now)).toBe(1);
  });

  it("stays within DOKU's 6-digit field length at the 30-day cap", () => {
    const capped = toDokuPaymentDueDateMinutes(new Date(now.getTime() + 30 * DAY), now);
    expect(capped).toBe(43_200);
    expect(String(capped).length).toBeLessThanOrEqual(6);
  });

  it("stays within DOKU's 6-digit field length at the 365-day cap", () => {
    const capped = toDokuPaymentDueDateMinutes(new Date(now.getTime() + 365 * DAY), now);
    expect(capped).toBe(525_600);
    expect(String(capped).length).toBeLessThanOrEqual(6);
  });

  it("expresses Bu Shanti's real 27→10 collection window", () => {
    // Invoice issued 27 Oct 00:00 WIB, due end of 10 Nov WIB — the window that
    // surfaced this bug. Previously every one of these was sent as 7 days.
    const issued = new Date("2026-10-26T17:00:00.000Z"); // 27 Oct 00:00 +07:00
    const due = new Date("2026-11-10T16:59:59.000Z"); // 10 Nov 23:59:59 +07:00
    const minutes = toDokuPaymentDueDateMinutes(due, issued);
    expect(minutes).toBe(15 * 24 * 60); // rounds up from 14d 23h 59m 59s
    expect(minutes).not.toBe(7 * 24 * 60);
  });
});

describe("defaultExpiresAt", () => {
  it("is 7 days out, preserving the historical default for invoice-less callers", () => {
    const now = new Date("2026-08-20T03:00:00.000Z");
    expect(defaultExpiresAt(now).toISOString()).toBe("2026-08-27T03:00:00.000Z");
  });
});
