"use client";

import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp } from "@/components/reactbits/count-up";
import { Spotlight } from "@/components/reactbits/spotlight";

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

  return (
    <Card className="relative isolate transition-shadow hover:shadow-md" data-index={index}>
      <CardContent>
        <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-field">
          <div className="min-w-0 wrap-break-word">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            {/* A long figure ("Rp 12.345.678") at display size wraps to three lines
                in a half-width card at 390px — scale it down there, and never
                break inside the amount (FIN-21). */}
            <p
              className={`mt-1.5 font-currency font-bold tracking-tight tabular-nums ${
                typeof value === "string" && value.length > 8
                  ? "whitespace-nowrap text-h2 sm:text-display"
                  : "text-display"
              }`}
            >
              {/* Only numbers count up; pre-formatted strings ("Rp …", "…", "—") stay static. */}
              {typeof value === "number" ? <CountUp value={value} /> : value}
            </p>
            {sublabel && (
              <p className="mt-1 text-small text-muted-foreground">{sublabel}</p>
            )}
          </div>
          <div className={`flex size-6 shrink-0 items-center justify-center rounded-xl sm:size-10 ${c.bg}`}>
            <Icon className={`size-4 sm:size-5 ${c.icon}`} />
          </div>
        </div>
      </CardContent>
      <Spotlight />
    </Card>
  );
}
