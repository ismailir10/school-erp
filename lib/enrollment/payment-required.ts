/**
 * Pay-first gate, response side. While the pendaftaran fee is UNPAID the parent
 * may read nothing and write nothing on the form: every public token route that
 * touches the draft answers with this one 409. No Prisma here, so a route test
 * can mock the database without touching it. Staff routes never use this.
 */
import { NextResponse } from "next/server";

export const PAYMENT_REQUIRED_MESSAGE = "Bayar biaya formulir dulu supaya formulir bisa diisi.";

export function paymentRequiredResponse(): NextResponse {
  return NextResponse.json({ error: "PAYMENT_REQUIRED", message: PAYMENT_REQUIRED_MESSAGE }, { status: 409 });
}
