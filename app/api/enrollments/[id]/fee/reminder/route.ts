import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { resolveAppOrigin } from "@/lib/payments/session";
import { feeReminderWaUrl, parentFormUrl } from "@/lib/enrollment/follow-up";

/**
 * GET /api/enrollments/[id]/fee/reminder — one tap from the list or the detail
 * page opens WhatsApp on the parent's number with the payment reminder written.
 *
 * It answers with a REDIRECT to `wa.me`, built here, at click time. The message
 * carries the parent's form link, whose access token is the only credential of
 * the public pendaftaran pages — so no list or JSON response ever holds a token
 * (a page of 100 rows would otherwise hand 100 credentials to the browser); one
 * token leaves the server, for one application, when staff press the button.
 * A plain link (`<a target="_blank">`) also works where a script-opened window
 * would be blocked.
 *
 *   302  → https://wa.me/<number>?text=…
 *   409  nothing to chase (the fee is paid or waived, or the application was rejected)
 *   422  no number WhatsApp can open (the UI disables the button before this)
 *
 * Needs `admissions.edit`; tenant always from the session. Read-only, no state change.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "admissions.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = rateLimit(`enrollment-fee-reminder:${session.id}`, 60, 60_000);
  if (!limit.success) return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });

  const { id } = await params;
  const app = await prisma.enrollmentApplication.findFirst({
    where: { id, tenantId: session.tenantId },
    select: {
      status: true,
      accessToken: true,
      childName: true,
      ayahData: true,
      ibuData: true,
      admission: { select: { parentName: true, parentPhone: true, parentWhatsapp: true } },
      fee: { select: { status: true, amount: true } },
    },
  });
  if (!app || !app.fee) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (app.fee.status !== "UNPAID") {
    return NextResponse.json({ error: "Biaya pendaftaran ini sudah selesai, tidak ada yang perlu diingatkan." }, { status: 409 });
  }

  if (app.status === "REJECTED") {
    return NextResponse.json({ error: "Pendaftaran ini sudah ditolak, tautan pembayarannya tidak berlaku lagi." }, { status: 409 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { name: true } });

  const waUrl = feeReminderWaUrl({
    schoolName: tenant?.name,
    admission: app.admission,
    ayahData: app.ayahData,
    ibuData: app.ibuData,
    parentName: app.admission?.parentName,
    childName: app.childName,
    amount: Math.round(Number(app.fee.amount)),
    formUrl: parentFormUrl(resolveAppOrigin(new URL(req.url).origin), app.accessToken),
  });
  if (!waUrl) {
    return NextResponse.json({ error: "Belum ada nomor WhatsApp orang tua yang bisa dihubungi." }, { status: 422 });
  }

  const res = NextResponse.redirect(waUrl, 302);
  // The URL carries a credential: never cache it anywhere.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
