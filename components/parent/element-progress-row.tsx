import { formatCurriculumElement } from "@/lib/format";
import { LEVEL_LABEL_LONG } from "@/lib/curriculum/level-presentation";

type Counts = {
  CONSISTENT: number;
  EMERGING: number;
  NEEDS_REINFORCEMENT: number;
  total: number;
};

/**
 * Pure presentational row used by `/parent/perkembangan/[studentId]`.
 *
 * Renders one curriculum element (Indonesian label) with a 3-segment
 * proportional progress bar (`bg-status-present` / `bg-status-late` /
 * `bg-status-absent` per .claude/standards/colors.md) plus a numeric
 * read-out with the FULL level names ("N Mampu dan Konsisten · N Mampu Belum
 * Konsisten · N Perlu Penguatan") — the short forms read as fragments ("Perlu"
 * with no object). The colour key lives in `LevelLegend`. Empty rows (total = 0) show a
 * neutral muted bar + "Belum ada catatan" copy.
 *
 * Pure — no fetch, no state. Snapshot tested via Playwright + design-
 * system.html §dashboard cross-check. Server component (no client hooks).
 */
export function ElementProgressRow({
  element,
  counts,
}: {
  element: string;
  counts: Counts;
}) {
  const label = formatCurriculumElement(element);
  const total = counts.total;
  const empty = total === 0;
  const consistentPct = empty ? 0 : (counts.CONSISTENT / total) * 100;
  const emergingPct = empty ? 0 : (counts.EMERGING / total) * 100;
  const needsPct = empty ? 0 : (counts.NEEDS_REINFORCEMENT / total) * 100;

  return (
    <li
      className="space-y-1.5 rounded-lg border border-input bg-card p-3"
      data-testid={`perkembangan-element-${element}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <span className="text-xs text-muted-foreground">
          {empty ? "—" : `${total} catatan`}
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          empty
            ? `${label}: belum ada catatan`
            : `${label}: ${counts.CONSISTENT} ${LEVEL_LABEL_LONG.CONSISTENT}, ${counts.EMERGING} ${LEVEL_LABEL_LONG.EMERGING}, ${counts.NEEDS_REINFORCEMENT} ${LEVEL_LABEL_LONG.NEEDS_REINFORCEMENT} dari ${total} catatan`
        }
      >
        {empty ? (
          <div className="h-full w-full bg-muted" />
        ) : (
          <>
            {consistentPct > 0 && (
              <div
                className="h-full bg-status-present"
                style={{ width: `${consistentPct}%` }}
              />
            )}
            {emergingPct > 0 && (
              <div
                className="h-full bg-status-late"
                style={{ width: `${emergingPct}%` }}
              />
            )}
            {needsPct > 0 && (
              <div
                className="h-full bg-status-leave"
                style={{ width: `${needsPct}%` }}
              />
            )}
          </>
        )}
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground italic">
          Belum ada catatan untuk semester ini.
        </p>
      ) : (
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="text-status-present-text">
            {counts.CONSISTENT} {LEVEL_LABEL_LONG.CONSISTENT}
          </span>
          <span className="text-status-late-text">
            {counts.EMERGING} {LEVEL_LABEL_LONG.EMERGING}
          </span>
          <span className="text-status-leave-text">
            {counts.NEEDS_REINFORCEMENT} {LEVEL_LABEL_LONG.NEEDS_REINFORCEMENT}
          </span>
        </p>
      )}
    </li>
  );
}
