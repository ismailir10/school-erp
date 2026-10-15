/**
 * The formulir list is retired (cycle 2026-10-11-pendaftaran-simplify): /admin/enrollments
 * redirects to the unified Pendaftaran list, carrying over the filters old links held.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

import EnrollmentsRedirectPage from "@/app/admin/enrollments/page";

async function land(params: Record<string, string | string[] | undefined> = {}): Promise<string> {
  await expect(EnrollmentsRedirectPage({ searchParams: Promise.resolve(params) })).rejects.toThrow(/^NEXT_REDIRECT:/);
  return redirect.mock.calls.at(-1)![0];
}

describe("/admin/enrollments redirect", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("goes to the unified list", async () => {
    expect(await land()).toBe("/admin/admissions");
  });

  it("keeps a bookmarked unpaid view", async () => {
    expect(await land({ payment: "unpaid" })).toBe("/admin/admissions?payment=unpaid");
  });

  it.each([
    ["INVITED", "FORMULIR_DIKIRIM"],
    ["SUBMITTED", "FORMULIR_MASUK"],
    ["UNDER_REVIEW", "FORMULIR_MASUK"],
    ["ACCEPTED", "DITERIMA"],
    ["REJECTED", "DITOLAK"],
  ])("maps the old status %s to the Tahap %s", async (status, tahap) => {
    expect(await land({ status })).toBe(`/admin/admissions?tahap=${tahap}`);
  });

  it("combines status, payment and search", async () => {
    const url = await land({ status: "SUBMITTED", payment: "unpaid", search: " Aisyah " });
    const q = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/admin/admissions?")).toBe(true);
    expect(q.get("tahap")).toBe("FORMULIR_MASUK");
    expect(q.get("payment")).toBe("unpaid");
    expect(q.get("search")).toBe("Aisyah");
  });

  it("drops filters the new list has no place for, rather than guessing", async () => {
    expect(await land({ status: "WHATEVER", payment: "paid", page: "4" })).toBe("/admin/admissions");
  });

  it("reads the first value of a repeated param", async () => {
    expect(await land({ status: ["ACCEPTED", "REJECTED"] })).toBe("/admin/admissions?tahap=DITERIMA");
  });
});
