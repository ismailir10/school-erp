import type { Metadata } from "next";

/** Browser-tab title shape: "<page> · Talib". The root layout owns the default for untitled pages. */
export const TITLE_TEMPLATE = "%s · Talib";

/**
 * Metadata for a `layout.tsx` that titles the routes beneath it.
 *
 * Use this — not `{ title: "Siswa" }` — in layouts. Next resets the inherited
 * `title.template` whenever a layout sets a plain string title, so a nested
 * route (`/admin/students/[id]` under `/admin/students`) would silently lose
 * the " · Talib" suffix. Declaring `absolute` + `template` titles this segment
 * itself *and* hands the template on to deeper segments.
 *
 * Leaf `page.tsx` files can keep `export const metadata = { title: "Kelas" }`.
 */
export function pageTitle(name: string): Metadata {
  return {
    title: {
      absolute: TITLE_TEMPLATE.replace("%s", name),
      template: TITLE_TEMPLATE,
    },
  };
}
