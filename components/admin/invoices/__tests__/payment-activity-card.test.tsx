import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentActivityCard } from "../payment-activity-card";

function makeEvent(overrides: {
  id: string;
  eventType: string;
  status: string;
}) {
  return {
    errorMessage: null,
    errorLabel: null,
    createdAt: "2026-10-20T03:00:00.000Z",
    displayFields: {
      paidAt: "2026-10-20T03:00:00.000Z",
      paymentMethod: null,
      amount: 500000,
      currency: "IDR",
      sessionId: null,
      paymentId: null,
    },
    payload: {},
    ...overrides,
  };
}

function mockEvents(events: ReturnType<typeof makeEvent>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => events,
    } as unknown as Response),
  );
}

describe("PaymentActivityCard expired-event wording", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads processed manual.refresh.expired as the earlier link having expired", async () => {
    mockEvents([
      makeEvent({ id: "e1", eventType: "manual.refresh.expired", status: "PROCESSED" }),
    ]);
    render(<PaymentActivityCard invoiceId="inv-1" />);
    expect(await screen.findByText("Link sebelumnya kedaluwarsa")).toBeInTheDocument();
    expect(screen.queryByText("Perbarui manual · kedaluwarsa")).not.toBeInTheDocument();
  });

  it("reads processed payment_session.expired as the earlier link having expired", async () => {
    mockEvents([
      makeEvent({ id: "e2", eventType: "payment_session.expired", status: "PROCESSED" }),
    ]);
    render(<PaymentActivityCard invoiceId="inv-1" />);
    expect(await screen.findByText("Link sebelumnya kedaluwarsa")).toBeInTheDocument();
    expect(screen.queryByText("Sesi kedaluwarsa")).not.toBeInTheDocument();
  });

  it("keeps the old wording for ignored expired events", async () => {
    mockEvents([
      makeEvent({ id: "e3", eventType: "manual.refresh.expired", status: "IGNORED" }),
      makeEvent({ id: "e4", eventType: "payment_session.expired", status: "IGNORED" }),
    ]);
    render(<PaymentActivityCard invoiceId="inv-1" />);
    expect(await screen.findByText("Perbarui manual · kedaluwarsa")).toBeInTheDocument();
    expect(screen.getByText("Sesi kedaluwarsa")).toBeInTheDocument();
    expect(screen.queryByText("Link sebelumnya kedaluwarsa")).not.toBeInTheDocument();
  });

  it("keeps the old wording for expired events that errored", async () => {
    mockEvents([
      makeEvent({ id: "e5", eventType: "payment_session.expired", status: "ERROR" }),
    ]);
    render(<PaymentActivityCard invoiceId="inv-1" />);
    expect(await screen.findByText("Sesi kedaluwarsa")).toBeInTheDocument();
    expect(screen.queryByText("Link sebelumnya kedaluwarsa")).not.toBeInTheDocument();
  });

  it("leaves non-expiry events unchanged", async () => {
    mockEvents([
      makeEvent({ id: "e6", eventType: "payment_session.completed", status: "PROCESSED" }),
      makeEvent({ id: "e7", eventType: "manual.refresh.pending", status: "PROCESSED" }),
    ]);
    render(<PaymentActivityCard invoiceId="inv-1" />);
    expect(await screen.findByText("Pembayaran selesai")).toBeInTheDocument();
    expect(screen.getByText("Perbarui manual · menunggu")).toBeInTheDocument();
    expect(screen.queryByText("Link sebelumnya kedaluwarsa")).not.toBeInTheDocument();
  });
});
