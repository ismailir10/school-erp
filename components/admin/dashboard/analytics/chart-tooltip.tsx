import type { ReactNode } from "react";

export type TooltipRow = { label: string; value: ReactNode; color?: string };

/**
 * Hover card for the Analitik charts. Same surface as `ChartTooltipContent`
 * (so it reads as one system) but with a free-form title and rows, because
 * these charts show a breakdown the plotted series alone can't carry.
 */
export function TooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium text-foreground">{title}</p>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            {row.color && (
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: row.color }} />
            )}
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
