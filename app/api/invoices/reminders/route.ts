import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePagination } from "@/lib/api/pagination";
import { paginatedResponse } from "@/lib/api/response";
import { UNPAID_INVOICE_STATUSES } from "@/lib/finance/student-invoice-summary";
import { buildReminderQueue, toReminderRow } from "@/lib/finance/reminder-queue";

/**
 * GET /api/invoices/reminders — the WhatsApp reminder queue behind "Pengingat WhatsApp"
 * (cycle 2026-10-17-payment-link-reminders, D6).
 *
 * Unpaid invoices that still owe money AND whose primary active guardian has a number
 * WhatsApp can open, families never reminded first, then the oldest reminder, then the
 * oldest due date. Owed-but-unreachable invoices are not listed; they are counted in
 * `meta.excludedNoNumber` so the admin knows the queue is not the whole debt.
 *
 * The owing-money test is a field reference in `where` (`totalPaid < totalDue`), but the
 * order and the "has a usable number" split are not expressible there. A tenant has a few
 * hundred unpaid invoices at most, so this fetches them all with the guardian and
 * filters, sorts and paginates in memory (the in-memory remaining check stays as defence).
 * Rows carry a `waUrl` for the page only, never
 * a credential: the payment link is the invoice's own public checkout URL.
 *
 * Needs `payments.record` (D8: the collections role); tenant always from the session.
 * Read-only: recording a reminder is `POST /api/invoices/[id]/reminder`.
 */
/** Most unpaid invoices one queue request loads. */
const MAX_UNPAID_FETCH = 2000;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { skip, take, page, pageSize } = parsePagination(new URL(req.url).searchParams);

  const invoices = await prisma.invoice.findMany({
    where: {
      tenantId: session.tenantId,
      status: { in: [...UNPAID_INVOICE_STATUSES] },
      totalPaid: { lt: prisma.invoice.fields.totalDue },
    },
    select: {
      id: true,
      invoiceNumber: true,
      periodLabel: true,
      dueDate: true,
      status: true,
      totalDue: true,
      totalPaid: true,
      xenditPaymentUrl: true,
      lastRemindedAt: true,
      lastRemindedBy: true,
      remindCount: true,
      student: {
        select: {
          name: true,
          guardians: {
            where: { isPrimary: true, status: "ACTIVE" },
            take: 1,
            select: { parent: { select: { name: true, whatsapp: true, phone: true } } },
          },
        },
      },
    },
    // Safety cap, far above a real school's unpaid count: the queue is built in memory, so
    // a runaway tenant must not load unbounded. Hitting it is reported in `meta.truncated`.
    take: MAX_UNPAID_FETCH,
  });
  const truncated = invoices.length >= MAX_UNPAID_FETCH;

  const { queue, excludedNoNumber } = buildReminderQueue(invoices);
  const pageRows = queue.slice(skip, skip + take);

  // lastRemindedBy is a bare User id (no relation): resolve this page's names in one query.
  const actorIds = [...new Set(pageRows.map((c) => c.invoice.lastRemindedBy).filter((v): v is string => !!v))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds }, tenantId: session.tenantId },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorName = new Map(actors.map((u) => [u.id, u.name || u.email]));

  const rows = pageRows.map((c) =>
    toReminderRow(c, c.invoice.lastRemindedBy ? (actorName.get(c.invoice.lastRemindedBy) ?? null) : null),
  );

  const res = NextResponse.json({
    ...paginatedResponse(rows, queue.length, page, pageSize),
    meta: { excludedNoNumber, truncated },
  });
  // Rows hold guardian phone numbers and who-was-reminded-when: never cache.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
