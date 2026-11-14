import type { ReactNode } from "react";

/**
 * A stat card that is also the filter for the rows it counts. Wrap a `StatTile`;
 * the selected card is ringed and exposed as a pressed toggle.
 */
export function StatFilter({
  label, value, pressed, onPress, children,
}: { label: string; value: string | number; pressed: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${label}: ${value}`}
      onClick={onPress}
      className="block w-full rounded-lg text-left outline-none focus-visible:focus-outline aria-pressed:ring-2 aria-pressed:ring-primary/40"
    >
      {children}
    </button>
  );
}
