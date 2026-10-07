import { LEVEL_LABEL_LONG, LEVEL_ORDER, type Level } from "@/lib/curriculum/level-presentation";

/** Swatch classes mirror the bar segments in `ElementProgressRow`. */
const SWATCH: Record<Level, string> = {
  CONSISTENT: "bg-status-present",
  EMERGING: "bg-status-late",
  NEEDS_REINFORCEMENT: "bg-status-leave",
};

/**
 * One-line key for the Perkembangan colours and progress bars. Full level
 * names only — "Perlu" alone has no object. Keeps the "tahapan, bukan nilai"
 * framing: the bar is a share of notes, not a score.
 */
export function LevelLegend() {
  return (
    <div className="space-y-1" data-testid="perkembangan-legend">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Arti warna">
        {LEVEL_ORDER.map((level) => (
          <li key={level} className="inline-flex items-center gap-1.5">
            <span className={`size-2 shrink-0 rounded-full ${SWATCH[level]}`} aria-hidden="true" />
            {LEVEL_LABEL_LONG[level]}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Bilah menunjukkan sebaran catatan dari sekolah pada tiap tahap, bukan nilai.
      </p>
    </div>
  );
}
