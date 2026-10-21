import { prisma } from "@/lib/db";
import { getGateway } from "./registry";
import { paymentLinkProvider } from "./link-provider";
import { GatewayApiError, type GatewayPaymentStatus } from "./types";
import { DUPLICATE_PAYMENT_AFTER_PAID, PAID_ON_CANCELLED_INVOICE } from "./needs-review";
import {
  processPaymentEvent,
  type NormalizedPaymentEvent,
} from "./webhook-processor";

/** Admin-facing sentence whenever an expired session's dead link was cleared. */
const EXPIRED_LINK_CLEARED_MESSAGE =
  "Sesi pembayaran sudah kedaluwarsa. Link lama dihapus — silakan buat link baru.";

/**
 * Invoice status → Indonesian label, for user-facing reconcile messages.
 *
 * Deliberately a local copy rather than an import of `getStatusConfig` from
 * `components/ui/status-badge` — a lib module must not depend on a React
 * component module. Keep in sync with STATUS_MAP there; the labels are
 * asserted by voice.md's glossary ("Link Dibuat" not "Terkirim", "Lewat
 * Tempo" not "Jatuh Tempo", since "jatuh tempo" is the due date itself).
 */
const INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Link Dibuat",
  PAID: "Lunas",
  OVERDUE: "Lewat Tempo",
  PARTIALLY_PAID: "Dibayar Sebagian",
  PENDING_PAYMENT_LINK: "Link Gagal",
  CANCELLED: "Dibatalkan",
};

/**
 * Manual payment reconciliation — the "Perbarui pembayaran" fallback for when
 * a gateway webhook never arrived (cycle 2026-07-28-manual-payment-refresh).
 *
 * Design rule: this module performs NO state transitions of its own. It polls
 * the gateway, normalizes the answer into exactly the `NormalizedPaymentEvent`
 * a webhook route would have built, and hands it to the shared
 * `processPaymentEvent`. Every guard the webhook path enforces — the durable
 * WebhookEvent receipt, the P2002 dedup, the per-invoice advisory lock, the
 * amount/currency/payment-id checks, the overpayment tolerance, the
 * PAID/CANCELLED short-circuits, the cache-tag bust — therefore applies here
 * verbatim. Manual refresh and webhook cannot drift, because there is only one
 * implementation.
 *
 * Idempotency (safe to click repeatedly) comes from three independent layers:
 *   1. `eventId` is a pure function of (provider, invoiceId, state, paymentId).
 *      Clicking twice against an unchanged gateway state hits the
 *      `WebhookEvent.eventId` unique index → P2002 → `{duplicate:true}` noop.
 *   2. `Payment.xenditPaymentId` is unique and checked inside the advisory
 *      lock, so no duplicate Payment row can be inserted for one settlement.
 *   3. The processor never credits a `PAID` / `CANCELLED` invoice: a redelivery is a
 *      no-op, and a different payment on one is flagged (NEEDS_REVIEW), not recorded.
 */

/** Machine-readable result code. The route returns this; the UI branches on it. */
export type ReconcileCode =
  | "UPDATED"
  | "ALREADY_PAID"
  | "NO_CHANGE"
  | "UNAVAILABLE"
  | "GATEWAY_ERROR"
  | "NOT_FOUND"
  /**
   * The gateway holds a payment the processor refused to credit: for a pendaftaran
   * fee a wrong amount, a second payment or money on a waived fee; for an invoice a
   * second payment on a Lunas invoice or any payment on a Dibatalkan one. Nothing
   * is recorded and the money needs a human — never reported as a quiet NO_CHANGE.
   */
  | "NEEDS_REVIEW";

export type ReconcileResult = {
  code: ReconcileCode;
  /** Indonesian, admin-facing — rendered directly in the toast. */
  message: string;
  provider: string;
  /** Gateway's own status string, for triage. Null when never reached. */
  gatewayStatus: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  /** Outcome string from the shared processor, when it ran. */
  processorStatus?: string;
  /** True when the identical gateway state had already been processed. */
  duplicate?: boolean;
  /** Only on UNAVAILABLE: why the gateway could not answer (e.g. ORDER_NOT_FOUND). */
  unavailableReason?: string;
};

/**
 * Build the `eventId` for a manual poll.
 *
 * Deterministic on purpose — the same gateway state must always produce the
 * same id so repeated clicks dedup at the unique index. Deliberately NOT
 * hashed over the raw response body: that carries timestamps, which would
 * mint a fresh id on every click and defeat layer 1 of the idempotency stack.
 *
 * The `manual:` prefix keeps these rows visually distinct from real webhook
 * deliveries in the admin activity panel, and guarantees no collision with a
 * gateway-issued event id.
 *
 * Exported for unit testing.
 */
export function buildManualEventId(
  provider: string,
  invoiceId: string,
  state: string,
  paymentId: string | null,
): string {
  const suffix = paymentId ? `:${paymentId}` : "";
  return `manual:${provider}:${invoiceId}:${state}${suffix}`;
}

/**
 * Map a polled gateway state onto the webhook `kind` vocabulary.
 *
 * Only COMPLETED, EXPIRED and REFUNDED are dispatched to the processor.
 * PENDING and FAILED are pure no-ops and never reach it: nobody has paid, and
 * a failed/voided attempt is not an expiry — reverting on it would destroy a
 * payment link the parent could still retry. Returning null here means "write
 * no audit row, change nothing".
 */
function kindForState(
  status: GatewayPaymentStatus,
): { kind: NormalizedPaymentEvent["kind"]; ignoreReason?: string } | null {
  switch (status.state) {
    case "COMPLETED":
      return { kind: "PAYMENT_COMPLETED" };
    case "EXPIRED":
      return { kind: "SESSION_EXPIRED" };
    case "REFUNDED":
      // Same special-case the DOKU notification route uses — the processor
      // marks the row ERROR so a refund surfaces to an admin (AC-14) instead
      // of being silently swallowed.
      return { kind: "UNHANDLED", ignoreReason: "REFUND_UNHANDLED" };
    default:
      return null;
  }
}

function gatewayErrorMessage(err: GatewayApiError): string {
  if (err.code === "401" || err.code === "403") {
    return "Kredensial gateway pembayaran ditolak. Hubungi admin sistem.";
  }
  if (err.code === "network" || err.code === "408") {
    return "Gateway pembayaran tidak merespons. Coba lagi sebentar.";
  }
  if (err.code === "429") {
    return "Terlalu banyak permintaan ke gateway. Tunggu sebentar lalu coba lagi.";
  }
  if (err.code === "5xx") {
    return "Gateway pembayaran sedang bermasalah. Coba lagi sebentar.";
  }
  // 422/4xx/unknown — no code branch above claims these codes, and
  // `err.message` is raw vendor text (voice.md "Never render a caught
  // error"). The caller already `console.error`s the raw message alongside
  // this generic sentence.
  return "Gagal memeriksa status ke gateway. Coba lagi atau hubungi tim teknis.";
}

function unavailableMessage(reason: string | undefined): string {
  if (reason === "NO_SESSION_ID") {
    return "Tagihan ini belum punya ID sesi pembayaran, jadi statusnya tidak bisa diperiksa. Buat ulang link pembayaran terlebih dahulu.";
  }
  if (reason === "ORDER_NOT_FOUND") {
    return "Gateway belum punya catatan transaksi untuk tagihan ini. Belum ada pembayaran yang dimulai.";
  }
  return "Status pembayaran tidak bisa diperiksa saat ini.";
}

const GATEWAY_LABELS: Record<string, string> = { xendit: "Xendit", doku: "DOKU" };

/** Admin-facing sentence for a payment the processor refused to record on an invoice. */
function invoiceReviewMessage(processorStatus: string | undefined, provider: string): string | null {
  const gateway = GATEWAY_LABELS[provider] ?? "gateway";
  switch (processorStatus) {
    case "ERROR:duplicate_payment_after_paid":
      return `Ada pembayaran kedua di ${gateway} untuk tagihan yang sudah lunas. Pembayaran ini tidak dicatat — periksa di dashboard ${gateway} dan kembalikan dana bila perlu.`;
    case "ERROR:paid_on_cancelled_invoice":
      return `Ada pembayaran di ${gateway} untuk tagihan yang sudah dibatalkan. Pembayaran ini tidak dicatat — periksa di dashboard ${gateway} dan kembalikan dana.`;
    default:
      return null;
  }
}

/** The processor status an earlier poll stored for `eventId`, when it was a flagged invoice payment. */
async function storedReviewStatus(eventId: string): Promise<string | undefined> {
  try {
    const stored = await prisma.webhookEvent.findUnique({
      where: { eventId },
      select: { errorMessage: true },
    });
    if (stored?.errorMessage === DUPLICATE_PAYMENT_AFTER_PAID) return "ERROR:duplicate_payment_after_paid";
    if (stored?.errorMessage === PAID_ON_CANCELLED_INVOICE) return "ERROR:paid_on_cancelled_invoice";
  } catch {
    // Best effort: without the stored event the caller falls back to the ordinary message.
  }
  return undefined;
}

/**
 * Poll the active gateway for `invoiceId` and reconcile the local invoice with
 * what it reports. Read-only against the gateway; all local writes go through
 * `processPaymentEvent`.
 *
 * The caller is responsible for authentication and the tenant check — this
 * function assumes the invoice has already been authorised.
 */
export async function reconcileInvoicePayment(
  invoiceId: string,
  opts: { minIntervalMs?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();

  const before = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      xenditSessionId: true,
      xenditPaymentUrl: true,
      totalPaid: true,
    },
  });
  if (!before) {
    return {
      code: "NOT_FOUND",
      message: "Tagihan tidak ditemukan.",
      provider: getGateway().id,
      gatewayStatus: null,
      statusBefore: null,
      statusAfter: null,
    };
  }

  const gateway = getGateway(before.xenditPaymentUrl);
  const provider = gateway.id;
  const owner = paymentLinkProvider(before.xenditPaymentUrl);

  // Stamp `paymentCheckedAt` BEFORE the network call, on every path, so the
  // nightly sweep rotates (least recently checked first) and admin/parent polls
  // count too. With `minIntervalMs` the stamp is an atomic claim — one statement
  // both checks the interval and writes it — so concurrent callers cannot each
  // pass a read-then-write check and each hit the gateway; the lock lives in the
  // database, so it holds across serverless instances. A failed poll is simply
  // retried after the interval. Without it (admin button, cron) it always polls.
  if (opts.minIntervalMs !== undefined) {
    const claim = await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        OR: [
          { paymentCheckedAt: null },
          { paymentCheckedAt: { lt: new Date(now.getTime() - opts.minIntervalMs) } },
        ],
      },
      data: { paymentCheckedAt: now },
    });
    if (claim.count === 0) {
      return {
        code: "NO_CHANGE",
        message: "Baru saja diperiksa.",
        provider,
        gatewayStatus: null,
        statusBefore: before.status,
        statusAfter: before.status,
      };
    }
  } else {
    // Never overwrite a link-creation claim: while `createPaymentSessionForInvoice` is making a
    // link it holds a `paymentCheckedAt` stamp in the future, and an admin refresh landing in
    // that window would otherwise erase it and let a second creator in. A check stamps "now",
    // so it only ever replaces a stamp that is not in the future.
    await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        OR: [{ paymentCheckedAt: null }, { paymentCheckedAt: { lte: now } }],
      },
      data: { paymentCheckedAt: now },
    });
  }

  let status: GatewayPaymentStatus;
  try {
    if ((owner === "demo-xendit" || owner === "demo-doku") && process.env.DEMO_MODE !== "true") {
      // These exact hosts are emitted only by our demo factories. They cannot accept money;
      // retire them through the ordinary expiry processor and its session+URL CAS.
      status = {
        state: "EXPIRED", rawStatus: "DEMO_LINK_RETIRED", paymentId: null,
        amount: null, currency: null, channelCode: null,
        raw: { source: "demo-link-retirement" },
      };
    } else if (before.xenditPaymentUrl && owner === null) {
      status = {
        state: "UNAVAILABLE", rawStatus: null, paymentId: null,
        amount: null, currency: null, channelCode: null, raw: null,
        unavailableReason: "UNKNOWN_LINK_PROVIDER",
      };
    } else {
      status = await gateway.fetchPaymentStatus({
        invoiceId: before.id,
        sessionId: before.xenditSessionId,
      });
    }
  } catch (err) {
    const message =
      err instanceof GatewayApiError
        ? gatewayErrorMessage(err)
        // Non-gateway throw (e.g. a plain fetch/runtime error) — no raw
        // exception text in the user-facing message (voice.md "Never render
        // a caught error"); the console.error below carries the raw text.
        : "Gagal memeriksa status ke gateway. Coba lagi atau hubungi tim teknis.";
    console.error(
      `[PAYMENT REFRESH] provider=${provider} invoice=${before.invoiceNumber} lookup failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return {
      code: "GATEWAY_ERROR",
      message,
      provider,
      gatewayStatus: null,
      statusBefore: before.status,
      statusAfter: before.status,
    };
  }

  if (status.state === "UNAVAILABLE") {
    return {
      code: "UNAVAILABLE",
      message: unavailableMessage(status.unavailableReason),
      provider,
      gatewayStatus: null,
      statusBefore: before.status,
      statusAfter: before.status,
      unavailableReason: status.unavailableReason,
    };
  }

  const dispatch = kindForState(status);
  if (!dispatch) {
    // PENDING / FAILED — nothing to transition. No audit row is written; a
    // click that finds "still unpaid" is not an event worth persisting.
    return {
      code: "NO_CHANGE",
      // The raw gateway status string is NOT spliced into the sentence
      // (voice.md "Never render a caught error" — a vendor enum value is not
      // ours to render). It is still available to the UI as a secondary
      // caption via the `gatewayStatus` field below.
      message:
        status.state === "FAILED"
          ? "Percobaan pembayaran terakhir gagal di gateway. Tagihan tidak berubah."
          : "Belum ada pembayaran masuk.",
      provider,
      gatewayStatus: status.rawStatus,
      statusBefore: before.status,
      statusAfter: before.status,
    };
  }

  // An expired session carries no payment id, so key it on the session: a later
  // link for the same invoice that also expires is a new event, not a duplicate
  // of the first (which would leave its dead link in place).
  const eventId = buildManualEventId(
    provider,
    before.id,
    status.state,
    status.paymentId ?? before.xenditSessionId,
  );

  const normalized: NormalizedPaymentEvent = {
    provider,
    eventId,
    eventType: `manual.refresh.${status.state.toLowerCase()}`,
    kind: dispatch.kind,
    // The invoice was resolved by primary key above, so hand the processor the
    // id directly — no reference_id string surgery, no session fallback needed.
    referenceId: before.id,
    sessionId: before.xenditSessionId,
    ...(dispatch.kind === "SESSION_EXPIRED" ? { expectedPaymentUrl: before.xenditPaymentUrl } : {}),
    paymentId: status.paymentId,
    amount: status.amount,
    currency: status.currency,
    channelCode: status.channelCode,
    rawPayload: {
      source: "manual-refresh",
      provider,
      invoiceId: before.id,
      gatewayStatus: status.rawStatus,
      gatewayResponse: status.raw,
    },
    ignoreReason: dispatch.ignoreReason,
  };

  const { body } = await processPaymentEvent(normalized);
  const outcome = (body ?? {}) as { status?: string; duplicate?: boolean };

  const after = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { status: true, totalPaid: true },
  });
  const statusAfter = after?.status ?? before.status;
  // A partial payment on an OVERDUE invoice leaves it OVERDUE, but money was credited.
  const paidMoved = String(after?.totalPaid ?? before.totalPaid) !== String(before.totalPaid);
  const changed = statusAfter !== before.status || paidMoved;

  console.info("[PAYMENT REFRESH]", {
    provider,
    invoiceNumber: before.invoiceNumber,
    gatewayStatus: status.rawStatus,
    statusBefore: before.status,
    statusAfter,
    eventId,
    processorStatus: outcome.status,
    duplicate: outcome.duplicate ?? false,
  });

  const base = {
    provider,
    gatewayStatus: status.rawStatus,
    statusBefore: before.status,
    statusAfter,
    processorStatus: outcome.status,
    duplicate: outcome.duplicate,
  };

  // An expired link: the status may not move (Link Dibuat before its due date,
  // Dibayar Sebagian, Lewat Tempo) but the dead link was cleared, which is a real
  // change the admin needs to hear about.
  if (outcome.status === "LINK_CLEARED" || outcome.status === "PROMOTED_OVERDUE") {
    return {
      ...base,
      code: "UPDATED",
      message:
        EXPIRED_LINK_CLEARED_MESSAGE,
    };
  }

  // A payment the processor refused to record (a second one on a Lunas invoice, or one on a
  // Dibatalkan invoice) leaves the invoice as it was, so it is never "changed" and must not fall
  // through to the reassuring "sudah lunas" below: money sits at the gateway and needs a person.
  // Clicking again hits the event-id dedup, which answers `duplicate` with no status: read the
  // stored event so the second click says the same thing as the first.
  const review = invoiceReviewMessage(
    outcome.duplicate ? await storedReviewStatus(eventId) ?? outcome.status : outcome.status,
    provider,
  );
  if (review) return { ...base, code: "NEEDS_REVIEW", message: review };

  if (changed) {
    return {
      ...base,
      code: "UPDATED",
      message:
        statusAfter === "PAID"
          ? "Pembayaran ditemukan di gateway — tagihan ditandai LUNAS."
          : statusAfter === "PARTIALLY_PAID" || paidMoved
            ? "Pembayaran sebagian ditemukan di gateway — tagihan diperbarui."
            : `Status tagihan diperbarui menjadi ${INVOICE_STATUS_LABELS[statusAfter] ?? statusAfter}.`,
    };
  }

  // Refund is checked BEFORE the already-paid branch: a refunded invoice is
  // still locally PAID, so the PAID branch would otherwise report the
  // reassuring "sudah lunas" for money that has gone back to the parent.
  if (status.state === "REFUNDED" || outcome.status === "REFUND_UNHANDLED") {
    return {
      ...base,
      code: "NO_CHANGE",
      message:
        "Gateway melaporkan pengembalian dana (refund). Perlu ditangani manual — cek panel Aktivitas.",
    };
  }

  if (statusAfter === "PAID") {
    return {
      ...base,
      code: "ALREADY_PAID",
      message: "Tagihan sudah lunas — tidak ada perubahan.",
    };
  }

  // Reached the processor but nothing moved: a duplicate poll, a CANCELLED
  // invoice, or a guard rejection (missing amount / payment id / non-IDR
  // currency). The activity panel carries the detail; keep the toast honest
  // rather than implying success.
  return {
    ...base,
    code: "NO_CHANGE",
    // Same rule as the NO_CHANGE branch above — no raw gateway status spliced
    // into the sentence; `gatewayStatus` on `base` already carries it.
    message: outcome.duplicate
      ? "Status sudah sinkron dengan gateway — tidak ada perubahan."
      : "Tidak ada perubahan status. Cek panel Aktivitas untuk detail.",
  };
}

/**
 * Poll the gateway for a pendaftaran fee and reconcile it — the pull path for
 * a parent who has no login and cannot press "Perbarui pembayaran", and for the
 * daily sweep. Same rule as `reconcileInvoicePayment`: no state change of its
 * own, everything goes through `processPaymentEvent`, so the lock, the dedup,
 * the amount-must-equal-fee check and idempotency apply verbatim.
 *
 * `minIntervalMs` throttles callers a stranger can trigger (the public return
 * page): a fee checked more recently than that answers NO_CHANGE without
 * touching the gateway, so one open tab cannot be turned into a request flood.
 * Pass 0 (staff, cron) to always poll.
 *
 * The caller authorises the fee (token row or staff session + tenant).
 */
export async function reconcileEnrollmentFee(
  feeId: string,
  opts: { minIntervalMs?: number; now?: Date } = {},
): Promise<ReconcileResult> {
  const gateway = getGateway();
  const provider = gateway.id;
  const now = opts.now ?? new Date();
  const minIntervalMs = opts.minIntervalMs ?? 0;

  const before = await prisma.enrollmentFee.findUnique({
    where: { id: feeId },
    select: { id: true, status: true, gatewaySessionId: true },
  });
  const none = (code: ReconcileCode, message: string, status: string | null): ReconcileResult => ({
    code,
    message,
    provider,
    gatewayStatus: null,
    statusBefore: status,
    statusAfter: status,
  });
  if (!before) return none("NOT_FOUND", "Biaya pendaftaran tidak ditemukan.", null);
  if (before.status === "PAID" || before.status === "WAIVED") {
    return none("ALREADY_PAID", "Biaya pendaftaran sudah selesai — tidak ada perubahan.", before.status);
  }
  // No order was ever opened at the gateway, so it has nothing to report. The
  // test is the SESSION that was issued, not the stored link: staff changing the
  // amount drops the link (so it is not handed out again) but a parent may still
  // hold the old order and pay it, and that payment must stay findable.
  if (!before.gatewaySessionId) {
    return none("NO_CHANGE", "Pembayaran belum dimulai.", before.status);
  }
  // Claim the poll ATOMICALLY: one statement both checks the interval and stamps
  // `lastCheckedAt`, so N concurrent loads of the same page cannot each pass a
  // read-then-write check and each call the gateway. The stamp lands BEFORE the
  // network call; a failed poll is simply retried after the interval. The lock
  // lives in the database, so it holds across serverless instances too.
  const claim = await prisma.enrollmentFee.updateMany({
    where: {
      id: feeId,
      status: "UNPAID",
      ...(minIntervalMs > 0
        ? { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - minIntervalMs) } }] }
        : {}),
    },
    data: { lastCheckedAt: now },
  });
  if (claim.count === 0) {
    return none("NO_CHANGE", "Baru saja diperiksa.", before.status);
  }

  let status: GatewayPaymentStatus;
  try {
    status = await gateway.fetchPaymentStatus({ invoiceId: before.id, sessionId: before.gatewaySessionId });
  } catch (err) {
    console.error(
      `[ENROLLMENT FEE REFRESH] provider=${provider} fee=${before.id} lookup failed:`,
      err instanceof Error ? err.message : String(err),
    );
    return none(
      "GATEWAY_ERROR",
      err instanceof GatewayApiError ? gatewayErrorMessage(err) : "Gagal memeriksa status ke gateway. Coba lagi sebentar.",
      before.status,
    );
  }

  if (status.state === "UNAVAILABLE") {
    return none("UNAVAILABLE", unavailableMessage(status.unavailableReason), before.status);
  }

  const dispatch = kindForState(status);
  if (!dispatch) {
    return {
      ...none("NO_CHANGE", status.state === "FAILED" ? "Percobaan pembayaran terakhir gagal." : "Belum ada pembayaran masuk.", before.status),
      gatewayStatus: status.rawStatus,
    };
  }

  // A fee is re-issued a fresh session after each expiry, all under the same
  // reference. An expiry has no payment id, so key it on the session instead;
  // otherwise the SECOND session's expiry would hit the first one's dedup row
  // and never clear its link.
  const eventId = buildManualEventId(provider, before.id, status.state, status.paymentId ?? before.gatewaySessionId);
  const { body } = await processPaymentEvent({
    provider,
    eventId,
    eventType: `manual.refresh.${status.state.toLowerCase()}`,
    kind: dispatch.kind,
    referenceId: before.id,
    sessionId: before.gatewaySessionId,
    paymentId: status.paymentId,
    amount: status.amount,
    currency: status.currency,
    channelCode: status.channelCode,
    rawPayload: {
      source: "manual-refresh",
      provider,
      enrollmentFeeId: before.id,
      gatewayStatus: status.rawStatus,
      gatewayResponse: status.raw,
    },
    ignoreReason: dispatch.ignoreReason,
  });
  const outcome = (body ?? {}) as { status?: string; duplicate?: boolean };

  const after = await prisma.enrollmentFee.findUnique({ where: { id: feeId }, select: { status: true } });
  const statusAfter = after?.status ?? before.status;
  const base = {
    provider,
    gatewayStatus: status.rawStatus,
    statusBefore: before.status,
    statusAfter,
    processorStatus: outcome.status,
    duplicate: outcome.duplicate,
  };
  console.info("[ENROLLMENT FEE REFRESH]", { provider, feeId: before.id, statusBefore: before.status, statusAfter, eventId, processorStatus: outcome.status });

  if (statusAfter !== before.status) {
    return {
      ...base,
      code: "UPDATED",
      message:
        statusAfter === "PAID"
          ? "Pembayaran ditemukan di gateway — biaya pendaftaran ditandai LUNAS."
          : "Status biaya pendaftaran diperbarui.",
    };
  }
  if (status.state === "REFUNDED" || outcome.status === "REFUND_UNHANDLED") {
    return { ...base, code: "NO_CHANGE", message: "Gateway melaporkan pengembalian dana (refund). Perlu ditangani manual." };
  }
  // SESSION_EXPIRED reverts the stored link without changing the status.
  if (status.state === "EXPIRED") {
    return { ...base, code: "NO_CHANGE", message: "Sesi pembayaran sudah kedaluwarsa. Buat tautan baru." };
  }
  // A payment the processor refused to credit. Said plainly and given its own
  // code: a quiet "no change" here would leave money at the gateway that nobody
  // knows about (the parent sees "menunggu", staff see "belum bayar").
  const review = feeReviewMessage(outcome.status);
  if (review) return { ...base, code: "NEEDS_REVIEW", message: review };
  // Some other guard rejected it (missing payment id, non-IDR): the ERROR row says which.
  return { ...base, code: "NO_CHANGE", message: "Tidak ada perubahan status. Pembayaran di gateway belum bisa dicatat." };
}

/** Staff-facing sentence for a processor outcome that leaves money needing a human. */
function feeReviewMessage(processorStatus: string | undefined): string | null {
  switch (processorStatus) {
    case "ERROR:amount_mismatch":
      return "Ada pembayaran yang jumlahnya berbeda dari biaya pendaftaran, jadi biaya tetap Belum bayar. Periksa di dashboard DOKU lalu tangani manual (mis. kembalikan dana atau sesuaikan biaya).";
    case "ERROR:duplicate_payment_after_paid":
      return "Ada pembayaran kedua untuk biaya yang sudah lunas. Periksa di dashboard DOKU dan kembalikan dana bila perlu.";
    case "ERROR:paid_on_waived_fee":
      return "Ada pembayaran untuk biaya yang sudah dibebaskan. Periksa di dashboard DOKU dan kembalikan dana.";
    case "ERROR:duplicate_payment_id":
      return "Pembayaran ini sudah tercatat pada biaya lain. Periksa di dashboard DOKU.";
    default:
      return null;
  }
}
