/**
 * Finish the Xendit phase only — for DRAFT invoices missing a payment URL.
 * Does NOT wipe. Conservative concurrency. Uses payment URL as the
 * idempotency marker (the prior run's Xendit response had a missing `id`
 * field, so xenditSessionId is null even when payment_link_url is present).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { createXenditSession } from "../lib/xendit/client";
import { defaultExpiresAt } from "../lib/payments/expiry";
import { validateReseedEnv, formatGuardErrors } from "./reseed/guards";

const CONCURRENCY = 2;
const TAIL_PACE_MS = 600;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const guard = validateReseedEnv({
    STAGING_CONFIRM: process.env.STAGING_CONFIRM,
    STAGING_SUPABASE_REF: process.env.STAGING_SUPABASE_REF,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    XENDIT_SECRET_KEY: process.env.XENDIT_SECRET_KEY,
  });
  if (!guard.ok || !guard.resolved) {
    console.error(formatGuardErrors(guard.errors));
    process.exit(1);
  }
  console.log("[finish-xendit] target staging:", guard.resolved.stagingRef);

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    // Find DRAFT invoices that lack a payment URL.
    const pending = await prisma.invoice.findMany({
      where: { status: "DRAFT", xenditPaymentUrl: null },
      include: {
        student: { select: { name: true } },
        parent: { select: { name: true, email: true, phone: true } },
        lines: {
          select: { labelSnapshot: true, finalAmount: true },
        },
      },
    });
    console.log(`[finish-xendit] ${pending.length} DRAFT invoices to send`);

    let made = 0;
    let failed = 0;
    const queue = [...pending];
    const retryCounts = new Map<string, number>();
    const MAX_RATE_LIMIT_RETRIES = 3;

    const worker = async (workerId: number) => {
      for (;;) {
        const inv = queue.shift();
        if (!inv) return;
        try {
          const expiresAt = defaultExpiresAt();
          const session = await createXenditSession({
            // Bare invoice.id — webhook handler lookup keys on this. See
            // scripts/reseed/invoices.ts comment for the same constraint.
            referenceId: inv.id,
            amount: Number(inv.totalDue),
            description: `SPP ${inv.periodLabel} — ${inv.student.name}`,
            customerName: inv.parent?.name ?? "Wali Murid",
            customerEmail: inv.parent?.email ?? undefined,
            customerPhone: inv.parent?.phone ?? undefined,
            successReturnUrl: "https://annisaa-erp-v3.vercel.app/payment/success",
            cancelReturnUrl: "https://annisaa-erp-v3.vercel.app/payment/cancel",
            // One-off backfill script; its invoice query does not select
            // `dueDate`, so it keeps the historical 7-day default rather than
            // deriving expiry the way the live invoice path does.
            expiresAt,
            items: inv.lines.map((l) => ({
              name: l.labelSnapshot,
              quantity: 1,
              price: Number(l.finalAmount),
            })),
          });
          await prisma.invoice.update({
            where: { id: inv.id },
            data: {
              // session.id may be undefined due to Xendit response shape;
              // use payment URL as primary marker.
              xenditSessionId: session.id ?? null,
              xenditPaymentUrl: session.payment_link_url,
              // The expiry we asked for, saved with the link (not the gateway's echo).
              paymentLinkExpiresAt: expiresAt,
              status: "SENT",
              sentAt: new Date(),
            },
          });
          made++;
          if (made % 20 === 0) {
            console.log(`[finish-xendit] ${made}/${pending.length} sent`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/rate/i.test(msg)) {
            const retries = (retryCounts.get(inv.id) ?? 0) + 1;
            if (retries >= MAX_RATE_LIMIT_RETRIES) {
              failed++;
              console.error(
                `[finish-xendit] giving up on ${inv.id} after ${retries} rate-limit hits`,
              );
            } else {
              retryCounts.set(inv.id, retries);
              queue.push(inv);
              await sleep(60_000);
            }
          } else {
            failed++;
            console.error(
              `[finish-xendit] worker ${workerId} permanent fail on invoice ${inv.id}: ${msg}`,
            );
          }
        }
        await sleep(TAIL_PACE_MS);
      }
    };

    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => worker(i)),
    );

    console.log(`[finish-xendit] done. sent=${made} permanent_failed=${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[finish-xendit] fatal:", err);
  process.exit(1);
});
