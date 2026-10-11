/**
 * Shared fixtures for the Pendaftaran list tests: a tiny in-memory URL (so the page's
 * `router.replace` and `useSearchParams` stay in step like they do in Next), a lead row
 * in the list contract's shape, and a fetch stub that records every list read.
 */
import { vi } from "vitest";

const listeners = new Set<() => void>();
let current = new URLSearchParams();

export const navStore = {
  /** Start a test on this query string (no leading "?"). */
  reset(query = "") {
    current = new URLSearchParams(query);
    navStore.replace.mockClear();
  },
  params: () => current,
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  replace: vi.fn((url: string) => {
    current = new URLSearchParams(url.split("?")[1] ?? "");
    listeners.forEach((fn) => fn());
  }),
};

/** `vi.mock("next/navigation", () => navigationMock())` */
export async function navigationMock() {
  const React = await import("react");
  const router = { replace: navStore.replace, push: navStore.replace };
  return {
    usePathname: () => "/admin/admissions",
    useRouter: () => router,
    useSearchParams: () => React.useSyncExternalStore(navStore.subscribe, navStore.get, navStore.get),
  };
}

export function leadRow(over: Record<string, unknown> = {}) {
  return {
    id: "a1", childName: "Aisyah", childAge: null, dateOfBirth: null, childGender: null,
    parentName: "Dewi Sartika", parentPhone: null, parentWhatsapp: null, parentEmail: null,
    parentRelationship: null, programId: null, source: "WHATSAPP", notes: null, status: "INQUIRY",
    studentId: null, createdAt: "2026-10-01T00:00:00.000Z", program: null, detectedParent: null,
    stage: "BARU", payment: "NONE", application: null,
    ...over,
  };
}

export function formulir(over: Record<string, unknown> = {}) {
  return {
    id: "ea-1", status: "INVITED", programId: "prog-1", programName: "KB", dcareAddon: false, studentId: null,
    submittedAt: null, fee: null,
    ...over,
  };
}

export const STATS = { total: 12, baru: 5, formulirDikirim: 3, menungguBayar: 2, belumBayar: 4, formulirMasuk: 1, diterima: 0, siswa: 1 };

export const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

type Extra = (url: string, init?: RequestInit) => Response | undefined;

export type ServeOptions = {
  canEdit?: boolean;
  /** null = a response without stats. */
  stats?: typeof STATS | null;
  extra?: Extra;
};

/** Answers the list read (GET /api/admissions?...) with `rows`; `extra` gets first pick of every call. */
export function serveList(rows: unknown[], { canEdit = true, stats = STATS, extra }: ServeOptions = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const custom = extra?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.startsWith("/api/admissions?") && (!init?.method || init.method === "GET")) {
      return Promise.resolve(
        reply({
          data: rows,
          pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 },
          canEdit,
          ...(stats ? { stats } : {}),
        }),
      );
    }
    return Promise.resolve(reply([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The query of every list read so far, as URLSearchParams. */
export function listReads(fetchMock: ReturnType<typeof serveList>): URLSearchParams[] {
  return fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith("/api/admissions?"))
    .map((u) => new URLSearchParams(u.split("?")[1]));
}
