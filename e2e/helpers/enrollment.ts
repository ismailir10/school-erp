import { expect, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";

/**
 * Shared setup for the enrollment-form specs (signature handover, documents).
 *
 * Everything goes through the real HTTP API with the demo admin cookie, the
 * same way `enrollment-application.spec.ts` does. Public (tokenized) calls carry
 * a unique X-Forwarded-For so their per-IP rate-limit buckets never contend with
 * another spec or with a retry of the same spec.
 */

export const ADMIN_USER_ID = "u_super_admin";
export const CONSENT_VERSION = "annisaa-2026-v2";

/** Hard-coded valid 1x1 PNG (the server only checks the magic bytes). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Minimal PDF: starts with %PDF-, ends with %%EOF, well over the 8-byte floor. */
export function tinyPdf(label = "e2e"): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n% ${label}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    "utf8",
  );
}

/** A fresh browser context carrying the demo super-admin session cookie. */
export async function newAdminContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: "school-erp-session", value: ADMIN_USER_ID, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  return ctx;
}

/**
 * Per-run IP allocator: `10.<block>.<run>.<n>`. `run` is random per call, so a
 * Playwright retry (config: retries 1) gets fresh rate-limit buckets.
 */
export function newIpBlock(block: number): () => string {
  const run = Math.floor(Math.random() * 200) + 20;
  let n = 0;
  return () => `10.${block}.${run}.${++n}`;
}

export type Invite = { admissionId: string; token: string };

/** Public admission inquiry → admin invite → opaque form token. */
export async function createInvite(
  admin: APIRequestContext,
  opts: { ip: string; child: string; email: string },
): Promise<Invite> {
  const adm = await admin.post("/api/admission/submit", {
    headers: { "X-Forwarded-For": opts.ip },
    data: {
      childName: opts.child,
      dateOfBirth: "2021-03-15",
      childGender: "P",
      parentName: "E2E Ibu",
      parentPhone: "081200000001",
      parentEmail: opts.email,
    },
  });
  expect(adm.ok()).toBeTruthy();
  const admissionId = (await adm.json()).id as string;

  const inv = await admin.post("/api/enrollments/invite", { data: { admissionId } });
  expect(inv.ok()).toBeTruthy();
  const formUrl = (await inv.json()).formUrl as string;
  const token = formUrl.split("/pendaftaran/")[1];
  expect(token.length).toBeGreaterThan(20);
  return { admissionId, token };
}

export async function firstProgramId(admin: APIRequestContext): Promise<string> {
  const res = await admin.get("/api/programs");
  const json = await res.json();
  const programs = Array.isArray(json) ? json : (json.data ?? []);
  expect(programs.length).toBeGreaterThan(0);
  return programs[0].id as string;
}

/**
 * Pre-fill the draft through the public PATCH so every wizard step validates
 * and the parent only has to sign. Names are on `consentData` so the
 * "Nama jelas" fields are filled on every device that opens the link.
 */
export async function prefillDraft(
  request: APIRequestContext,
  opts: { token: string; ip: string; child: string; programId: string },
): Promise<void> {
  const res = await request.patch(`/api/enrollments/token/${opts.token}`, {
    headers: { "X-Forwarded-For": opts.ip },
    data: {
      programId: opts.programId,
      studentData: {
        childName: opts.child,
        childGender: "P",
        birthPlace: "Bekasi",
        dateOfBirth: "2021-03-15",
        agama: "ISLAM",
        kewarganegaraan: "WNI",
      },
      ayahData: { name: "E2E Ayah" },
      ibuData: { name: "E2E Ibu" },
      consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "E2E Ayah" }, ibu: { name: "E2E Ibu" } },
    },
  });
  expect(res.status()).toBe(200);
}

/** POST a signature PNG for one parent through the public API. */
export async function postSignature(
  request: APIRequestContext,
  opts: { token: string; ip: string; which: "ayah" | "ibu" },
) {
  return request.post(`/api/enrollments/token/${opts.token}/signature?which=${opts.which}`, {
    headers: { "X-Forwarded-For": opts.ip },
    multipart: { file: { name: "sig.png", mimeType: "image/png", buffer: PNG_1X1 } },
  });
}
