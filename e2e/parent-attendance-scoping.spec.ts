import { test, expect } from "@playwright/test";

/**
 * Regression guard for UAT BLOCKER U10 (parent attendance scoping wrong query).
 *
 * Diagnosis on rolled-back staging recorded in
 * docs/cycles/archive/2026-05-10-phase0-finance-backlog-drain.md §"Task 1 — Reproduction"
 * found U10 does NOT reproduce post-rollback — the page query is correct
 * given the seed shape. This spec is a long-lived guard against the most
 * plausible scoping fault modes:
 *
 * 1. A fabricated `?child=<not-mine>` param must NOT cause the page to
 *    fetch attendance for that id. `resolveSelectedChild` (lib/parent-helpers.ts)
 *    falls back to `children[0]` when the param does not match any of the
 *    authenticated parent's guardian links — closing the obvious enumeration
 *    leak shape.
 *
 * 2. The `getParentWithChildren` invariant tightening (cycle 0.2 Task 4)
 *    must not break the legitimate GUARDIAN happy path. The page still
 *    renders the Kehadiran header for a real guardian session.
 */

let parentUserId: string;

test.describe("Parent attendance scoping", () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/auth/users");
    const users = await res.json();
    const parent = users.find((u: { role: string }) => u.role === "GUARDIAN");
    if (!parent) throw new Error("No GUARDIAN user found in demo DB");
    parentUserId = parent.id;
  });

  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([
      {
        name: "school-erp-session",
        value: parentUserId,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("happy path — /parent/attendance renders for a real guardian", async ({ page }) => {
    await page.goto("/parent/attendance");
    await page.waitForURL("**/parent/attendance");
    // Kehadiran header proves the route resolved a real parent + child set.
    await expect(
      page.getByRole("heading", { level: 1, name: "Kehadiran" }),
    ).toBeVisible({ timeout: 10_000 });
    // The page must NOT redirect to root (the empty-result short-circuit
    // path in getParentWithChildren would land any failed-invariant session
    // back on /parent, which itself redirects to /).
    expect(page.url()).toContain("/parent/attendance");
    await expect(page.getByRole("button", { name: "Pekan berikutnya — pekan berikutnya belum tersedia" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Kembali ke pekan ini" })).toHaveCount(0);
    await page.getByRole("link", { name: "Pekan sebelumnya" }).click();
    await expect(page.getByRole("link", { name: "Kembali ke pekan ini" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pekan berikutnya", exact: true })).toBeVisible();
  });

  test("fabricated ?child= param falls back to the parent's own child (no leak)", async ({ page }) => {
    // The fabricated id below is intentionally shaped like a CUID but is
    // not present in any seeded StudentGuardian row. resolveSelectedChild
    // must reject it and fall back to children[0]. The route must still
    // render successfully — no 500, no redirect to /, no error overlay.
    const fabricated = "cmFAKE0000fabricated0000probe";
    await page.goto(`/parent/attendance?child=${fabricated}&week=2000-01-03`);
    await page.waitForURL("**/parent/attendance**");

    await expect(
      page.getByRole("heading", { level: 1, name: "Kehadiran" }),
    ).toBeVisible({ timeout: 10_000 });

    // Pagination Prev/Next week links use `selected.studentId` (the
    // resolved/fallback child), NOT the raw URL param — assert that the
    // generated week-nav hrefs reference a CUID that is NOT the fabricated
    // probe. This is the assertion that catches the leak shape (page
    // building hrefs from unverified URL input). The probe itself may
    // appear in the Next.js RSC payload at the document tail (server
    // echoes the URL searchParams for client transitions); that echo is
    // framework-level, not a data-access leak.
    //
    // A historical week makes both directions available (current week stops
    // forward navigation). Hard-assert nav links exist BEFORE reading hrefs: a future structural
    // change that removes them must fail this test loudly, not no-op via a
    // silent null skip.
    const prevHref = await page.locator('a[aria-label="Pekan sebelumnya"]').getAttribute("href");
    const nextHref = await page.locator('a[aria-label="Pekan berikutnya"]').getAttribute("href");
    expect(prevHref, "Prev week nav link must be rendered").not.toBeNull();
    expect(nextHref, "Next week nav link must be rendered").not.toBeNull();
    expect(prevHref).not.toContain(fabricated);
    expect(nextHref).not.toContain(fabricated);
  });

  test("cross-tenant-shaped ?child= param does not 500 or leak", async ({ page }) => {
    // Simulates an external attacker probing for cross-tenant fan-out:
    // a syntactically-valid CUID matching no row in this tenant. The
    // page must reject it the same way as a fabricated id — fall back
    // to children[0], render normally, never expose the probed id in
    // server-built hrefs.
    const probe = "cmABCD1234crosstenantprobe9999";
    await page.goto(`/parent/attendance?child=${probe}&week=2000-01-03`);
    await page.waitForURL("**/parent/attendance**");

    await expect(
      page.getByRole("heading", { level: 1, name: "Kehadiran" }),
    ).toBeVisible({ timeout: 10_000 });
    // Must not surface a Next.js error boundary or Server Component throw.
    await expect(page.locator("text=/Something went wrong|Internal Server Error/i")).not.toBeVisible();

    const prevHref = await page.locator('a[aria-label="Pekan sebelumnya"]').getAttribute("href");
    const nextHref = await page.locator('a[aria-label="Pekan berikutnya"]').getAttribute("href");
    expect(prevHref, "Prev week nav link must be rendered").not.toBeNull();
    expect(nextHref, "Next week nav link must be rendered").not.toBeNull();
    expect(prevHref).not.toContain(probe);
    expect(nextHref).not.toContain(probe);
  });
});
