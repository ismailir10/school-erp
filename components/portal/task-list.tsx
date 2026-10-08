import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";

type TaskRowBaseProps = {
  title: string;
  /** Plain text, or inline markup when one phrase needs its own tone (e.g. "2 lewat tempo"). */
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  tone?: "teal" | "warm" | "purple" | "danger";
  className?: string;
};

/** Navigation and actions are mutually exclusive. Omit both for a read-only row. */
export type TaskRowProps = TaskRowBaseProps & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
  | { href?: never; onClick?: never }
);

/** A grouped list for the short, actionable rows in teacher and parent portals. */
export function TaskList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card data-slot="task-list" className={cn("gap-0 overflow-hidden py-0", className)}>
      {children}
    </Card>
  );
}

export function TaskRow({
  title,
  description,
  icon,
  meta,
  href,
  onClick,
  tone = "teal",
  className,
}: TaskRowProps) {
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      {icon ? (
        <ItemMedia
          variant="icon"
          aria-hidden="true"
          className={cn(
            "size-10 rounded-lg bg-secondary text-primary-text",
            tone === "warm" && "bg-status-late-subtle text-status-late-text",
            tone === "purple" && "bg-status-holiday-subtle text-status-holiday-text",
            tone === "danger" && "bg-status-absent-subtle text-status-absent-text",
          )}
        >
          {icon}
        </ItemMedia>
      ) : null}
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-auto text-body font-semibold leading-snug">{title}</ItemTitle>
        {description ? <ItemDescription className="text-small">{description}</ItemDescription> : null}
      </ItemContent>
      {meta || interactive ? (
        <ItemActions className="max-w-[42%] shrink-0 flex-wrap justify-end text-right text-small font-semibold text-muted-foreground">
          {meta}
          {interactive ? <ChevronRight aria-hidden="true" className="size-4" /> : null}
        </ItemActions>
      ) : null}
    </>
  );

  const rowClassName = cn(
    "min-h-17 flex-nowrap gap-3 rounded-none border-0 border-b border-border/70 px-4 py-3 text-left last:border-b-0",
    interactive && "hover:bg-secondary/40 focus-visible:z-10 focus-visible:bg-secondary/40",
    className,
  );

  if (href) {
    return (
      <Item render={<Link href={href} />} className={rowClassName}>
        {content}
      </Item>
    );
  }

  if (onClick) {
    return (
      <Item render={<button type="button" onClick={onClick} />} className={rowClassName}>
        {content}
      </Item>
    );
  }

  return <Item className={rowClassName}>{content}</Item>;
}
