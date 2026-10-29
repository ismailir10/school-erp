import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The one loading indicator. Standalone it is a labelled status; next to
 * visible text (inside a Button, beside "Menyimpan…") pass `aria-hidden` so the
 * text is the only announcement. Size via className (default `size-4`).
 */
function Spinner({
  className,
  "aria-label": ariaLabel = "Memuat",
  "aria-hidden": ariaHidden,
  ...props
}: React.ComponentProps<"svg">) {
  const decorative = ariaHidden === true || ariaHidden === "true"
  return (
    <Loader2Icon
      data-slot="spinner"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "status", "aria-label": ariaLabel })}
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
