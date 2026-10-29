import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type SaveStatusProps = {
  state: "saving" | "saved" | "error";
  message?: string;
  className?: string;
};

const defaultMessage = {
  saving: "Menyimpan…",
  saved: "Tersimpan",
  error: "Gagal menyimpan",
};

/** Keep mounted as state changes so screen readers can announce save feedback. */
export function SaveStatus({ state, message, className }: SaveStatusProps) {
  const Icon = state === "saved" ? CheckCircle2 : AlertCircle;
  return (
    <p
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 text-small text-muted-foreground",
        state === "saved" && "text-status-present-text",
        state === "error" && "text-destructive",
        className,
      )}
    >
      {state === "saving" ? <Spinner aria-hidden /> : <Icon aria-hidden="true" className="size-4" />}
      <span>{message ?? defaultMessage[state]}</span>
    </p>
  );
}
