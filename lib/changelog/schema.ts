/**
 * Changelog ("Apa yang Baru") shape + the limits that keep it short.
 * Writing rules: docs/workflow/changelog.md. The limits here are the
 * enforceable half of that guide; `validateReleases` is run by Vitest.
 */
export const KINDS = ["baru", "lebih-baik", "diperbaiki"] as const;
export const AUDIENCES = ["semua", "admin", "guru", "orang-tua"] as const;

export type ChangeKind = (typeof KINDS)[number];
export type ChangeAudience = (typeof AUDIENCES)[number];

export interface ChangeItem {
  kind: ChangeKind;
  audience: ChangeAudience;
  text: string;
}

export interface Release {
  /** Promotion date `YYYY-MM-DD`; a second same-day promotion adds `-2`. */
  id: string;
  headline: string;
  items: ChangeItem[];
}

export const HEADLINE_MAX = 60;
export const ITEM_MAX = 140;
export const ITEMS_MIN = 2;
export const ITEMS_MAX = 7;
/** A promotion with nothing user-visible carries exactly this one item. */
export const MAINTENANCE_ITEM: ChangeItem = {
  kind: "lebih-baik",
  audience: "semua",
  text: "Pembaruan di balik layar agar Talib tetap cepat dan aman.",
};

const ID_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;
// PR numbers, links and code formatting have no place in user-facing notes.
const LEAKS = [/#\d+/, /https?:\/\//, /`/];

const isMaintenance = (items: ChangeItem[]) =>
  items.length === 1 &&
  items[0].kind === MAINTENANCE_ITEM.kind &&
  items[0].audience === MAINTENANCE_ITEM.audience &&
  items[0].text === MAINTENANCE_ITEM.text;

/** Returns human-readable problems; empty array means the list is valid. */
export function validateReleases(releases: readonly Release[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  let prev: string | null = null;

  for (const r of releases) {
    const at = `release ${r.id}`;
    if (!ID_RE.test(r.id)) errors.push(`${at}: id must be YYYY-MM-DD or YYYY-MM-DD-n`);
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (prev !== null && r.id >= prev) errors.push(`${at}: must be older than ${prev} (newest first)`);
    prev = r.id;

    if (!r.headline.trim()) errors.push(`${at}: headline is empty`);
    if (r.headline.length > HEADLINE_MAX) errors.push(`${at}: headline over ${HEADLINE_MAX} chars`);

    if (r.items.length > ITEMS_MAX) errors.push(`${at}: more than ${ITEMS_MAX} items`);
    if (r.items.length < ITEMS_MIN && !isMaintenance(r.items)) {
      errors.push(`${at}: needs ${ITEMS_MIN}-${ITEMS_MAX} items (or the single maintenance item)`);
    }

    r.items.forEach((it, i) => {
      const where = `${at} item ${i + 1}`;
      if (!KINDS.includes(it.kind)) errors.push(`${where}: unknown kind "${it.kind}"`);
      if (!AUDIENCES.includes(it.audience)) errors.push(`${where}: unknown audience "${it.audience}"`);
      if (!it.text.trim()) errors.push(`${where}: text is empty`);
      if (it.text.length > ITEM_MAX) errors.push(`${where}: text over ${ITEM_MAX} chars`);
      for (const re of LEAKS) {
        if (re.test(it.text) || re.test(r.headline)) errors.push(`${where}: contains ${re} (no PR numbers, links or code)`);
      }
    });
  }
  return errors;
}
