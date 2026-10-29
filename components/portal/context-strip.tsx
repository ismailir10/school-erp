import type { ReactNode } from "react";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

export type ContextStripProps = {
  name: string;
  detail?: string;
  avatar?: ReactNode;
  className?: string;
};

/** Read-only identity cue for a child's or class's detail surface. */
export function ContextStrip({ name, detail, avatar, className }: ContextStripProps) {
  return (
    <Item
      data-slot="context-strip"
      className={cn("min-h-12 gap-2 rounded-none border-x-0 border-t-0 border-b border-border bg-secondary/40 px-page-x py-2", className)}
    >
      {avatar ? <ItemMedia aria-hidden="true" className="shrink-0">{avatar}</ItemMedia> : null}
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-auto font-semibold text-primary-text">{name}</ItemTitle>
        {detail ? <ItemDescription className="text-small">{detail}</ItemDescription> : null}
      </ItemContent>
    </Item>
  );
}
