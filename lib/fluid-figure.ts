/**
 * Fluid size for a KPI figure inside a size container (`@container` on an
 * ancestor whose content box is the figure's width).
 *
 * A fixed `text-display` wraps or collides with the card edge as soon as the
 * figure is long ("Rp 1.234.567.890" in a half-width card at 360px). Instead the
 * size is `clamp(floor, N cqi, cap)`, where N is picked from the figure's
 * character count so the whole string fits in ~90 % of the container width.
 * `font-currency` is monospaced at 0.6 em per character, so the rendered width is
 * `chars * 0.6 * N` cqi:
 *
 *   ≤ 4 chars   N = 38   4 × 0.6 × 38 = 91.2   (hits the cap in any real card)
 *   ≤ 6 chars   N = 24   6 × 0.6 × 24 = 86.4
 *   ≤ 10 chars  N = 15  10 × 0.6 × 15 = 90.0
 *   > 10 chars  N = 9   17 × 0.6 ×  9 = 91.8   ("Rp 1.234.567.890" is 16 → 86.4)
 *
 * The floor is 0.75rem (the `text-small` size) so a pathological value stays
 * legible; the figure is always `whitespace-nowrap`, never wrapped mid-number.
 * `length:` makes the arbitrary value an unambiguous font-size for tailwind-merge,
 * so it can't swallow a text-colour class. Full literals below so Tailwind's
 * scanner sees every class.
 */
export type FluidCap = "display" | "h2" | "base";

const FLUID: Record<FluidCap, [string, string, string, string]> = {
  display: [
    "text-[length:clamp(0.75rem,38cqi,var(--type-display))]",
    "text-[length:clamp(0.75rem,24cqi,var(--type-display))]",
    "text-[length:clamp(0.75rem,15cqi,var(--type-display))]",
    "text-[length:clamp(0.75rem,9cqi,var(--type-display))]",
  ],
  h2: [
    "text-[length:clamp(0.75rem,38cqi,var(--type-h2))]",
    "text-[length:clamp(0.75rem,24cqi,var(--type-h2))]",
    "text-[length:clamp(0.75rem,15cqi,var(--type-h2))]",
    "text-[length:clamp(0.75rem,9cqi,var(--type-h2))]",
  ],
  base: [
    "text-[length:clamp(0.75rem,38cqi,1rem)]",
    "text-[length:clamp(0.75rem,24cqi,1rem)]",
    "text-[length:clamp(0.75rem,15cqi,1rem)]",
    "text-[length:clamp(0.75rem,9cqi,1rem)]",
  ],
};

export function fluidFigureClass(length: number, cap: FluidCap = "display"): string {
  const bucket = length <= 4 ? 0 : length <= 6 ? 1 : length <= 10 ? 2 : 3;
  return FLUID[cap][bucket];
}
