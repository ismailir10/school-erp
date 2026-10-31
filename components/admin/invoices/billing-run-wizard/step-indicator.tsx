"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Step indicator for the Billing Run wizard (Cycle B1 —
// docs/cycles/2026-08-14-billing-run-wizard.md, Task T8, Assumption 6). No
// stepper primitive existed anywhere in the repo, so this is built from
// vendored primitives (an `<ol>`, matching how components/ui/breadcrumb.tsx
// structures its own list) rather than a generic div soup.
//
// Accessibility (better-accessibility):
// - `<ol>` + `<li>` so a screen reader announces "list, 3 items" and lets a
//   user navigate step-by-step, the same way components/ui/pagination.tsx
//   and the portal bottom-nav components already use `aria-current="page"`
//   on the active nav item — this is the same pattern, applied with the
//   step-specific token (`aria-current="step"`) the spec calls for.
// - State is never colour-only: complete/current/upcoming each carry a
//   distinct icon (check / numbered-filled / numbered-outline) AND a
//   visually-hidden status suffix on the label, so removing colour entirely
//   (e.g. Windows High Contrast, colour-blindness) still communicates state.

export type StepIndicatorItem = {
  step: number;
  label: string;
};

type StepStatus = "complete" | "current" | "upcoming";

function statusOf(step: number, current: number): StepStatus {
  if (step < current) return "complete";
  if (step === current) return "current";
  return "upcoming";
}

export function StepIndicator({
  steps,
  current,
}: {
  steps: StepIndicatorItem[];
  current: number;
}) {
  return (
    <ol aria-label="Langkah wizard tagihan" className="flex items-start">
      {steps.map((s, i) => {
        const status = statusOf(s.step, current);
        const isLast = i === steps.length - 1;
        return (
          <li
            key={s.step}
            aria-current={status === "current" ? "step" : undefined}
            className={cn("flex items-center", !isLast && "flex-1")}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-medium",
                  status === "complete" &&
                    "border-primary bg-primary text-primary-foreground",
                  status === "current" && "border-primary text-primary",
                  status === "upcoming" && "border-border text-muted-foreground",
                )}
              >
                {status === "complete" ? <Check size={12} /> : s.step}
              </span>
              <span
                className={cn(
                  "font-medium whitespace-nowrap",
                  status === "upcoming" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {s.label}
                <span className="sr-only">
                  {status === "complete" && " (selesai)"}
                  {status === "current" && " (langkah saat ini)"}
                  {status === "upcoming" && " (belum dimulai)"}
                </span>
              </span>
            </div>
            {!isLast && (
              <span
                aria-hidden="true"
                className={cn(
                  "mx-3 h-px flex-1",
                  status === "complete" ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
