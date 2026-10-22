import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardRetry } from "@/components/admin/dashboard/admin-work-queue";
import { cn } from "@/lib/utils";

/** Every chart in the Analitik section sits at this height so a card never shifts when its data arrives. */
export const ANALYTICS_CHART_CLASS = "aspect-auto h-[220px] w-full";

type CardLink = { label: string; href: string };

function ActionLink({ action }: { action: CardLink }) {
  return (
    <CardAction className="max-w-full shrink-0">
      <Button variant="ghost" size="sm" nativeButton={false} role="link" render={<Link href={action.href} />}>
        {action.label}
        <ArrowRight />
      </Button>
    </CardAction>
  );
}

/**
 * Shared shell for the Analitik cards: bordered header with the title, the
 * window the numbers cover, and one link to the module. `summary` is a
 * one-sentence screen-reader reading of the chart, which is otherwise only
 * reachable point by point.
 */
export function AnalyticsCard({
  testId,
  title,
  description,
  action,
  summary,
  className,
  children,
}: {
  testId: string;
  title: string;
  description: string;
  action: CardLink;
  summary?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card data-testid={testId} className={cn("min-w-0", className)}>
      <CardHeader className="flex flex-wrap gap-x-3 gap-y-2 border-b">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <ActionLink action={action} />
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && <p className="sr-only">{summary}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

/** A card whose source failed: say so and offer a retry, never a false zero. */
export function AnalyticsUnavailable({
  testId,
  title,
  message,
  className,
}: {
  testId: string;
  title: string;
  message: string;
  className?: string;
}) {
  return (
    <Card data-testid={testId} className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <p className="text-body text-muted-foreground">{message}</p>
        <DashboardRetry />
      </CardContent>
    </Card>
  );
}
