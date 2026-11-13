import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "group/alert @container grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-y-1 rounded-lg border px-3 py-2.5 text-start text-body [&>svg]:col-start-1 [&>svg]:row-span-2 [&>svg]:row-start-1 [&>svg]:mt-0.5 [&>svg]:me-2 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        info: "border-info bg-info-subtle text-info-text",
        success: "border-success bg-success-subtle text-success-text",
        warning: "border-warning bg-warning-subtle text-warning-text",
        destructive: "border-destructive bg-destructive-subtle text-destructive-text",
        celebration: "border-celebration-gold bg-celebration-gold-subtle text-celebration-gold-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type AlertAnnouncement = "off" | "polite" | "assertive"

const ANNOUNCEMENT_ROLE = {
  off: undefined,
  polite: "status",
  assertive: "alert",
} as const

const MESSAGE_COLUMNS = "col-start-2 col-end-4 @md:group-has-data-[slot=alert-action]/alert:col-end-3"

function Alert({
  className,
  variant,
  announcement = "assertive",
  role = ANNOUNCEMENT_ROLE[announcement],
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants> & {
  announcement?: AlertAnnouncement
}) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        MESSAGE_COLUMNS,
        "font-heading font-medium wrap-anywhere [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        MESSAGE_COLUMNS,
        "wrap-anywhere text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "col-start-2 col-end-4 flex min-w-0 flex-wrap items-center gap-2 pt-1 @md:col-start-3 @md:row-span-2 @md:row-start-1 @md:ms-3 @md:justify-end @md:pt-0",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
