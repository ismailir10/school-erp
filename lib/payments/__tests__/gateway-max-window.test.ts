import { describe, expect, it } from "vitest";

import { dokuGateway } from "@/lib/payments/doku/client";
import { xenditGateway } from "@/lib/payments/xendit/client";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("PaymentGateway.maxSessionWindowMs", () => {
  it("Xendit stays at 30 days (its API max is 31)", () => {
    expect(xenditGateway.maxSessionWindowMs).toBe(30 * DAY_MS);
  });

  it("DOKU allows 365 days (525,600 minutes fits payment_due_date's 6 digits)", () => {
    expect(dokuGateway.maxSessionWindowMs).toBe(365 * DAY_MS);
  });
});
