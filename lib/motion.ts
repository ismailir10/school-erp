/**
 * Motion constants for JS callers (framer-motion transitions).
 *
 * CSS callers use the Tailwind theme tokens instead (`ease-emphasized`,
 * `duration-base`); both sides are defined in `app/globals.css`. Keep the
 * values here in step with `--ease-*` and `--transition-duration-*` there.
 */

/** Matches `--ease-emphasized` — the house ease-out for entrances and reveals. */
export const EASE_EMPHASIZED = [0.22, 1, 0.36, 1] as const;

/** Matches `--ease-standard`. */
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

/** Seconds, matching `--transition-duration-fast|base|slow` (120 / 200 / 320 ms). */
export const DURATION = { fast: 0.12, base: 0.2, slow: 0.32 } as const;
