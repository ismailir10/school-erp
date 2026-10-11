/**
 * The public token routes' shared refusal ladder. Each of them classifies the
 * token with `resolveEnrollmentAccess`, then turns every state that may not write
 * into the same response; `null` means "go on" (the caller still checks it got an
 * `id`/`tenantId`). The `/pay` route answers differently (it serves submitted and
 * pay-first applications alike) and does not use this. No Prisma here.
 */
import { NextResponse } from "next/server";
import type { EnrollmentAccess } from "./resolve-token";
import { paymentRequiredResponse } from "./payment-required";

export function denyTokenAccess(access: EnrollmentAccess): NextResponse | null {
  switch (access) {
    case "NOT_FOUND":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "EXPIRED":
      return NextResponse.json({ error: "EXPIRED" }, { status: 410 });
    case "SUBMITTED":
      return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
    // Pay-first: nothing is read or written until the fee is settled.
    case "PAYMENT_REQUIRED":
      return paymentRequiredResponse();
    case "OK":
      return null;
    default: {
      // A new access state must be handled here before it can compile.
      const unhandled: never = access;
      throw new Error(`Unhandled enrollment access: ${String(unhandled)}`);
    }
  }
}
