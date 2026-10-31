import * as React from "react"

import { cn } from "@/lib/utils"

type SectionCardProps = Omit<React.ComponentProps<"section">, "title"> & {
  /** Section title, rendered as an `<h2>`; also names the region. Omit for an untitled block. */
  title?: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned header slot (button, badge, link). Only rendered with a title. */
  action?: React.ReactNode
  /** Rendered under the content, separated by a top border. */
  footer?: React.ReactNode
  /** Classes for the content wrapper (spacing between children, grids). */
  contentClassName?: string
  /** `div` for a block nested inside another section or inside a sheet. */
  as?: "section" | "div"
}

/**
 * Bordered section block for detail pages and portal sections.
 *
 * Padding is `p-4` on phones and `p-card` from `md` up. Header: `text-h2`
 * title (the token carries weight and line-height), `text-small`
 * description, optional right-aligned action. No title, no header.
 */
function SectionCard({
  title,
  description,
  action,
  footer,
  className,
  contentClassName,
  as = "section",
  children,
  ...props
}: SectionCardProps) {
  const uid = React.useId()
  const titleId = `${uid}-title`
  const descriptionId = `${uid}-description`
  const hasTitle = title !== undefined && title !== null && title !== false
  const Comp = as as React.ElementType

  return (
    <Comp
      data-slot="section-card"
      aria-labelledby={hasTitle ? titleId : undefined}
      aria-describedby={hasTitle && description ? descriptionId : undefined}
      {...props}
      className={cn(
        "rounded-xl border border-border bg-card p-4 md:p-card",
        className
      )}
    >
      {hasTitle ? (
        <div
          data-slot="section-card-header"
          className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1 text-small text-muted-foreground"
              >
                {description}
              </p>
            ) : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-2">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div data-slot="section-card-content" className={contentClassName}>
        {children}
      </div>
      {footer ? (
        <div
          data-slot="section-card-footer"
          className="mt-4 border-t border-border pt-3"
        >
          {footer}
        </div>
      ) : null}
    </Comp>
  )
}

export { SectionCard }
export type { SectionCardProps }
