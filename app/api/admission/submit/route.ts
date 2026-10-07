// @public — intentionally unauthenticated public admission entry; rate-limited (5/min/IP).
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { submitAdmissionSchema, flattenSubmitErrors } from "@/lib/admission/submit-validation";
import { detectSibling } from "@/lib/admission/sibling-detect";
import { sendAdmissionSubmittedEmail } from "@/lib/email/admission-submitted";
import { programBelongsToTenant } from "@/lib/enrollment/resolve-token";
import { resolveAppOrigin } from "@/lib/payments/session";

const RATE_LIMIT_PER_MIN = 5;
const RATE_WINDOW_MS = 60_000;
// An identical submission inside this window is a double-tap / retry, not a
// second child — answered with the existing row (PUBX-2).
const DUPLICATE_WINDOW_MS = 10 * 60_000;

const digitsOnly = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * Public admission submit. NO auth, NO session check — see proxy.ts public
 * allow-list. Trust boundary is THIS handler: Zod validation, server-side
 * source/status/tenant resolution, IP rate-limit, no PII echoed back.
 */
export async function POST(req: NextRequest) {
  // Rate-limit FIRST — cheap, defends against parse cost.
  // Per-IP 5/min via lib/rate-limit.ts in-memory bucket. See cycle doc
  // Spec Assumption 2 for the known-soft IP-extraction limitation.
  const ip = getClientIp(req);
  const limit = rateLimit(`admission-submit:${ip}`, RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);
  if (!limit.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(RATE_WINDOW_MS / 1000)) } },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "validation_failed", fields: { _root: "Body bukan JSON yang valid" } },
      { status: 400 },
    );
  }

  const parsed = submitAdmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", fields: flattenSubmitErrors(parsed.error) },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Resolve tenant server-side. Single-tenant invariant in v1 production.
  // Oldest ACTIVE tenant wins (deterministic, not arbitrary).
  let tenantId: string;
  try {
    const tenant = await prisma.tenant.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!tenant) {
      console.error("[admission-submit] No ACTIVE tenant found — cannot create Admission row");
      return NextResponse.json({ error: "submit_failed" }, { status: 500 });
    }
    tenantId = tenant.id;
  } catch (err) {
    console.error("[admission-submit] Tenant lookup failed", err);
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }

  // Guard against a cross-tenant program reference (IDOR write) — mirrors the
  // check every enrollment write path already runs. This is an optional field
  // on a one-shot public submit (not an autosave draft), so an invalid/foreign
  // programId is dropped to null rather than rejecting the whole submission.
  let programId: string | null = data.programId ?? null;
  if (programId && !(await programBelongsToTenant(programId, tenantId))) {
    programId = null;
  }

  // Idempotency: same parent phone (digits only) + child name (trimmed,
  // case-insensitive) + date of birth inside the last 10 minutes returns the
  // existing inquiry. Phone formats vary ("0812-34…" vs "081234…"), so the
  // phone is compared in JS after the indexed-ish DB narrowing. A failed
  // lookup must never block a genuine submission — fall through to create.
  try {
    const recent = await prisma.admission.findMany({
      where: {
        tenantId,
        source: "WEBSITE",
        dateOfBirth: data.dateOfBirth,
        childName: { equals: data.childName, mode: "insensitive" },
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, parentPhone: true },
    });
    const phone = digitsOnly(data.parentPhone);
    const existing = recent.find((row: { parentPhone: string | null }) => digitsOnly(row.parentPhone) === phone);
    if (existing) {
      return NextResponse.json({ id: existing.id }, { status: 201 });
    }
  } catch (err) {
    console.error("[admission-submit] Duplicate lookup failed", err);
  }

  let admissionId: string;
  try {
    const admission = await prisma.admission.create({
      data: {
        tenantId,
        childName: data.childName,
        dateOfBirth: data.dateOfBirth,
        childGender: data.childGender,
        parentName: data.parentName,
        parentPhone: data.parentPhone,
        parentWhatsapp: data.parentWhatsapp ?? null,
        parentEmail: data.parentEmail ?? null,
        programId,
        notes: data.notes ?? null,
        // status defaults to "INQUIRY" via prisma schema; never set explicitly here.
        // source hard-coded server-side — never read from request.
        source: "WEBSITE",
      },
      select: { id: true },
    });
    admissionId = admission.id;
  } catch (err) {
    console.error("[admission-submit] Insert failed", err);
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }

  // Sibling auto-detect (cycle 1.2). Runs AFTER admission.create succeeds.
  // Failure swallowed — admission stays created, applicant sees 201 unchanged,
  // admin sees the row without a "Saudara terdeteksi" chip. Per plan §7 q6
  // the surface is admin-only — no match info echoed back to the applicant.
  try {
    const match = await detectSibling(
      {
        tenantId,
        parentEmail: data.parentEmail,
        parentPhone: data.parentPhone,
      },
      prisma,
    );
    if (match) {
      await prisma.admission.update({
        where: { id: admissionId },
        data: { detectedParentId: match.parentId },
      });
    }
  } catch (err) {
    console.error(
      `[admission-submit] sibling-detect failed for admission ${admissionId}:`,
      err,
    );
  }

  // Best-effort confirmation email. Failure is swallowed (per plan §7 q4):
  // the user submitted successfully — they should see the confirmation page
  // even if Resend has a hiccup. Logged loudly for ops visibility.
  if (data.parentEmail) {
    try {
      // requestOrigin (new URL(req.url).origin) is always present in a route
      // handler, so preview/staging/prod each get their own logo host —
      // same pattern as payment return URLs (lib/payments/session.ts).
      const appUrl = resolveAppOrigin(new URL(req.url).origin);
      const result = await sendAdmissionSubmittedEmail({
        tenantId,
        to: data.parentEmail,
        childName: data.childName,
        parentName: data.parentName,
        appUrl,
      });
      if (!result.sent && result.error) {
        console.error(
          `[admission-submit] Confirmation email failed for admission ${admissionId}: ${result.error}`,
        );
      }
    } catch (err) {
      console.error(
        `[admission-submit] Confirmation email threw for admission ${admissionId}`,
        err,
      );
    }
  }

  return NextResponse.json({ id: admissionId }, { status: 201 });
}
