import type { Release } from "./schema";
import part1 from "./data/part-1";
import part2 from "./data/part-2";
import part3 from "./data/part-3";

/**
 * Every `main` promotion, newest first (one entry per promotion date).
 * Add the new entry at the TOP of the newest data file, never rewrite old ones.
 * How to write it: docs/workflow/changelog.md.
 */
export const RELEASES: readonly Release[] = [...part3, ...part2, ...part1].sort((a, b) =>
  a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
);
