// @public — tokenized pendaftaran fee payment link. NO session; the unguessable
// accessToken is the credential. See proxy.ts public allow-list
// (`/api/enrollments/token/`).
import { type NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveEnrollmentAccess } from "@/lib/enrollment/resolve-token";
import { isTokenShape } from "@/lib/enrollment/token";
import { FEE_LINK_FAILED_MESSAGE, getOrCreateFeePaymentLink } from "@/lib/enrollment/fee-payment";

const RATE_LIMIT_PER_MIN = 10;
const TOKEN_LIMIT_PER_MIN = 6;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/enrollments/token/[token]/pay — the link the parent follows to pay
 * the pendaftaran fee. The fee is created when the form is submitted, so this
 * serves a submitted application; an open form only has a fee when it was sent
 * under the short-lived pay-first order, and is served the same way.
 *
 *   200 { paymentUrl }          payable gateway link (stored one, or a fresh one)
 *   200 { status: "PAID" | "WAIVED" }   nothing left to pay
 *   404 { error: "NO_FEE" }     the form is still open and has no fee yet (it is
 *                                priced when the parent submits)
 *   404                          unknown token, or a submitted application with no fee
 *   409 { error: "APPLICATION_CLOSED" } staff rejected the application or cancelled
 *                                the lead; no new link
 *   410 { error: "EXPIRED" }     the (never submitted) invite lapsed
 *   429                          rate limited
 *   502 { error, message }       the gateway could not issue a link (retry later)
 *
 * The amount is the one snapshotted on the fee row (plus any staff discount);
 * nothing in the request body is read.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ip = rateLimit(`enroll-pay:${getClientIp(req)}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!ip.success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { token } = await params;
  // Garbage never becomes a limiter key: the in-memory store keeps one entry per
  // distinct string, so an arbitrary path segment must be refused first.
  if (!isTokenShape(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { access, id, tenantId } = await resolveEnrollmentAccess(token, new Date());
  if (access === "NOT_FOUND" || !id || !tenantId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Per token as well: one link must not be able to hammer the gateway from many
  // addresses. Only after the row is found, so a made-up (well-shaped) token can
  // never create a limiter entry of its own.
  const perToken = rateLimit(`enroll-pay-token:${token}`, TOKEN_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!perToken.success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  if (access === "EXPIRED") return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
  // INVITED ("OK") and SUBMITTED both go on to the fee lookup; an OPEN form
  // without a fee answers NO_FEE below.
  const link = await getOrCreateFeePaymentLink({
    applicationId: id,
    tenantId,
    token,
    requestOrigin: new URL(req.url).origin,
  });

  switch (link.kind) {
    case "LINK":
      return NextResponse.json({ paymentUrl: link.paymentUrl });
    case "SETTLED":
      return NextResponse.json({ status: link.status });
    case "CLOSED":
      // Staff rejected the application or cancelled the lead: no new payment link.
      return NextResponse.json({ error: "APPLICATION_CLOSED" }, { status: 409 });
    case "FAILED":
      return NextResponse.json({ error: "LINK_FAILED", message: FEE_LINK_FAILED_MESSAGE }, { status: 502 });
    case "NO_FEE":
    default:
      // An open form with no fee has nothing to pay yet (it is filled first, and
      // priced at submit); a submitted one with no fee is a free program.
      return NextResponse.json(access === "OK" ? { error: "NO_FEE" } : { error: "Not found" }, { status: 404 });
  }
}
