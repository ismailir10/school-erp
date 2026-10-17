import { describe, expect, it } from "vitest";

import { resolveSessionExpiry } from "@/lib/payments/expiry";

/**
 * Cycle 2026-08-20-invoice-due-date-to-gateway T2.
 *
 * The policy that replaced a hardcoded seven days. Every case below uses a
 * fixed `now`, so nothing here depends on when CI happens to run.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveSessionExpiry", () => {
  // 20 Aug 2026, 10:00 WIB.
  const now = new Date("2026-08-20T03:00:00.000Z");

  it("resolves a due date to the END of that day in WIB", () => {
    // Payable through 23:59:59 on the 10th, not until it merely becomes the
    // 10th. 23:59:59 +07:00 is 16:59:59 UTC the day before.
    expect(resolveSessionExpiry("2026-09-10", now).toISOString()).toBe(
      "2026-09-10T16:59:59.000Z",
    );
  });

  it("covers Bu Shanti's real 27→10 collection window", () => {
    // The report that opened this cycle: invoices issued on the 27th, due the
    // 10th, ~14 days. Previously every one was sent to DOKU as 7 days.
    const issued = new Date("2026-10-26T17:00:00.000Z"); // 27 Oct 00:00 WIB
    const resolved = resolveSessionExpiry("2026-11-10", issued);

    expect(resolved.toISOString()).toBe("2026-11-10T16:59:59.000Z");

    const windowDays = (resolved.getTime() - issued.getTime()) / DAY_MS;
    expect(windowDays).toBeGreaterThan(14);
    expect(windowDays).toBeLessThan(15);
  });

  it("gives an invoice due yesterday a 7-day window rather than expiring it on arrival", () => {
    // An overdue invoice is still collectable. A born-dead VA is a support
    // ticket, which is strictly worse than a short window. Cycle
    // 2026-10-17-payment-link-reminders D1: overdue links last a week.
    const resolved = resolveSessionExpiry("2026-08-19", now);
    expect(resolved.toISOString()).toBe(new Date(now.getTime() + 7 * DAY_MS).toISOString());
    expect(resolved.getTime()).toBeGreaterThan(now.getTime());
  });

  it("gives a long-overdue invoice the same 7-day window", () => {
    const tenDaysAgo = resolveSessionExpiry("2026-08-10", now);
    expect(tenDaysAgo.toISOString()).toBe(new Date(now.getTime() + 7 * DAY_MS).toISOString());

    const monthsAgo = resolveSessionExpiry("2026-07-01", now);
    expect(monthsAgo.toISOString()).toBe(new Date(now.getTime() + 7 * DAY_MS).toISOString());
  });

  it("judges 'overdue' by the WIB calendar date, not the UTC one", () => {
    // 20 Aug 2026, 00:30 WIB is still 19 Aug in UTC. An invoice due the 19th is
    // overdue in WIB (7-day floor); one due the 20th is due today (1-day floor).
    const justAfterWibMidnight = new Date("2026-08-19T17:30:00.000Z");
    expect(resolveSessionExpiry("2026-08-19", justAfterWibMidnight).toISOString()).toBe(
      new Date(justAfterWibMidnight.getTime() + 7 * DAY_MS).toISOString(),
    );
    expect(resolveSessionExpiry("2026-08-20", justAfterWibMidnight).toISOString()).toBe(
      new Date(justAfterWibMidnight.getTime() + DAY_MS).toISOString(),
    );
  });

  it("lifts a same-day due date to the 1-day floor, not to seconds from now", () => {
    // End of today WIB is ~14 hours away at this `now` — inside the floor, so
    // the floor wins. A parent told "due today" still gets a usable window, and
    // due today is not overdue, so it does not get the 7-day window.
    const resolved = resolveSessionExpiry("2026-08-20", now);
    expect(resolved.toISOString()).toBe(new Date(now.getTime() + DAY_MS).toISOString());
  });

  it("keeps a due date that sits just beyond the floor", () => {
    // Due tomorrow, end of day WIB — ~38h out, comfortably past the floor.
    const resolved = resolveSessionExpiry("2026-08-21", now);
    expect(resolved.toISOString()).toBe("2026-08-21T16:59:59.000Z");
  });

  it("caps a far-future due date at 30 days", () => {
    const resolved = resolveSessionExpiry("2027-06-30", now);
    expect(resolved.toISOString()).toBe(new Date(now.getTime() + 30 * DAY_MS).toISOString());
  });

  it("crosses a month boundary without drifting", () => {
    expect(resolveSessionExpiry("2026-08-31", now).toISOString()).toBe(
      "2026-08-31T16:59:59.000Z",
    );
    expect(resolveSessionExpiry("2026-09-01", now).toISOString()).toBe(
      "2026-09-01T16:59:59.000Z",
    );
  });

  it("handles a leap day", () => {
    const beforeLeap = new Date("2028-02-01T03:00:00.000Z");
    expect(resolveSessionExpiry("2028-02-29", beforeLeap).toISOString()).toBe(
      "2028-02-29T16:59:59.000Z",
    );
  });

  it("falls back to the 7-day default on a malformed due date instead of emitting Invalid Date", () => {
    // Guarded, not expected — `lib/validations/invoice.ts` enforces the format
    // on write. Without the guard this would reach the gateway as NaN minutes.
    const resolved = resolveSessionExpiry("not-a-date", now);
    expect(Number.isNaN(resolved.getTime())).toBe(false);
    expect(resolved.toISOString()).toBe(new Date(now.getTime() + 7 * DAY_MS).toISOString());
  });

  it("never returns an instant at or before now, for any input", () => {
    const inputs = ["2026-08-20", "2026-07-01", "1999-01-01", "2030-01-01", "garbage"];
    for (const input of inputs) {
      expect(resolveSessionExpiry(input, now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});
