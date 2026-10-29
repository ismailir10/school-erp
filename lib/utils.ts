import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge only knows Tailwind's default scale, so it reads our theme
 * tokens (`text-caption`, `shadow-raised`, `z-sticky`) as colours or unknowns
 * and drops the wrong class: `cn("text-caption text-muted-foreground")` lost
 * the colour. Register each token family with the group it belongs to; a new
 * token in `app/globals.css` needs its name here too.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "h1", "h2", "body", "small", "caption"],
      shadow: ["resting", "raised", "overlay", "sticky-edge", "card-resting", "card-elevated"],
    },
    classGroups: {
      z: [{ z: ["base", "sticky", "header", "nav", "dropdown", "overlay", "toast"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
