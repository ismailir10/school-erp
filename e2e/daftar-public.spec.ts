import { test, expect } from "@playwright/test";

/**
 * Public admission entry e2e — /daftar is one short page.
 *
 * Cycle 2026-10-11-pendaftaran-simplify (Decision 3): the family leaves a parent
 * name and one contact (HP/WhatsApp or email); child data is an optional,
 * collapsed block. Covers:
 *   1. happy path — parent name + phone only → 201 + confirmation
 *   2. validation — no contact → inline error and NO request; then email + the
 *      optional child block → 201
 *   3. rate limit — direct POSTs return 429 with Retry-After after the per-IP cap
 *
 * NO auth setup — /daftar + /api/admission/submit are public per proxy.ts
 * allow-list. Cookies are cleared before each test.
 */

const SUBMIT_URL = "/api/admission/submit";
const isSubmit = (url: string) => new URL(url).pathname === SUBMIT_URL;

test.describe("Public admission entry — /daftar", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("happy path — parent name + phone only, 201 confirmation", async ({ page }) => {
    const submitResponse = page.waitForResponse(
      (res) => isSubmit(res.url()) && res.request().method() === "POST",
    );

    await page.goto("/daftar");
    await expect(page.getByRole("heading", { name: "Pendaftaran Siswa Baru" })).toBeVisible();
    // One page: no stepper, child block collapsed.
    await expect(page.getByTestId("daftar-next")).toHaveCount(0);
    await expect(page.getByTestId("daftar-child-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("field-child-name")).toHaveCount(0);

    await page.getByTestId("field-parent-name").fill("Ibu Fatimah E2E");
    await page.getByTestId("field-parent-phone").fill("0812-3456-7890");
    await page.getByTestId("daftar-submit").click();

    const res = await submitResponse;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toMatch(/^c[a-z0-9]{20,}$/i);
    // Nothing but what the family typed goes over the wire.
    expect(res.request().postDataJSON()).toEqual({
      parentName: "Ibu Fatimah E2E",
      parentPhone: "0812-3456-7890",
    });

    await expect(page.getByTestId("daftar-confirmation")).toBeVisible();
    await expect(page.getByTestId("confirmation-parent-name")).toHaveText("Ibu Fatimah E2E");
  });

  test("validation — no contact shows an inline error and sends nothing", async ({ page }) => {
    const submits: string[] = [];
    page.on("request", (req) => {
      if (isSubmit(req.url()) && req.method() === "POST") submits.push(req.url());
    });

    await page.goto("/daftar");
    await page.getByTestId("field-parent-name").fill("Bapak Umar E2E");
    await page.getByTestId("daftar-submit").click();

    await expect(page.getByTestId("error-contact")).toHaveText(
      "Isi minimal satu: No. HP/WhatsApp atau email.",
    );
    await expect(page.getByTestId("daftar-confirmation")).toHaveCount(0);
    expect(submits).toHaveLength(0);

    // An email is enough; the optional child block rides along when opened.
    await page.getByTestId("field-parent-email").fill("umar.e2e@example.com");
    await expect(page.getByTestId("error-contact")).toHaveCount(0);
    await page.getByTestId("daftar-child-toggle").click();
    await page.getByTestId("field-child-name").fill("Aisyah Putri E2E");

    const submitResponse = page.waitForResponse(
      (res) => isSubmit(res.url()) && res.request().method() === "POST",
    );
    await page.getByTestId("daftar-submit").click();
    const res = await submitResponse;
    expect(res.status()).toBe(201);
    expect(res.request().postDataJSON()).toMatchObject({
      parentName: "Bapak Umar E2E",
      parentEmail: "umar.e2e@example.com",
      childName: "Aisyah Putri E2E",
    });
    await expect(page.getByTestId("daftar-confirmation")).toBeVisible();
  });

  test("rate limit — direct POST returns 429 with Retry-After header after the per-IP cap", async ({ request }) => {
    // Own source IP (X-Forwarded-For) so the bucket is independent of every
    // other test and a Playwright retry (random block) starts fresh.
    const ip = `10.98.${Math.floor(Math.random() * 200) + 20}.1`;
    const VALID_BODY = {
      parentName: "Rate Test Parent",
      parentPhone: "081234567890",
    };

    // The bucket cap is 5/min/IP (RATE_LIMIT_PER_MIN in
    // app/api/admission/submit/route.ts). Hold every response so the first 429
    // can be re-inspected for header + body shape.
    const responses: Awaited<ReturnType<typeof request.post>>[] = [];
    for (let i = 0; i < 7; i++) {
      responses.push(
        await request.post(SUBMIT_URL, { headers: { "X-Forwarded-For": ip }, data: VALID_BODY }),
      );
    }

    expect(responses.slice(0, 5).map((r) => r.status())).toEqual([201, 201, 201, 201, 201]);
    const throttled = responses.find((r) => r.status() === 429);
    expect(throttled, "a POST beyond the 5/min cap must be throttled").toBeDefined();
    // Retry-After is set by the route as String(Math.ceil(RATE_WINDOW_MS / 1000)).
    // Assert the shape (positive integer string), not the literal "60", so the
    // window constant can change without breaking the test.
    expect(throttled!.headers()["retry-after"]).toMatch(/^\d+$/);
    const body = (await throttled!.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });
});
