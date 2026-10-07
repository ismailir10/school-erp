"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { parentHref } from "@/lib/parent/navigation";

/**
 * The `?child=` the URL asked for when it is not one of the parent's own
 * children (a foreign id, a deleted child, a typo) — else null. The server
 * already falls back to the first child; this lets the UI say so.
 */
export function rejectedChildParam(
  knownIds: readonly string[],
  requested: string | null | undefined,
): string | null {
  if (!requested || knownIds.length === 0) return null;
  return knownIds.includes(requested) ? null : requested;
}

/**
 * One-line notice + URL correction for a rejected `?child=`. Scoping is
 * unchanged: pages still resolve to a guardian-linked child; this only tells
 * the parent which child they are looking at and removes the foreign id from
 * the address bar.
 */
export function ChildParamNotice({
  knownIds,
  selectedChildId,
  selectedName,
}: {
  knownIds: readonly string[];
  selectedChildId: string;
  selectedName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rejected = rejectedChildParam(knownIds, searchParams.get("child"));
  // Latched so the notice outlives the URL correction below.
  const [latched, setLatched] = useState(false);
  if (rejected && !latched) setLatched(true);

  useEffect(() => {
    if (!rejected) return;
    const local = Object.fromEntries(new URLSearchParams(searchParams.toString()));
    router.replace(parentHref(pathname, selectedChildId, local), { scroll: false });
  }, [rejected, pathname, router, searchParams, selectedChildId]);

  if (!rejected && !latched) return null;

  return (
    <p
      role="status"
      data-testid="child-param-notice"
      className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>
        Anak yang dipilih tidak ditemukan di akun Anda. Menampilkan {selectedName}.
      </span>
    </p>
  );
}
