import Link from "next/link";
import { Progress } from "@/components/ui/progress";
import { Stagger, StaggerItem } from "@/components/reactbits/stagger";

export type RankedClass = {
  key: string;
  name: string;
  /** Integer percent, 0..100. */
  percent: number;
  caption?: string;
  href: string;
};

/**
 * "Which classes need a look" list under a chart: name, percent, a thin bar,
 * and an optional caption. Each row opens the module that owns the number.
 */
export function ClassRankList({ heading, items }: { heading: string; items: RankedClass[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">{heading}</h3>
      <Stagger as="ul" count={items.length} className="mt-1 divide-y">
        {items.map((item) => (
          <StaggerItem as="li" key={item.key}>
            <Link
              href={item.href}
              className="-mx-2 block min-h-11 rounded-md px-2 py-2 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body font-medium">{item.name}</span>
                <span className="shrink-0 text-body font-semibold tabular-nums">{item.percent}%</span>
              </span>
              <Progress
                value={item.percent}
                aria-label={`${item.name} ${item.percent} persen`}
                className="mt-1.5 gap-0 [&_[data-slot=progress-track]]:h-1.5"
              />
              {item.caption && <span className="mt-1 block text-small text-muted-foreground">{item.caption}</span>}
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}
