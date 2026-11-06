import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Frames for the deck's mock screens. A mock is a simplified Talib screen: real labels, believable sample data,
 * the app's own tokens and type, but cropped to the part the slide talks about and stripped of everything else.
 * Never a screenshot: a screenshot goes stale with every UI change and shows real children's data.
 *
 * Sample people are invented (Aisyah, Umar, Bu Nur, Bu Guru Rina); amounts are plausible, not real tariffs.
 */

/** A phone, top-cropped to `height`. Portal screens are designed at 340px, a small real phone. */
export function Phone({
  className,
  height = 520,
  children,
}: {
  className?: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute w-[340px] overflow-hidden rounded-[2.25rem] border-[6px] border-foreground/85 bg-background shadow-card-elevated",
        className,
      )}
      style={{ height }}
    >
      <div className="mx-auto mt-2 h-1.5 w-20 rounded-full bg-foreground/15" />
      <div className="flex h-[calc(100%-14px)] flex-col">{children}</div>
    </div>
  );
}

/** The portal header both phone portals share: logo, wordmark, the signed-in person. */
export function PortalHeader({ initials, name }: { initials: string; name: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
      <Image src="/logo.png" alt="" width={22} height={22} className="rounded-md" />
      <span className="text-sm font-semibold">Talib</span>
      <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="grid size-6 place-items-center rounded-full bg-secondary text-[0.65rem] font-semibold text-primary-text">
          {initials}
        </span>
        {name}
      </span>
    </div>
  );
}

/** Bottom tab bar, labels as the portal shows them. */
export function BottomNav({ items, active }: { items: { label: string; icon: LucideIcon }[]; active: string }) {
  return (
    <div className="mt-auto grid border-t border-border/70 bg-card px-1 pb-2 pt-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map((it) => {
        const Icon = it.icon;
        const on = it.label === active;
        return (
          <span key={it.label} className={cn("flex flex-col items-center gap-0.5 text-[0.65rem]", on ? "font-semibold text-primary-text" : "text-muted-foreground")}>
            <Icon className="size-[18px]" strokeWidth={on ? 2.25 : 1.75} />
            {it.label}
          </span>
        );
      })}
    </div>
  );
}

/** A desktop browser window for admin screens. */
export function Browser({
  className,
  url,
  children,
}: {
  className?: string;
  /** Path only; the host is fixed. */
  url: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("absolute overflow-hidden rounded-2xl border border-border bg-background shadow-card-elevated", className)}>
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/60 px-3 py-2">
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="size-2.5 rounded-full bg-foreground/15" />
        <span className="ml-3 truncate rounded-md bg-card px-2.5 py-0.5 text-[0.7rem] text-muted-foreground">
          talib.annisaasekolahku.com{url}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A card lifted off the stage: the one detail the slide wants you to look at. */
export function Float({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("absolute rounded-2xl border border-border bg-card p-4 shadow-card-elevated", className)}>
      {children}
    </div>
  );
}
