import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { validateBody } from "@/lib/api/validate";
import { invoiceReminderConfigSchema } from "@/lib/validations/invoice-reminder-config";
import { getInvoiceReminderTemplate } from "@/lib/finance/reminder-template-store";
import { DEFAULT_REMINDER_TEMPLATE, effectiveReminderTemplate } from "@/lib/finance/reminder-template";

/**
 * GET/PUT /api/config/invoice-reminder — the school's own wording for the unpaid-invoice
 * WhatsApp reminder (cycle 2026-10-23-reminder-template). One text column on Tenant
 * (`invoiceReminderTemplate`, null = built-in default). Both verbs need `payments.record`,
 * the permission that sends reminders: the people who chase families own the wording.
 * Tenant always comes from the session.
 *
 * PUT `{ template }`: blank (or the default text itself) resets to the default; anything else must use only known
 * placeholders, include `{tautan}` and stay under the length cap (400 with the reason).
 */

function payload(stored: string | null) {
  return { template: effectiveReminderTemplate(stored), isDefault: stored === null, defaultTemplate: DEFAULT_REMINDER_TEMPLATE };
}

export async function GET() {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const res = NextResponse.json(payload(await getInvoiceReminderTemplate(session.tenantId)));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdminRole(session.role) || !hasPermission(session, "payments.record")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { tenantId } = session;

  const { success } = rateLimit(`update-invoice-reminder-template:${session.id}`, 10, 60_000);
  if (!success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  const result = await validateBody(invoiceReminderConfigSchema, body);
  if (result.error) return result.error;
  // Blank, or exactly the built-in text: store nothing, so the school keeps following the default.
  const next = result.data.template.trim() && result.data.template !== DEFAULT_REMINDER_TEMPLATE ? result.data.template : null;

  const before = await getInvoiceReminderTemplate(tenantId);
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { invoiceReminderTemplate: next } });
    await recordAudit(
      {
        tenantId,
        actorId: session.id,
        entity: "Tenant",
        entityId: tenantId,
        action: "update-reminder-template",
        before: { invoiceReminderTemplate: before },
        after: { invoiceReminderTemplate: next },
      },
      tx,
    );
  });

  return NextResponse.json(payload(next));
}
