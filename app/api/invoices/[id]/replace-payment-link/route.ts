import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { ensurePaymentLink, staleLinkCleared } from "@/lib/payments/ensure-link";
import { reconcileInvoicePayment } from "@/lib/payments/reconcile";

/** A gateway check plus a creation with its full retry budget (31.25 s) fits inside this. */
export const maxDuration = 60;

/**
 * Gateway states in which the stored checkout is still a plain, unpaid one. Anything else on
 * a NO_CHANGE answer (a payment the processor refused to credit, a refund, an unknown value)
 * is no evidence the old link is safe to drop. Same list as the parent's payment-link route.
 */
const USABLE_LINK_STATUSES = new Set(["ACTIVE", "PENDING", "FAILED", "VOIDED", "ORDER_GENERATED"]);
const UNPAID: ReadonlySet<string> = new Set(UNPAID_INVOICE_STATUSES);

const NOT_NEEDED = "Tagihan ini tidak perlu link baru.";
const CHECK_FAILED = "Link belum bisa diperiksa. Coba lagi sebentar lagi.";
// Retrying cannot help: the invoice has no session id or its link host is not a known gateway.
const CHECK_IMPOSSIBLE = "Link ini tidak bisa diperiksa otomatis. Hubungi tim teknis.";
const UNCHECKABLE_REASONS: ReadonlySet<string> = new Set(["NO_SESSION_ID", "UNKNOWN_LINK_PROVIDER"]);

type LinkRow = {
  status: string;
  totalDue: unknown;
  totalPaid: unknown;
  xenditSessionId: string | null;
  xenditPaymentUrl: string | null;
};
const owes = (i: LinkRow) => UNPAID.has(i.status) && Number(i.totalPaid) < Number(i.totalDue);
const settled = (i: LinkRow) => i.status === "PAID" || (UNPAID.has(i.status) && !owes(i));
const PAID_ANSWER = {
  outcome: "PAID",
  message: "Pembayaran sudah masuk dan dicatat. Link baru tidak dibuat.",
} as const;

/**
 * POST /api/invoices/[id]/replace-payment-link — "Buat link baru" on one invoice
 * (cycle 2026-10-17-payment-link-reminders, D5). No body.
 *
 * The admin wants a different link than the one the parent holds. Dropping a link that was
 * already paid would hand out a second way to pay a settled bill, so the gateway is asked
 * first (the same read-only reconcile as the parent's page and "Cek status pembayaran"):
 *
 *   - paid          → recorded by the reconcile, answer { outcome: "PAID" }, no new link;
 *   - cannot tell   → 502 and the old link stays (a failed check proves nothing);
 *   - otherwise     → the old link is cleared with a compare-and-swap on session + url (two
 *                     admins pressing at once cannot both replace it) and a new one is made.
 *
 * "Cannot tell" is every UNAVAILABLE answer except ORDER_NOT_FOUND. A 404 from the gateway is
 * a definite answer, not an outage: it holds no order for this link, so nothing was paid
 * through it, and the link is safe to replace (it is live but has no order behind it).
 * NO_SESSION_ID or an unrecognised link host say nothing about payments, so those stay 502
 * with a message that says retrying will not help.
 *
 * The old link may still accept money until it expires. A payment on it is credited to the
 * invoice by reference, an overpayment flagged for review, as before — the confirmation says so.
 *
 * Same permission as creating a link today (`invoices.create`); a miss on tenant is a 404.
 *
 *   403  not an admin with `invoices.create`
 *   404  no such invoice in this tenant
 *   409  not an unpaid invoice that still owes money
 *   429  rate limited
 *   502  the gateway could not be asked (old link kept) or the new link could not be made
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "invoices.create")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { success } = rateLimit(`replace-payment-link:${session.id}`, 10, 60_000);
  if (!success) {
    return NextResponse.json({ error: "Terlalu sering membuat link. Tunggu sebentar lalu coba lagi." }, { status: 429 });
  }

  const { id } = await params;
  const { tenantId } = session;
  const select = { status: true, totalDue: true, totalPaid: true, xenditSessionId: true, xenditPaymentUrl: true } as const;
  const found = await prisma.invoice.findFirst({ where: { id, tenantId }, select });
  if (!found) return NextResponse.json({ error: "Tagihan tidak ditemukan" }, { status: 404 });
  if (!owes(found)) return NextResponse.json({ error: NOT_NEEDED }, { status: 409 });

  // Parents see links through these tags; bust them once, after anything below changed state.
  let changed = false;
  const bust = () => {
    revalidateTag("parent-invoice-list", { expire: 0 });
    revalidateTag("student-invoices", { expire: 0 });
  };

  try {
    let current: LinkRow = found;

    if (found.xenditPaymentUrl) {
      let check: Awaited<ReturnType<typeof reconcileInvoicePayment>>;
      try {
        check = await reconcileInvoicePayment(id);
      } catch (error) {
        console.error("[REPLACE PAYMENT LINK] pre-check failed", {
          invoiceId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: CHECK_FAILED }, { status: 502 });
      }
      if (check.code === "UPDATED") changed = true;

      if (check.code === "NOT_FOUND") return NextResponse.json({ error: "Tagihan tidak ditemukan" }, { status: 404 });
      if (check.code === "UNAVAILABLE" && UNCHECKABLE_REASONS.has(check.unavailableReason ?? "")) {
        return NextResponse.json({ error: CHECK_IMPOSSIBLE }, { status: 502 });
      }
      if (
        check.code === "GATEWAY_ERROR" ||
        (check.code === "UNAVAILABLE" && check.unavailableReason !== "ORDER_NOT_FOUND")
      ) {
        return NextResponse.json({ error: CHECK_FAILED }, { status: 502 });
      }

      // The reconcile may have credited a payment or cleared an expired link: read what is true now.
      const fresh = await prisma.invoice.findFirst({ where: { id, tenantId }, select });
      if (!fresh) return NextResponse.json({ error: "Tagihan tidak ditemukan" }, { status: 404 });
      if (settled(fresh)) return NextResponse.json(PAID_ANSWER);
      if (!owes(fresh)) return NextResponse.json({ error: NOT_NEEDED }, { status: 409 });
      // Another caller may have replaced the link while the gateway check was in flight.
      // Reconciliation also reads the invoice itself, so conservatively keep any replacement
      // since our first read rather than applying a check to a different session or URL.
      if (
        fresh.xenditPaymentUrl &&
        (fresh.xenditSessionId !== found.xenditSessionId || fresh.xenditPaymentUrl !== found.xenditPaymentUrl)
      ) {
        return NextResponse.json({ outcome: "REPLACED", url: fresh.xenditPaymentUrl, created: false });
      }
      // Nothing moved, yet the gateway shows something other than a plain unpaid checkout.
      if (
        check.code === "NO_CHANGE" &&
        fresh.xenditPaymentUrl &&
        !USABLE_LINK_STATUSES.has(check.gatewayStatus?.toUpperCase() ?? "")
      ) {
        return NextResponse.json({ error: CHECK_FAILED }, { status: 502 });
      }
      current = fresh;
    }

    if (current.xenditPaymentUrl) {
      // Only clear the link we checked, and only while the invoice is still unpaid. The stamp
      // inside `staleLinkCleared` also voids any concurrent creator's claim, so a second link
      // cannot land next to ours.
      const cleared = await prisma.invoice.updateMany({
        where: {
          id,
          tenantId,
          status: { in: [...UNPAID_INVOICE_STATUSES] },
          xenditSessionId: current.xenditSessionId,
          xenditPaymentUrl: current.xenditPaymentUrl,
        },
        data: staleLinkCleared(new Date()),
      });
      if (cleared.count === 0) {
        const now = await prisma.invoice.findFirst({ where: { id, tenantId }, select });
        if (now && settled(now)) return NextResponse.json(PAID_ANSWER);
        if (!now || !owes(now)) return NextResponse.json({ error: NOT_NEEDED }, { status: 409 });
        if (now.xenditPaymentUrl && now.xenditPaymentUrl !== current.xenditPaymentUrl) {
          // Someone else just replaced it: hand back their link rather than make a third.
          return NextResponse.json({ outcome: "REPLACED", url: now.xenditPaymentUrl, created: false });
        }
        if (now.xenditPaymentUrl) {
          return NextResponse.json({ error: "Tagihan baru saja berubah. Muat ulang halaman lalu coba lagi." }, { status: 409 });
        }
        // Already cleared by someone else: make the new one below.
      } else {
        // Written before the create so a crash or failure below still leaves the trail.
        await recordAudit({
          tenantId,
          actorId: session.id,
          entity: "Invoice",
          entityId: id,
          action: "replace-payment-link",
          before: { url: current.xenditPaymentUrl },
          after: { url: null },
        });
      }
      changed = true;
    }

    const link = await ensurePaymentLink(id, tenantId, new URL(req.url).origin);
    if (link.kind === "READY") {
      changed = true;
      await recordAudit({
        tenantId,
        actorId: session.id,
        entity: "Invoice",
        entityId: id,
        action: "replace-payment-link",
        // Whatever link there was is gone by now (cleared above, or never there).
        before: { url: null },
        after: { url: link.paymentUrl },
      });
      return NextResponse.json({ outcome: "REPLACED", url: link.paymentUrl, created: link.created });
    }
    if (link.kind === "NOT_PAYABLE") {
      return NextResponse.json({ error: NOT_NEEDED }, { status: 409 });
    }
    // The old link is gone and the new one failed; the nightly heal and "Buat link baru (N)" retry it.
    return NextResponse.json(
      { error: "Link baru belum berhasil dibuat. Sistem akan mencoba lagi otomatis, atau coba lagi sebentar lagi." },
      { status: 502 },
    );
  } finally {
    if (changed) bust();
  }
}
