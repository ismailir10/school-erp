import { expect, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";

/**
 * Shared setup for the enrollment-form specs (signature handover, documents, fee, pipeline).
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

export type Invite = {
  admissionId: string;
  token: string;
  /** The EnrollmentApplication id (what the staff fee and detail routes are addressed by). */
  applicationId: string;
};

/**
 * Staff settle a fee in one call (cash), the way the formulir detail's "Tandai lunas" button does.
 * Pay-after: the fee only exists once the parent has submitted the form (or staff marked it in).
 */
export async function markFeePaid(admin: APIRequestContext, applicationId: string): Promise<void> {
  const res = await admin.patch(`/api/enrollments/${applicationId}/fee`, {
    data: { action: "MARK_PAID", method: "CASH", note: "e2e" },
  });
  expect(res.status()).toBe(200);
}

/**
 * Public admission inquiry → admin invite → opaque form token.
 *
 * Pay-after (cycle 2026-10-15-pendaftaran-pay-after-form): "Kirim Formulir" is one tap. The
 * invite takes only the lead, picks no program and creates NO fee; the parent chooses Program
 * (+ Day Care) in the form, and the fee is priced when the form is submitted. So the form is
 * open the moment this returns, and nothing needs settling before the parent can write.
 */
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

  // The invite route is rate limited per client IP (10/min). Every spec invites from the same
  // loopback address, so a per-call forwarded IP keeps their buckets apart (and a retry's fresh).
  const inv = await admin.post("/api/enrollments/invite", {
    headers: { "X-Forwarded-For": opts.ip },
    data: { admissionId },
  });
  expect(inv.ok()).toBeTruthy();
  const body = (await inv.json()) as { id: string; formUrl: string };
  const token = body.formUrl.split("/pendaftaran/")[1];
  expect(token.length).toBeGreaterThan(20);
  return { admissionId, token, applicationId: body.id };
}

export type ProgramFee = { id: string; name: string; enrollmentFee: number };

/**
 * The pendaftaran fee is a per-school setting shared by every spec. Prices the first program at
 * `fee` and the second at 0 (free), and returns both plus a `restore()` for `afterAll`.
 */
export async function priceTwoPrograms(
  admin: APIRequestContext,
  fee: number,
): Promise<{ priced: ProgramFee; free: ProgramFee; requiredDocuments: string[]; restore: () => Promise<void> }> {
  const res = await admin.get("/api/config/enrollment");
  expect(res.status()).toBe(200);
  const cfg = await res.json();
  const requiredDocuments = cfg.requiredDocuments as string[];
  expect(cfg.programs.length).toBeGreaterThan(1);
  const priced = { ...(cfg.programs[0] as ProgramFee) };
  const free = { ...(cfg.programs[1] as ProgramFee) };
  const put = await admin.put("/api/config/enrollment", {
    data: {
      requiredDocuments,
      programFees: [
        { programId: priced.id, fee },
        { programId: free.id, fee: 0 },
      ],
    },
  });
  expect(put.status()).toBe(200);
  return {
    priced,
    free,
    requiredDocuments,
    restore: async () => {
      await admin.put("/api/config/enrollment", {
        data: {
          requiredDocuments,
          programFees: [priced, free].map((p) => ({ programId: p.id, fee: p.enrollmentFee })),
        },
      });
    },
  };
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
 * Program (+ Day Care) is the parent's choice in the form, so it rides on the draft.
 */
export async function prefillDraft(
  request: APIRequestContext,
  opts: { token: string; ip: string; child: string; programId: string; dcareAddon?: boolean; address?: Record<string, string> },
): Promise<void> {
  const res = await request.patch(`/api/enrollments/token/${opts.token}`, {
    headers: { "X-Forwarded-For": opts.ip },
    data: {
      programId: opts.programId,
      ...(opts.dcareAddon !== undefined ? { dcareAddon: opts.dcareAddon } : {}),
      studentData: {
        childName: opts.child,
        childGender: "P",
        birthPlace: "Bekasi",
        dateOfBirth: "2021-03-15",
        agama: "ISLAM",
        kewarganegaraan: "WNI",
        ...(opts.address ? { address: opts.address } : {}),
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

/** The body the real form sends on submit (the server prices from `programId` / `dcareAddon`; it never takes an amount). */
export function submitBody(opts: {
  programId: string;
  child: string;
  dcareAddon?: boolean;
  address?: Record<string, string>;
}) {
  return {
    programId: opts.programId,
    dcareAddon: opts.dcareAddon ?? false,
    studentData: {
      childName: opts.child,
      childGender: "P",
      birthPlace: "Bekasi",
      dateOfBirth: "2021-03-15",
      agama: "ISLAM",
      kewarganegaraan: "WNI",
      ...(opts.address ? { address: opts.address } : {}),
    },
    ayahData: { name: "E2E Ayah" },
    ibuData: { name: "E2E Ibu" },
    consentData: { agreed: true, version: CONSENT_VERSION, ayah: { name: "E2E Ayah" }, ibu: { name: "E2E Ibu" } },
  };
}

/**
 * Fill a formulir through the public token API and submit it: draft (Program included), both
 * signatures, submit. Returns the submit response (201 expected) so callers can read `fee`.
 */
export async function fillAndSubmit(
  request: APIRequestContext,
  opts: { token: string; ip: string; child: string; programId: string; dcareAddon?: boolean; address?: Record<string, string> },
) {
  await prefillDraft(request, opts);
  for (const which of ["ayah", "ibu"] as const) {
    expect((await postSignature(request, { token: opts.token, ip: opts.ip, which })).status()).toBe(200);
  }
  return request.post(`/api/enrollments/token/${opts.token}/submit`, {
    headers: { "X-Forwarded-For": opts.ip },
    data: submitBody(opts),
  });
}
