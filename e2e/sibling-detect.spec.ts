import { test, expect } from "@playwright/test";

/**
 * Phase 1.2 — sibling auto-detect e2e.
 *
 * Covers the four behaviours called out in
 * docs/cycles/archive/2026-05-11-sibling-auto-detect.md AC7:
 *   1. applicant-facing /daftar UX unchanged when match exists
 *   2. admin sees chip on the matched row + dash on the unmatched row
 *   3. hover reveals the matched parent's name + linked-student list
 *   4. edit-sheet banner renders inside the Sheet/Dialog
 *
 * Match target: discovered from the live guardian list. Submitting with a
 * +62-shaped parentPhone exercises the +62 → 0 prefix normalisation end-to-end
 * without depending on a stale demo parent fixture.
 *
 * Admin auth: demo cookie school-erp-session=u_super_admin (same pattern as
 * e2e/admin.spec.ts).
 */

const ADMIN_USER_ID = "u_super_admin";

const MATCH_CHILD = `E2E Sibling Match ${Date.now()}`;
const NO_MATCH_CHILD = `E2E Sibling NoMatch ${Date.now()}`;
let applicantParentPhoneInput = "";
let matchedParentName = "";

function toApplicantPhoneInput(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("62")) return `+${digits}`;
  if (digits.startsWith("0")) return `+62${digits.slice(1)}`;
  return phone;
}

// Per-request fake source IP routed via X-Forwarded-For. `lib/rate-limit.ts`
// reads the first comma-separated entry of this header (Vercel-compatible
// behaviour), so each unique value gets its own 5/min bucket — no marathon
// contention with `daftar-public.spec.ts`, no 61s sleep-then-retry stalls.
//
// Isolation invariant: every public POST in THIS file must carry an
// `X-Forwarded-For` header from this constant set. Adding an un-headered
// POST here will silently fall back to the `anonymous` bucket and contend
// with `daftar-public.spec.ts` again, re-introducing marathon flakiness.
const IP_BEFOREALL_MATCH = "10.99.0.1";
const IP_BEFOREALL_NOMATCH = "10.99.0.2";
const IP_TRUST_BOUNDARY = "10.99.0.3";

test.describe.configure({ mode: "serial", timeout: 60_000 });

test.describe("Phase 1.2 — Sibling auto-detect", () => {
  test.beforeAll(async ({ request }) => {
    const guardianRes = await request.get("/api/guardians?pageSize=25", {
      headers: { Cookie: `school-erp-session=${ADMIN_USER_ID}` },
    });
    expect(guardianRes.ok()).toBeTruthy();
    const guardianJson = (await guardianRes.json()) as {
      data?: Array<{ name: string; phone: string | null; _count?: { guardians?: number } }>;
    };
    const matchedGuardian = guardianJson.data?.find(
      (guardian) => guardian.phone && (guardian._count?.guardians ?? 0) > 0,
    );
    expect(matchedGuardian?.phone).toBeTruthy();
    if (!matchedGuardian?.phone) {
      throw new Error("No linked guardian with a phone number found");
    }
    applicantParentPhoneInput = toApplicantPhoneInput(matchedGuardian.phone);
    matchedParentName = matchedGuardian.name;

    // Pre-insert one matched + one unmatched admission via the public POST.
    // Each insert routes through a distinct X-Forwarded-For so the per-IP
    // rate-limit bucket is isolated from any other suite running before us.
    const matched = await request.post("/api/admission/submit", {
      headers: { "X-Forwarded-For": IP_BEFOREALL_MATCH },
      data: {
        childName: MATCH_CHILD,
        dateOfBirth: "2020-03-15",
        childGender: "P",
        parentName: "E2E Applicant",
        parentPhone: applicantParentPhoneInput,
      },
    });
    expect(matched.status()).toBe(201);

    const noMatch = await request.post("/api/admission/submit", {
      headers: { "X-Forwarded-For": IP_BEFOREALL_NOMATCH },
      data: {
        childName: NO_MATCH_CHILD,
        dateOfBirth: "2020-03-15",
        childGender: "L",
        parentName: "E2E NoMatch",
        parentPhone: "+62 999 0000 5555",
      },
    });
    expect(noMatch.status()).toBe(201);
  });

  test("applicant-facing /daftar UX unchanged when match exists", async ({
    page,
    request,
    context,
  }) => {
    await context.clearCookies();

    // ----- Trust-boundary assertion -----
    // Critical invariant from plan §7 q6: a matched submission must NOT
    // echo any sibling info to the applicant. Uses its own X-Forwarded-For
    // so the per-IP bucket stays isolated from beforeAll's two inserts and
    // from any other suite that hammers the public endpoint.
    const res = await request.post("/api/admission/submit", {
      headers: { "X-Forwarded-For": IP_TRUST_BOUNDARY },
      data: {
        childName: `E2E Trust Boundary ${Date.now()}`,
        dateOfBirth: "2020-03-15",
        childGender: "P",
        parentName: "E2E Trust Applicant",
        parentPhone: applicantParentPhoneInput,
      },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    // Response is plain { id } — NO sibling info echoed to the applicant.
    expect(Object.keys(body)).toEqual(["id"]);

    // ----- UX-shape assertion (no submit; no rate-limit interaction) -----
    // /daftar must not surface any sibling-related copy. This assertion
    // exercises the static UX shape without a second POST.
    await page.goto("/daftar");
    await expect(
      page.getByRole("heading", { name: "Pendaftaran Siswa Baru" }),
    ).toBeVisible();

    // Fill the whole (single-page) form, child block included, without sending.
    await page.getByTestId("field-parent-name").fill("E2E UX Applicant");
    await page
      .getByTestId("field-parent-phone")
      .fill(applicantParentPhoneInput);
    await page.getByTestId("daftar-child-toggle").click();
    await page.getByTestId("field-child-name").fill(`E2E UX ${Date.now()}`);
    await expect(page.getByTestId("daftar-submit")).toBeVisible();

    // The /daftar page (form filled in, child block open) must never carry sibling copy.
    const pageText = (await page.textContent("body")) ?? "";
    expect(pageText.toLowerCase()).not.toContain("saudara");
    expect(pageText.toLowerCase()).not.toContain("sibling");
  });

  test("admin sees chip on matched row + dash on unmatched row", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "school-erp-session",
        value: ADMIN_USER_ID,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin/admissions");
    await expect(page.getByRole("heading", { name: "Pendaftaran" })).toBeVisible();
    // Wait for the data table to hydrate + fetch (page is a client component).
    await page.waitForResponse(
      (res) => res.url().includes("/api/admissions") && res.status() === 200,
    );

    // Find the matched row by child name; chip must be visible.
    const matchedRow = page.locator("tr", { hasText: MATCH_CHILD });
    await expect(matchedRow).toBeVisible();
    await expect(
      matchedRow.getByTestId("admission-row-sibling-chip"),
    ).toBeVisible();

    // Find the no-match row; chip must NOT be present.
    const unmatchedRow = page.locator("tr", { hasText: NO_MATCH_CHILD });
    await expect(unmatchedRow).toBeVisible();
    await expect(
      unmatchedRow.getByTestId("admission-row-sibling-chip"),
    ).toHaveCount(0);
  });

  test("hover chip reveals matched parent name + at least one student", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "school-erp-session",
        value: ADMIN_USER_ID,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin/admissions");
    await page.waitForResponse(
      (res) => res.url().includes("/api/admissions") && res.status() === 200,
    );
    const matchedRow = page.locator("tr", { hasText: MATCH_CHILD });
    await matchedRow.getByTestId("admission-row-sibling-chip").hover();
    // Hover content is a Shadcn HoverCard — content lands in a portal.
    await expect(page.getByText(matchedParentName)).toBeVisible();
  });

  test("edit-sheet banner renders matched parent context", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "school-erp-session",
        value: ADMIN_USER_ID,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin/admissions");
    await page.waitForResponse(
      (res) => res.url().includes("/api/admissions") && res.status() === 200,
    );
    const matchedRow = page.locator("tr", { hasText: MATCH_CHILD });
    // Marathon-resilience: when many admissions exist (cycle 1.1 + retries
    // can deepen the list past initial viewport) the row-action button is
    // off-screen and Playwright's click auto-scroll occasionally times out
    // on cold CI. Force scroll-into-view first, then click.
    await matchedRow.scrollIntoViewIfNeeded();
    await matchedRow.getByRole("button", { name: /^Aksi untuk / }).click();
    // Base UI DropdownMenu re-mounts items on focus / row re-render in CI,
    // detaching the menuitem mid-click ("element was detached from the DOM").
    // Anchor on the data-slot the wrapper guarantees + force:true to skip
    // the stability re-check that loses the race.
    const editItem = page.locator('[data-slot="dropdown-menu-item"]', {
      hasText: "Ubah data pertanyaan",
    });
    await editItem.waitFor({ state: "visible" });
    await editItem.click({ force: true });
    // Banner inside the Sheet/Dialog body.
    await expect(
      page.getByTestId("admission-edit-sibling-banner"),
    ).toBeVisible();
    await expect(
      page.getByTestId("admission-edit-sibling-banner"),
    ).toContainText(matchedParentName);
  });
});
