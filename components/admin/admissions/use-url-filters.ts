"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PAYMENT_UNPAID, parseTahap } from "./constants";

/**
 * The Pendaftaran list's filters live in the URL (`?tahap=`, `?payment=unpaid`, `?search=`,
 * `?page=`, plus the one-shot `?edit=`), so a dashboard link, a reload and the back button
 * all land on the same view. Reads come straight from `useSearchParams`; writes go through
 * `updateQuery`, which replaces the URL without adding history entries.
 *
 * The search box keeps its own text (`searchInput`) so typing is never overwritten by a URL
 * that is still catching up; it follows the URL only when the URL changes by some other
 * route (back/forward, a stat card, Atur Ulang).
 */
export function useUrlFilters(listPath: string) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tahap = parseTahap(searchParams?.get("tahap"));
  const unpaidOnly = searchParams?.get("payment") === PAYMENT_UNPAID;
  const search = searchParams?.get("search")?.trim() ?? "";
  const pageNumber = Math.max(1, Number.parseInt(searchParams?.get("page") ?? "1", 10) || 1);
  const editId = searchParams?.get("edit") ?? null;

  // Several URL patches can land in one tick (Atur Ulang clears a filter and the toggle):
  // build each from the latest pending params, not from the last rendered ones.
  const pendingParams = useRef(new URLSearchParams(searchParams?.toString() ?? ""));
  useEffect(() => {
    pendingParams.current = new URLSearchParams(searchParams?.toString() ?? "");
  }, [searchParams]);

  const updateQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(pendingParams.current.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      if (qs === pendingParams.current.toString()) return;
      pendingParams.current = next;
      router.replace(qs ? `${listPath}?${qs}` : listPath, { scroll: false });
    },
    [router, listPath],
  );

  const [searchInput, setSearchInput] = useState(search);
  // The last text this hook itself wrote to the URL, and the URL search last looked at. A URL
  // search that is neither (back/forward, a stat card, Atur Ulang) replaces what is in the box.
  const [written, setWritten] = useState(search);
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    if (search !== written) {
      setWritten(search);
      setSearchInput(search);
    }
  }

  /** The debounced search box: write the trimmed text to the URL and start from page 1. */
  const commitSearch = useCallback(
    (value: string) => {
      const next = value.trim();
      if (next === (pendingParams.current.get("search") ?? "")) return;
      setWritten(next);
      updateQuery({ search: next || null, page: null });
    },
    [updateQuery],
  );

  return { tahap, unpaidOnly, search, pageNumber, editId, updateQuery, searchInput, setSearchInput, commitSearch };
}
