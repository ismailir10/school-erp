"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAYMENT_UNPAID } from "./constants";
import type { Admission, AdmissionStats } from "./types";

export type AdmissionPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

/** The list response carries either a `pagination` block or flat `total/page/pageSize`; read both. */
function readPagination(json: Record<string, unknown>, rows: number, fallback: AdmissionPagination): AdmissionPagination {
  const block = json.pagination as AdmissionPagination | undefined;
  if (block && typeof block.total === "number") return block;
  const total = typeof json.total === "number" ? json.total : rows;
  const page = typeof json.page === "number" ? json.page : fallback.page;
  const pageSize = typeof json.pageSize === "number" ? json.pageSize : fallback.pageSize;
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

type Options = {
  pageNumber: number;
  search: string;
  tahap: string;
  unpaidOnly: boolean;
  /** The page asked for is past the end (rows were removed since): here is the last page that has rows. */
  onPageOutOfRange: (lastPage: number) => void;
};

/**
 * Reads `GET /api/admissions` for the current filters. One request carries the rows, `canEdit`
 * and the stat counts. The newest request wins; a failed read keeps the last rows so the screen
 * can say so beside them.
 */
export function useAdmissionList({ pageNumber, search, tahap, unpaidOnly, onPageOutOfRange }: Options) {
  const [data, setData] = useState<Admission[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [pagination, setPagination] = useState<AdmissionPagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [stats, setStats] = useState<AdmissionStats | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  // The query string of the last successful read, so a deep link waits for the rows it needs.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const requestId = useRef(0);
  const outOfRange = useRef(onPageOutOfRange);
  useEffect(() => {
    outOfRange.current = onPageOutOfRange;
  }, [onPageOutOfRange]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(pageNumber),
      pageSize: String(pageSize),
      sortBy,
      sortOrder,
      // The same sort under the names the list contract documents.
      sort: sortBy,
      order: sortOrder,
    });
    if (search) params.set("search", search);
    if (tahap !== "all") params.set("tahap", tahap);
    if (unpaidOnly) params.set("payment", PAYMENT_UNPAID);
    return params.toString();
  }, [pageNumber, pageSize, sortBy, sortOrder, search, tahap, unpaidOnly]);

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    let moving = false;
    try {
      const res = await fetch(`/api/admissions?${query}`);
      if (!res.ok) throw new Error("Admissions read failed");
      const json = (await res.json()) as Record<string, unknown>;
      if (id !== requestId.current) return;
      const rows = Array.isArray(json.data) ? (json.data as Admission[]) : [];
      const next = readPagination(json, rows.length, { page: pageNumber, pageSize, total: 0, totalPages: 0 });
      // Rows were removed since this page was opened: go to the last page that has rows rather than
      // telling staff the list is empty. The new query reads again; keep the skeleton until then.
      const lastPage = Math.max(1, Math.ceil(next.total / next.pageSize));
      if (rows.length === 0 && next.total > 0 && lastPage < pageNumber) {
        moving = true;
        outOfRange.current(lastPage);
        return;
      }
      setData(rows);
      setCanEdit(json.canEdit === true);
      setStats((json.stats as AdmissionStats | undefined) ?? null);
      setPagination(next);
      setLoadedQuery(query);
    } catch {
      if (id === requestId.current) setLoadError(true);
    } finally {
      if (id === requestId.current && !moving) setLoading(false);
    }
  }, [query, pageNumber, pageSize]);

  useEffect(() => {
    void refetch();
    return () => {
      requestId.current += 1;
    };
  }, [refetch]);

  const setSort = useCallback((field: string, order: "asc" | "desc") => {
    setSortBy(field);
    setSortOrder(order);
  }, []);

  return { data, canEdit, stats, pagination, loading, loadError, loadedQuery, query, refetch, setPageSize, sortBy, sortOrder, setSort };
}
