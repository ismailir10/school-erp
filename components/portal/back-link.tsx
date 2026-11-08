import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The "up one level" link at the top of a portal detail page.
 *
 * The teacher portal had grown three of these: a bare `ChevronLeft` + section
 * name at 20px tall with no focus ring (Penilaian Pekanan, Sentra), an
 * `ArrowLeft` + "Kembali" button at 44px with a ring (the per-student week
 * view), and nothing at all on the session roster. Two icons, two labels and
 * two tap sizes for one job, one tap apart. This is the one.
 *
 * `ArrowLeft` over `ChevronLeft` deliberately: a chevron is the disclosure
 * glyph used by every list row in the portal to mean "go deeper", so pointing
 * one backwards at the top of the page reuses a symbol that already means
 * something else.
 */
export function BackLink({
  href,
  label = "Kembali",
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-page-back=""
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 -ml-2 text-sm text-muted-foreground",
        "transition-colors hover:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <ArrowLeft size={16} aria-hidden="true" />
      {label}
    </Link>
  );
}

export default BackLink;
