"use client";

import { useCallback, useEffect, useState } from "react";
import { hasPermission } from "@/lib/permissions";

/** UI affordances follow the same grants as the server; unknown sessions fail closed. */
export function usePermissions() {
  const [session, setSession] = useState<{ role: string; permissions?: string[] | null } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me").then(async (response) => {
      if (!response.ok) return;
      const value = await response.json();
      if (active && typeof value.role === "string") setSession(value);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return useCallback((permission: string) => session !== null && hasPermission(session, permission), [session]);
}

export function usePermission(permission: string) { return usePermissions()(permission); }
