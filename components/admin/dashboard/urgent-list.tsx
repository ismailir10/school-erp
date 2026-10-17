import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { AdminWorkItem } from "@/lib/dashboard/admin-work-queue";

/**
 * Top-N ranked work items (caller passes `rankUrgent(items).slice(0, 4)`),
 * with a footer link to the full `/admin/work-queue` table. `total` is the
 * full queue count (across all visible sources), independent of how many
 * items are actually rendered here.
 */
export function UrgentList({ items, total }: { items: AdminWorkItem[]; total: number }) {
  if (total === 0) return null;

  return (
    <Card data-testid="dashboard-urgent-list" className="gap-4">
      <CardHeader className="gap-1">
        <CardTitle>Perlu perhatian</CardTitle>
      </CardHeader>
      <CardContent className="space-y-field">
        <ul className="space-y-field">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body font-semibold">{item.title}</p>
                <p className="text-small text-muted-foreground">{item.description}</p>
              </div>
              <Link
                href={item.href}
                aria-label={`${item.actionLabel}: ${item.title}`}
                className={buttonVariants({ variant: "outline", size: "sm", className: "h-auto min-h-9 shrink-0 whitespace-normal text-left" })}
              >
                {item.actionLabel}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Link href="/admin/work-queue" className="inline-flex items-center gap-1 text-small font-medium text-primary hover:underline [@media(pointer:coarse)]:min-h-11">
          Lihat semua ({total})
          <ArrowRight className="size-3.5" />
        </Link>
      </CardFooter>
    </Card>
  );
}
