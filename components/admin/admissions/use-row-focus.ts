"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Puts keyboard focus back on a row after a dialog opened from it closes. The table is a
 * skeleton while it reloads, so when the dialog changed something (`focusWhenLoaded`) the
 * return waits until the rows are back (`loading` false); otherwise (`focusRow`) it is immediate.
 * A row that is gone falls back to the page heading.
 */
export function useRowFocus(loading: boolean) {
  const pending = useRef<string | null>(null);

  const focusRow = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const target =
        document.querySelector<HTMLElement>(`[data-admission-menu="${id}"]`) ??
        document.querySelector<HTMLElement>(`[data-admission-primary="${id}"]`) ??
        document.querySelector<HTMLElement>("h1");
      if (target && target.tagName === "H1" && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target?.focus();
    });
  }, []);

  const focusWhenLoaded = useCallback((id: string) => {
    pending.current = id;
  }, []);

  useEffect(() => {
    if (loading || !pending.current) return;
    const id = pending.current;
    pending.current = null;
    focusRow(id);
  }, [loading, focusRow]);

  return { focusRow, focusWhenLoaded };
}
