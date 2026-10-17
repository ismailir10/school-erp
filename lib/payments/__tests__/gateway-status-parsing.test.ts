import { describe, it, expect, vi } from "vitest";

// `buildManualEventId` is a pure function, but it lives in reconcile.ts
// alongside the DB-backed reconciler — stub prisma so importing it here does
// not demand a DATABASE_URL.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  mapXenditSessionState,
  parseXenditSessionStatus,
} from "@/lib/payments/xendit/client";
import {
  mapDokuTransactionState,
  parseDokuOrderStatus,
} from "@/lib/payments/doku/client";
import { buildManualEventId } from "@/lib/payments/reconcile";

/**
 * Pure-function coverage for the status-poll parsers added in cycle
 * 2026-07-28-manual-payment-refresh. No network, no DB.
 *
 * The response shapes exercised here are DEFENSIVE assertions, not captured
 * fixtures — neither gateway's check-status body has been observed with real
 * credentials yet (see the cycle doc's Risks). The point of these tests is
 * that an unexpected shape degrades to "null field / PENDING state" and is
 * therefore refused by the shared processor's guards, rather than crediting
 * something wrong.
 */

describe("mapXenditSessionState", () => {
  it("maps every documented Xendit session status", () => {
    expect(mapXenditSessionState("COMPLETED")).toBe("COMPLETED");
    expect(mapXenditSessionState("ACTIVE")).toBe("PENDING");
    expect(mapXenditSessionState("EXPIRED")).toBe("EXPIRED");
    expect(mapXenditSessionState("CANCELED")).toBe("FAILED");
  });

  it("accepts vocabulary synonyms and is case-insensitive", () => {
    expect(mapXenditSessionState("succeeded")).toBe("COMPLETED");
    expect(mapXenditSessionState("Paid")).toBe("COMPLETED");
    expect(mapXenditSessionState("CANCELLED")).toBe("FAILED");
    expect(mapXenditSessionState("REFUNDED")).toBe("REFUNDED");
  });

  it("falls back to PENDING for unknown/absent status — never credits or reverts", () => {
    expect(mapXenditSessionState("SOME_NEW_STATUS")).toBe("PENDING");
    expect(mapXenditSessionState(null)).toBe("PENDING");
    expect(mapXenditSessionState("")).toBe("PENDING");
  });
});

describe("parseXenditSessionStatus", () => {
  it("reads a flat completed session", () => {
    const out = parseXenditSessionStatus({
      id: "ps-69ec4131991c6b6d61d2e989",
      status: "COMPLETED",
      amount: 800000,
      currency: "IDR",
      channel_code: "BCA",
      payment_id: "py-baa5f75a-73b0-4d57-9476-58f1bb160168",
    });
    expect(out.state).toBe("COMPLETED");
    expect(out.rawStatus).toBe("COMPLETED");
    expect(out.paymentId).toBe("py-baa5f75a-73b0-4d57-9476-58f1bb160168");
    expect(out.amount).toBe(800000);
    expect(out.currency).toBe("IDR");
    expect(out.channelCode).toBe("BCA");
  });

  it("prefers the succeeded attempt from a nested payments[] collection", () => {
    const out = parseXenditSessionStatus({
      id: "ps-1",
      status: "COMPLETED",
      currency: "IDR",
      payments: [
        { id: "py-failed", status: "FAILED", amount: 500000 },
        { id: "py-ok", status: "SUCCEEDED", amount: 500000, channel_code: "BRI" },
      ],
    });
    expect(out.paymentId).toBe("py-ok");
    expect(out.amount).toBe(500000);
    expect(out.channelCode).toBe("BRI");
  });

  it("falls back to the session id as idempotency key — same chain as the webhook", () => {
    // The webhook route uses `payment_id ?? payment_session_id`. Diverging
    // here would mint a second Payment row for one settlement.
    const out = parseXenditSessionStatus({
      id: "ps-only",
      status: "COMPLETED",
      amount: 100,
    });
    expect(out.paymentId).toBe("ps-only");
  });

  it("coerces numeric-string amounts and tolerates junk input", () => {
    expect(parseXenditSessionStatus({ amount: "250000" }).amount).toBe(250000);
    expect(parseXenditSessionStatus({ amount: "abc" }).amount).toBeNull();
    expect(parseXenditSessionStatus(null).state).toBe("PENDING");
    expect(parseXenditSessionStatus(null).paymentId).toBeNull();
    expect(parseXenditSessionStatus("nonsense").amount).toBeNull();
  });

  it("leaves amount/paymentId null on an empty body so the processor guards refuse to credit", () => {
    const out = parseXenditSessionStatus({ status: "COMPLETED" });
    expect(out.state).toBe("COMPLETED");
    expect(out.amount).toBeNull();
    expect(out.paymentId).toBeNull();
  });
});

describe("mapDokuTransactionState", () => {
  it("matches the notification route's vocabulary exactly", () => {
    expect(mapDokuTransactionState("SUCCESS")).toBe("COMPLETED");
    expect(mapDokuTransactionState("EXPIRED")).toBe("EXPIRED");
    expect(mapDokuTransactionState("FAILED")).toBe("FAILED");
    expect(mapDokuTransactionState("VOIDED")).toBe("FAILED");
    expect(mapDokuTransactionState("REFUNDED")).toBe("REFUNDED");
    expect(mapDokuTransactionState("PENDING")).toBe("PENDING");
    expect(mapDokuTransactionState(null)).toBe("PENDING");
  });
});

describe("parseDokuOrderStatus", () => {
  const body = {
    order: { invoice_number: "cmodtjyva1g7n7bx7lzpw5oht", amount: "20000.00" },
    transaction: {
      status: "SUCCESS",
      original_request_id: "req-abc-123",
      amount_details: { currency: "IDR" },
    },
    channel: { id: "VIRTUAL_ACCOUNT_BCA" },
  };

  it("reads a bare check-status body", () => {
    const out = parseDokuOrderStatus(body);
    expect(out.state).toBe("COMPLETED");
    expect(out.paymentId).toBe("req-abc-123");
    expect(out.amount).toBe(20000);
    expect(out.currency).toBe("IDR");
    expect(out.channelCode).toBe("VIRTUAL_ACCOUNT_BCA");
  });

  it("unwraps the `response` envelope DOKU uses on some endpoints", () => {
    expect(parseDokuOrderStatus({ response: body }).paymentId).toBe("req-abc-123");
  });

  describe("Checkout order.status", () => {
    const order = (status: string) => ({ order: { invoice_number: "inv1", amount: 20000, status } });

    it("reads ORDER_EXPIRED as expired when no transaction exists (link never opened)", () => {
      const out = parseDokuOrderStatus(order("ORDER_EXPIRED"));
      expect(out.state).toBe("EXPIRED");
      expect(out.rawStatus).toBe("ORDER_EXPIRED");
    });

    it("upgrades a PENDING transaction on an expired order", () => {
      const out = parseDokuOrderStatus({ ...order("ORDER_EXPIRED"), transaction: { status: "PENDING" } });
      expect(out.state).toBe("EXPIRED");
    });

    it.each([
      ["SUCCESS", "COMPLETED"],
      ["FAILED", "FAILED"],
      ["REFUNDED", "REFUNDED"],
    ])("never overrides a terminal transaction status (%s)", (status, state) => {
      const out = parseDokuOrderStatus({ ...order("ORDER_EXPIRED"), transaction: { status } });
      expect(out.state).toBe(state);
      expect(out.rawStatus).toBe(status);
    });

    it("leaves a live order pending and reports its order status when no transaction exists", () => {
      const out = parseDokuOrderStatus(order("ORDER_GENERATED"));
      expect(out.state).toBe("PENDING");
      expect(out.rawStatus).toBe("ORDER_GENERATED");
    });

    it("synthesises PENDING when the order carries no status and no transaction", () => {
      const out = parseDokuOrderStatus({ order: { invoice_number: "inv1", amount: 20000 } });
      expect(out.state).toBe("PENDING");
      expect(out.rawStatus).toBe("PENDING");
    });

    it("prefers the transaction status over the order status", () => {
      const out = parseDokuOrderStatus({ ...order("ORDER_GENERATED"), transaction: { status: "SUCCESS" } });
      expect(out.state).toBe("COMPLETED");
      expect(out.rawStatus).toBe("SUCCESS");
    });
  });

  it("degrades safely on junk", () => {
    const out = parseDokuOrderStatus({});
    expect(out.state).toBe("PENDING");
    expect(out.paymentId).toBeNull();
    expect(out.amount).toBeNull();
    expect(parseDokuOrderStatus(null).state).toBe("PENDING");
  });
});

describe("buildManualEventId", () => {
  it("is deterministic — repeated clicks on one gateway state collide on the unique index", () => {
    const a = buildManualEventId("xendit", "inv1", "COMPLETED", "py-1");
    const b = buildManualEventId("xendit", "inv1", "COMPLETED", "py-1");
    expect(a).toBe(b);
    expect(a).toBe("manual:xendit:inv1:COMPLETED:py-1");
  });

  it("separates distinct states, invoices and providers", () => {
    expect(buildManualEventId("xendit", "inv1", "EXPIRED", null)).toBe(
      "manual:xendit:inv1:EXPIRED",
    );
    expect(buildManualEventId("doku", "inv1", "COMPLETED", "py-1")).not.toBe(
      buildManualEventId("xendit", "inv1", "COMPLETED", "py-1"),
    );
    expect(buildManualEventId("xendit", "inv2", "COMPLETED", "py-1")).not.toBe(
      buildManualEventId("xendit", "inv1", "COMPLETED", "py-1"),
    );
  });

  it("never collides with a gateway-issued event id", () => {
    expect(buildManualEventId("xendit", "inv1", "COMPLETED", "py-1")).toMatch(
      /^manual:/,
    );
  });
});
