import { test, expect, type Page } from "@playwright/test";

/**
 * Phone stress guard (cycle 2026-10-29-admin-mobile-stress, Decision 5).
 *
 * Seed data has short numbers ("12", "Rp 1,2 jt"); production has "Rp 1.234.567.890"
 * and four-digit counts. A layout that only fits the seed breaks on real data. So
 * on a 360x780 touch phone we visit a lean list of pages per role, INFLATE every
 * amount and small number in the DOM to production-sized values, and then measure
 * the real layout for three defects:
 *
 *   (a) the page scrolls sideways;
 *   (b) a number or amount wraps onto a second line (a split "12.345" or "Rp" / "1.234...");
 *   (c) text sticks out past the padded edge of the bordered, rounded card it sits in
 *       (unless it lives in a horizontal scroller that really scrolls).
 *
 * sr-only (<= 1px) boxes, aria-hidden subtrees and svg are ignored.
 */

test.use({
  viewport: { width: 360, height: 780 },
  hasTouch: true,
  isMobile: true,
});

// Deterministic layout measurement: a retry would only double the runtime of a real failure.
test.describe.configure({ retries: 0 });

type Role = "admin" | "teacher" | "parent";

const USER: Record<Role, string> = {
  admin: "u_super_admin",
  teacher: "u_teacher",
  parent: "u_rightjet",
};

// A route ending in `:/list` is the first detail page linked from `/list`.
const ROUTES: Record<Role, string[]> = {
  admin: [
    "/admin",
    "/admin/invoices",
    "/admin/invoices/:/admin/invoices",
    "/admin/students",
    "/admin/payments",
    "/admin/employees",
    "/admin/admissions",
    "/admin/payroll",
    "/admin/employee-attendance",
  ],
  teacher: ["/teacher", "/teacher/class-attendance"],
  parent: ["/parent", "/parent/invoices", "/parent/attendance"],
};

// components/reactbits/count-up.tsx animates 0.9s on a fresh mount, then swaps the animated
// span for a bare text node. Inflating before it settles would be overwritten, so wait it out.
const COUNT_UP_SETTLE_MS = 1800;

async function firstDetailHref(page: Page, list: string): Promise<string | null> {
  await page.goto(list, { waitUntil: "networkidle" });
  const link = page.locator(`a[href^="${list}/"]:not([href*="?"]):not([href$="/new"])`).first();
  if (!(await link.waitFor({ timeout: 10_000 }).then(() => true, () => false))) return null;
  return link.getAttribute("href");
}

// Plain function: serialised into the page by page.evaluate.
// Replaces seed-sized figures with production-sized ones.
function inflate(): void {
  // Amounts become Rp 1.234.567.890; bare 1-3 digit numbers become 12.345.
  const AMOUNT = /Rp\s?[\d.,]+(\s?(jt|rb|juta|ribu))?/g;
  const SMALL_NUMBER = /^\s*\d{1,3}\s*$/;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,input,textarea")) continue;
    const text = node.textContent ?? "";
    if (SMALL_NUMBER.test(text)) node.textContent = "12.345";
    else if (AMOUNT.test(text)) node.textContent = text.replace(AMOUNT, "Rp 1.234.567.890");
    AMOUNT.lastIndex = 0;
  }
}

// Plain function: serialised into the page by page.evaluate. Returns one readable string per violation.
function measure(): string[] {
  const out: string[] = [];
  const vw = window.innerWidth;
  const label = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
  const tag = (el: Element) => `<${el.tagName.toLowerCase()}>`;

  // (a) the whole page must fit the viewport.
  const overflow = document.documentElement.scrollWidth - vw;
  if (overflow > 0) out.push(`page scrolls sideways by ${overflow}px`);

  // A box inside a horizontal scroller that really scrolls may extend past its card: that is the point.
  const inRealScroller = (el: Element) => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return true;
    }
    return false;
  };
  const invisible = (el: Element) => {
    const s = getComputedStyle(el);
    return s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0;
  };

  for (const el of document.querySelectorAll("body *")) {
    if (el.closest('[aria-hidden="true"],[data-sonner-toaster],script,style,svg')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || invisible(el)) continue; // sr-only / collapsed
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
    if (!ownText) continue;

    // (b) a number or amount must stay on one line: taller than 1.6 lines means it wrapped.
    if (/^(Rp\s?)?[\d.,]+\s*%?$/.test(ownText)) {
      const cs = getComputedStyle(el);
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (rect.height > lineHeight * 1.6) {
        out.push(`wrapped number (${Math.round(rect.height)}px tall, line ${Math.round(lineHeight)}px) ${tag(el)} "${label(el)}"`);
      }
    }

    // (c) text must stay inside the padded content edge of its nearest bordered, rounded ancestor.
    // The text is measured with a Range so a wide block box with short text does not count.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      const bordered = parseFloat(s.borderLeftWidth) > 0 && parseFloat(s.borderRightWidth) > 0;
      if (!bordered || s.borderRadius === "0px") continue;
      const box = a.getBoundingClientRect();
      const left = box.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
      const right = box.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      if (text.width > 0 && !inRealScroller(el)) {
        if (text.right > right + 1) out.push(`text crosses card padding by ${Math.round(text.right - right)}px (right) ${tag(el)} "${label(el)}"`);
        else if (text.left < left - 1) out.push(`text crosses card padding by ${Math.round(left - text.left)}px (left) ${tag(el)} "${label(el)}"`);
      }
      break; // only the nearest card counts
    }
  }
  return [...new Set(out)];
}

for (const role of Object.keys(ROUTES) as Role[]) {
  test(`${role} pages survive production-sized numbers on a 360px phone`, async ({ context, page }) => {
    test.setTimeout(120_000);
    await context.addCookies([
      { name: "school-erp-session", value: USER[role], domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);

    for (const route of ROUTES[role]) {
      let url: string | null = route;
      if (route.includes(":/")) {
        url = await firstDetailHref(page, route.split(":")[1]);
        expect(url, `no detail row to open from ${route.split(":")[1]}`).not.toBeNull();
      }
      await page.goto(url!, { waitUntil: "networkidle" });
      await page.locator("h1").first().waitFor();
      await page.waitForTimeout(COUNT_UP_SETTLE_MS);

      await page.evaluate(inflate);
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      const violations = await page.evaluate(measure);
      expect.soft(violations, `${url} (${violations.length} violations):\n${violations.join("\n")}`).toEqual([]);
    }
  });
}
