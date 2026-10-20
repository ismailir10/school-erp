import { describe, expect, it } from "vitest";
import { paymentLinkExpiryState } from "../payment-link-expiry";

const NOW = new Date("2026-10-20T05:00:00.000Z");
const FUTURE = "2026-10-21T05:00:00.000Z";
const PAST = "2026-10-19T05:00:00.000Z";
const URL = "https://pay.example/abc";

const inv = (over: Partial<Parameters<typeof paymentLinkExpiryState>[0]> = {}) => ({
  status: "SENT",
  xenditPaymentUrl: URL,
  paymentLinkExpiresAt: FUTURE as string | Date | null,
  ...over,
});

describe("paymentLinkExpiryState", () => {
  it("is active when the date is in the future", () => {
    expect(paymentLinkExpiryState(inv(), NOW)).toBe("active");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(paymentLinkExpiryState(inv({ paymentLinkExpiresAt: new Date(FUTURE) }), NOW)).toBe("active");
  });

  it.each(["SENT", "PARTIALLY_PAID", "OVERDUE"])("is expired for an unpaid %s invoice past its date", (status) => {
    expect(paymentLinkExpiryState(inv({ status, paymentLinkExpiresAt: PAST }), NOW)).toBe("expired");
  });

  it("treats the exact expiry instant as expired", () => {
    expect(paymentLinkExpiryState(inv({ paymentLinkExpiresAt: NOW.toISOString() }), NOW)).toBe("expired");
  });

  it.each(["PAID", "CANCELLED"])("never expires a %s invoice, whatever the stored date", (status) => {
    expect(paymentLinkExpiryState(inv({ status, paymentLinkExpiresAt: PAST }), NOW)).toBeNull();
    expect(paymentLinkExpiryState(inv({ status, paymentLinkExpiresAt: FUTURE }), NOW)).toBeNull();
    expect(paymentLinkExpiryState(inv({ status, paymentLinkExpiresAt: null }), NOW)).toBeNull();
  });

  it("is unrecorded when a link exists with no date", () => {
    expect(paymentLinkExpiryState(inv({ paymentLinkExpiresAt: null }), NOW)).toBe("unrecorded");
  });

  it("is unrecorded for an unparseable date rather than throwing", () => {
    expect(paymentLinkExpiryState(inv({ paymentLinkExpiresAt: "not-a-date" }), NOW)).toBe("unrecorded");
  });

  it("is null with no link, even when a stale date is left behind (ghost guard)", () => {
    expect(paymentLinkExpiryState(inv({ xenditPaymentUrl: null, paymentLinkExpiresAt: FUTURE }), NOW)).toBeNull();
    expect(paymentLinkExpiryState(inv({ xenditPaymentUrl: null, paymentLinkExpiresAt: PAST }), NOW)).toBeNull();
    expect(paymentLinkExpiryState(inv({ xenditPaymentUrl: null, paymentLinkExpiresAt: null }), NOW)).toBeNull();
  });

  it("shows nothing for an expired date on a status that is not billed (no red outside the unpaid trio)", () => {
    expect(paymentLinkExpiryState(inv({ status: "PENDING_PAYMENT_LINK", paymentLinkExpiresAt: PAST }), NOW)).toBeNull();
  });
});
