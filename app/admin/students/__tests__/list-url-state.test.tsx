/**
 * ADM-4 — search, status filter and page live in the URL (?q=&status=&page=)
 * so Back from a student's detail page restores the same slice of the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentsPage from "@/app/admin/students/page";

const replace = vi.fn();
let currentSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const urls: string[] = [];
function stubFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    if (url.includes("/api/students/stats")) {
      return Promise.resolve({ ok: true, json: async () => ({ total: 0, active: 0, graduated: 0 }) } as Response);
    }
    if (url.includes("/api/students?")) {
      // Echo the requested page, like the real route.
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: [],
          pagination: { page, pageSize: 20, total: 100, totalPages: 5 },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("StudentsPage — list state in the URL (ADM-4)", () => {
  beforeEach(() => {
    urls.length = 0;
    replace.mockClear();
    currentSearch = "";
    try {
      sessionStorage.clear();
    } catch {
      /* jsdom always has it; belt and braces */
    }
    vi.stubGlobal("fetch", stubFetch());
  });

  it("restores search, status and page from the URL into the first fetch and the controls", async () => {
    currentSearch = "q=aisyah&status=WITHDRAWN&page=3";
    render(<StudentsPage />);

    await waitFor(() => expect(urls.some((u) => u.includes("/api/students?"))).toBe(true));
    const listUrl = urls.find((u) => u.includes("/api/students?"))!;
    const params = new URL(listUrl, "http://x").searchParams;
    expect(params.get("search")).toBe("aisyah");
    expect(params.get("status")).toBe("WITHDRAWN");
    expect(params.get("page")).toBe("3");

    expect(screen.getByPlaceholderText("Cari nama siswa...")).toHaveValue("aisyah");
    // Restoring the state must not rewrite the URL it already matches.
    expect(replace).not.toHaveBeenCalled();
    // The toolbar's mount-time search echo (300 ms) must not reset the page.
    await new Promise((r) => setTimeout(r, 450));
    expect(urls.filter((u) => u.includes("/api/students?")).every((u) => new URL(u, "http://x").searchParams.get("page") === "3")).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("typing a search writes ?q= with router.replace (debounced) and resets the page", async () => {
    currentSearch = "page=3";
    const user = userEvent.setup();
    render(<StudentsPage />);

    await user.type(screen.getByPlaceholderText("Cari nama siswa..."), "budi");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/students?q=budi", { scroll: false }));
    // One write for the settled value, not one per keystroke.
    expect(replace.mock.calls.every(([href]) => href === "/admin/students?q=budi")).toBe(true);
    expect(sessionStorage.getItem("admin.students.listQuery")).toBe("q=budi");
  });

  it("falls back to the defaults for an unknown status or a junk page", async () => {
    currentSearch = "status=bogus&page=abc";
    render(<StudentsPage />);

    await waitFor(() => expect(urls.some((u) => u.includes("/api/students?"))).toBe(true));
    const params = new URL(urls.find((u) => u.includes("/api/students?"))!, "http://x").searchParams;
    expect(params.get("status")).toBeNull();
    expect(params.get("page")).toBe("1");
  });
});
