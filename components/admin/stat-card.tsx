"use client";

import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp } from "@/components/reactbits/count-up";
import { Spotlight } from "@/components/reactbits/spotlight";
import { formatNumber } from "@/lib/format";
import { fluidFigureClass } from "@/lib/fluid-figure";

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  color = "primary",
  index = 0,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: LucideIcon;
  color?: "primary" | "success" | "warning" | "error";
  index?: number;
}) {
  const colorMap = {
    primary: { bg: "bg-primary/10", text: "text-primary", icon: "text-primary" },
    success: { bg: "bg-success-subtle", text: "text-success-text", icon: "text-success-text" },
    warning: { bg: "bg-warning-subtle", text: "text-warning-text", icon: "text-warning-text" },
    error: { bg: "bg-destructive-subtle", text: "text-destructive-text", icon: "text-destructive-text" },
  };

  const c = colorMap[color];

  // Longest rendering of the figure: CountUp prints String(n), a pre-formatted
  // string prints as given; formatNumber covers a thousands-separated count.
  const figureChars =
    typeof value === "number" ? Math.max(String(value).length, formatNumber(value).length) : value.length;

  return (
    <Card className="relative isolate transition-shadow hover:shadow-md" data-index={index}>
      <CardContent>
        {/* The card's content box is a size container: the figure is sized from its
            width (cqi), not the viewport, so "Rp 1.234.567.890" or "12.345" fit a
            half-width card at 360px without wrapping or touching the edge. Label and
            icon share the top row; the figure gets the full width below (FIN-21). */}
        <div className="@container min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-field">
            <p className="min-w-0 wrap-anywhere text-caption font-semibold uppercase tracking-wide sm:tracking-wider text-muted-foreground">
              {label}
            </p>
            <div className={`flex size-6 shrink-0 items-center justify-center rounded-xl sm:size-10 ${c.bg}`}>
              <Icon className={`size-4 sm:size-5 ${c.icon}`} />
            </div>
          </div>
          <p
            className={`mt-1.5 whitespace-nowrap font-currency font-bold leading-[1.15] tracking-tight tabular-nums ${fluidFigureClass(figureChars)}`}
          >
            {/* Only numbers count up; pre-formatted strings ("Rp …", "…", "—") stay static. */}
            {typeof value === "number" ? <CountUp value={value} /> : value}
          </p>
          {sublabel && (
            <p className="mt-1 text-small text-muted-foreground">{sublabel}</p>
          )}
        </div>
      </CardContent>
      <Spotlight />
    </Card>
  );
}
