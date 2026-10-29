/**
 * ErrorState — shared "this could not load" surface for route `error.tsx`
 * boundaries and failed fetches. The sibling of EmptyState: same centred
 * column, but the icon is destructive and the CTA is a retry.
 *
 * Props:
 *   title        What failed, in plain Indonesian ("Gagal memuat tagihan").
 *   description? What to do next ("Coba lagi sebentar ya.").
 *   onRetry?     Renders the retry button. Omit when retrying is meaningless.
 *   retryLabel?  Default "Coba lagi" (sentence case, per voice.md).
 *   icon?        Lucide icon component (default: AlertCircle).
 *   children?    Extra actions rendered beside the retry button (e.g. a
 *                "Kembali ke Beranda" link).
 *
 * `role="alert"` so a screen reader announces the failure when the boundary
 * swaps in. Tokens only — no raw hex.
 */
import type { ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Coba lagi",
  icon: Icon = AlertCircle,
  className,
  children,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "mx-auto flex max-w-md flex-col items-center justify-center px-4 py-16 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <Icon size={24} aria-hidden="true" className="text-destructive" />
      </div>
      <h2 className="text-h2 font-semibold text-foreground text-balance">{title}</h2>
      {description && (
        <p className="mt-1 text-small leading-relaxed text-muted-foreground text-pretty">{description}</p>
      )}
      {(onRetry || children) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button variant="outline" onClick={onRetry} className="tap-target">
              {retryLabel}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
