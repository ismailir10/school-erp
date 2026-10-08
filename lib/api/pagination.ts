/**
 * Shared pagination utility for all GET list API routes.
 *
 * Usage in API route:
 *   const { skip, take, page, pageSize } = parsePagination(searchParams);
 *   const sort = parseSort(searchParams, { allow: ["name", "createdAt"], default: "name", defaultOrder: "asc" });
 *   if (sort instanceof Response) return sort; // 400 on unknown key
 *   const [data, total] = await Promise.all([
 *     prisma.model.findMany({ skip, take, where, orderBy: sort.orderBy }),
 *     prisma.model.count({ where }),
 *   ]);
 *   return NextResponse.json(paginatedResponse(data, total, page, pageSize));
 */

import { NextResponse } from "next/server";
import { stripControlChars } from "@/lib/validations/text";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
/** Past this the skip offset is meaningless (and `99999999999999999999` overflows Int). */
const MAX_PAGE = 10_000;
/** Longest search term any list route needs; keeps `ILIKE` patterns bounded. */
export const MAX_SEARCH_LENGTH = 100;

/**
 * Parse a numeric query param defensively: absent / blank / non-numeric /
 * non-finite falls back to `fallback`, otherwise the value is truncated to an
 * integer. `?page=abc` and `?page=99999999999999999999` used to yield NaN or a
 * value past Int range, which Prisma turned into a 500 on every list route.
 */
function intParam(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function parsePagination(searchParams: URLSearchParams): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.min(MAX_PAGE, Math.max(1, intParam(searchParams.get("page"), 1)));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, intParam(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE))
  );
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip, take: pageSize };
}

/**
 * Sanitise a free-text `?search=` term before it reaches Prisma: strips NUL and
 * other control characters (a NUL byte is a Postgres 500), trims, and caps the
 * length. Returns `""` when nothing usable is left, so callers can keep their
 * existing `if (search)` guard.
 *
 *   const search = cleanSearch(searchParams.get("search"));
 *   if (search) where.OR = [{ name: { contains: search, mode: "insensitive" } }];
 */
export function cleanSearch(raw: string | null | undefined): string {
  if (!raw) return "";
  // Code-point aware cap so an emoji is never cut in half.
  return Array.from(stripControlChars(raw).trim()).slice(0, MAX_SEARCH_LENGTH).join("");
}

/**
 * Escape LIKE/ILIKE wildcards (`\`, `%`, `_`) so a user-typed term is matched
 * literally. Prisma's `contains` / `startsWith` / `endsWith` pass the value
 * straight into the pattern, so searching "%" used to match every row.
 * Postgres' default LIKE escape character is the backslash. Apply it only where
 * the term feeds those Prisma string filters (not equality, not raw SQL that
 * does its own escaping); `cleanSearch` stays pure on purpose.
 *
 *   const search = escapeLike(cleanSearch(searchParams.get("search")));
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export type ParseSortOptions = {
  /** Whitelist of accepted sort keys. Unknown keys → 400 response. */
  allow: readonly string[];
  /** Default sort key when `sortBy` query param is absent. Must be in `allow`. */
  default: string;
  /** Default sort order when `sortOrder` absent. */
  defaultOrder?: "asc" | "desc";
};

/**
 * Parse `sortBy` + `sortOrder` query params against an explicit allowlist.
 *
 * Returns either `{ orderBy }` for Prisma, or a `NextResponse` 400 if the
 * caller passed an unknown sort key or invalid direction. The allowlist
 * prevents Prisma from throwing P2009 (which leaks `select` field names
 * from the schema into 500 responses).
 */
export function parseSort(
  searchParams: URLSearchParams,
  options: ParseSortOptions
): { orderBy: Record<string, "asc" | "desc"> } | NextResponse {
  const allowSet = new Set(options.allow);
  if (!allowSet.has(options.default)) {
    // Programmer error — surface loudly during dev/test.
    throw new Error(
      `parseSort: default key "${options.default}" not in allow list [${options.allow.join(", ")}]`
    );
  }

  const sortByRaw = searchParams.get("sortBy");
  const sortBy = sortByRaw ?? options.default;
  if (sortByRaw !== null && !allowSet.has(sortByRaw)) {
    return NextResponse.json(
      { error: `Invalid sort field: ${sortByRaw}` },
      { status: 400 }
    );
  }

  const sortOrderRaw = searchParams.get("sortOrder");
  const sortOrder = sortOrderRaw ?? options.defaultOrder ?? "desc";
  if (sortOrderRaw !== null && sortOrderRaw !== "asc" && sortOrderRaw !== "desc") {
    return NextResponse.json(
      { error: `Invalid sort order: ${sortOrderRaw}` },
      { status: 400 }
    );
  }

  return { orderBy: { [sortBy]: sortOrder as "asc" | "desc" } };
}
