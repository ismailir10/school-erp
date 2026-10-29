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
 *       (unless it lives in a horizontal scroller that really scrolls);
 *   (d) an essential label is cut off with an ellipsis / line clamp (see ESSENTIALS).
 *
 * Teacher and parent also get a second pass at 320x640, the smallest phone we support.
 *
 * sr-only (<= 1px) boxes, aria-hidden subtrees and svg are ignored.
 */

test.use({ hasTouch: true, isMobile: true });

// Deterministic layout measurement: a retry would only double the runtime of a real failure.
test.describe.configure({ retries: 0 });

type Role = "admin" | "teacher" | "parent";

const USER: Record<Role, string> = {
  admin: "u_super_admin",
  teacher: "u_teacher",
  parent: "u_rightjet",
};

// A route ending in `:/list` is the first detail page linked from `/list`.
type Pass = { role: Role; width: number; height: number; routes: string[] };

const PASSES: Pass[] = [
  {
    role: "admin",
    width: 360,
    height: 780,
    routes: [
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
  },
  { role: "teacher", width: 360, height: 780, routes: ["/teacher", "/teacher/class-attendance"] },
  { role: "parent", width: 360, height: 780, routes: ["/parent", "/parent/invoices", "/parent/attendance"] },
  // Smallest supported phone. student-journal redirects to its entry page.
  {
    role: "teacher",
    width: 320,
    height: 640,
    routes: ["/teacher", "/teacher/class-attendance", "/teacher/student-journal"],
  },
  { role: "parent", width: 320, height: 640, routes: ["/parent", "/parent/invoices", "/parent/attendance"] },
];

/**
 * Rule (d): text the user needs to read must not be clipped. An element matching one of these
 * selectors is a violation when it is ellipsised / line-clamped AND actually cut off. Free-text
 * notes (journal notes, nicknames, recent-activity text) are deliberately not listed.
 *
 *  - bottom nav label: <nav aria-label="Navigasi utama ..."> span (portal-bottom-nav.tsx, `truncate`)
 *  - class-attendance student name: first <p> of the roster row's text column (data-testid="roster-row")
 *  - status / summary lines: TaskRow descriptions (data-slot="item-description" from components/ui/item):
 *    parent home attendance + bill card, parent invoice rows, teacher home progress lines. They sit in a
 *    task-list Card or a plain Card (the parent home bill card), so the slot alone is the stable hook.
 */
const ESSENTIALS: { what: string; selector: string }[] = [
  { what: "bottom-nav label", selector: 'nav[aria-label^="Navigasi utama"] a span, nav[aria-label^="Navigasi utama"] button span' },
  { what: "student name", selector: '[data-testid="roster-row"] .min-w-0 > p:first-child' },
  { what: "status line", selector: '[data-slot="item-description"]' },
];

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
type MeasureArg = { phase: "layout" | "essentials"; essentials: { what: string; selector: string }[] };

function measure(arg: MeasureArg): string[] {
  const { phase, essentials } = arg;
  const out: string[] = [];
  const vw = window.innerWidth;
  const label = (el: Element) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
  const tag = (el: Element) => `<${el.tagName.toLowerCase()}>`;

  // (a) the whole page must fit the viewport.
  const overflow = document.documentElement.scrollWidth - vw;
  if (phase === "layout" && overflow > 0) out.push(`page scrolls sideways by ${overflow}px`);

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

  for (const el of phase === "layout" ? document.querySelectorAll("body *") : []) {
    if (el.closest('[aria-hidden="true"],[data-sonner-toaster],script,style,svg')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || invisible(el)) continue; // sr-only / collapsed
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
    if (!ownText) continue;

    // (b) a number or amount must stay on one line: count the line boxes of its own text.
    if (/^(Rp\s?)?[\d.,]+\s*%?$/.test(ownText)) {
      const tops: number[] = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !(n.textContent ?? "").trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const q of r.getClientRects()) if (q.width > 0 && q.height > 0) tops.push(q.top);
      }
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 14;
      // Two rects on one line share a top (+-1px of subpixel noise); a wrap moves down by ~a line.
      const lines = [...tops].sort((x, y) => x - y).filter((t, i, all) => i === 0 || t - all[i - 1] > fontSize * 0.6).length;
      if (lines > 1) out.push(`wrapped number (${lines} lines) ${tag(el)} "${label(el)}"`);
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

  // (d) no truncated essentials. Measured on the data as seeded: inflating counts inside a sentence
  // ("12.345 tagihan") would make a status line longer than any real one.
  for (const { what, selector } of phase === "essentials" ? essentials : []) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1 || invisible(el)) continue;
      const cs = getComputedStyle(el);
      const clamped = cs.textOverflow === "ellipsis" || (cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none";
      if (!clamped) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        out.push(`truncated ${what} ${tag(el)} "${label(el)}"`);
      }
    }
  }
  return [...new Set(out)];
}

for (const { role, width, height, routes } of PASSES) {
  test.describe(`${role} @ ${width}px`, () => {
    test.use({ viewport: { width, height } });

    test(`${role} pages survive production-sized numbers on a ${width}px phone`, async ({ context, page }) => {
      test.setTimeout(120_000);
      await context.addCookies([
        { name: "school-erp-session", value: USER[role], domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
      ]);

      for (const route of routes) {
        let url: string | null = route;
        if (route.includes(":/")) {
          url = await firstDetailHref(page, route.split(":")[1]);
          expect(url, `no detail row to open from ${route.split(":")[1]}`).not.toBeNull();
        }
        await page.goto(url!, { waitUntil: "networkidle" });
        await page.locator("h1").first().waitFor();
        await page.waitForTimeout(COUNT_UP_SETTLE_MS);

        const truncated = await page.evaluate(measure, { phase: "essentials", essentials: ESSENTIALS } as MeasureArg);
        await page.evaluate(inflate);
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
        const violations = [...(await page.evaluate(measure, { phase: "layout", essentials: ESSENTIALS } as MeasureArg)), ...truncated];
        expect.soft(violations, `${width}px ${page.url().replace(/^https?:\/\/[^/]+/, "")} (${violations.length} violations):\n${violations.join("\n")}`).toEqual([]);
      }
    });
  });
}
