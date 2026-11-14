import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicesClient } from "../invoices-client";
import { INVOICE_LIST_QUERY_KEY } from "@/components/admin/invoices/list-query";

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
const capabilities = { create: true, recordPayment: true, void: true };
const urls: string[] = [];
let rows: Record<string, unknown>[] = [];
function renderList() {
  return render(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
}
const paramsOfLastList = () => new URL(urls.filter(url => url.startsWith("/api/invoices?")).at(-1)!, "http://localhost").searchParams;

beforeEach(() => {
  urls.length = 0;
  rows = [];
  nav.query = "";
  nav.replace.mockClear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/invoices?")) {
      const query = new URL(url, "http://localhost").searchParams;
      return { ok: true, json: async () => ({ data: rows, pagination: { page: Number(query.get("page")), pageSize: Number(query.get("pageSize")), total: 100, totalPages: 5 } }) };
    }
    if (url.startsWith("/api/invoices/stats")) return { ok: true, json: async () => ({ total: 100, owing: 10, paid: 90, overdue: 2, unpaidWithoutLink: 0, pendingPaymentLink: 0, needsReview: 0 }) };
    return { ok: true, json: async () => ({ data: [] }) };
  }));
});

describe("Invoice list return context", () => {
  it("restores initial search/status/page and keeps mount echoes from resetting the page", async () => {
    nav.query = "q=Aisyah&status=PAID&page=3&billingRun=keep-me";
    renderList();
    await waitFor(() => expect(paramsOfLastList().get("page")).toBe("3"));
    expect(paramsOfLastList().get("search")).toBe("Aisyah");
    expect(paramsOfLastList().get("status")).toBe("PAID");
    expect(screen.getByPlaceholderText("Cari siswa atau nomor tagihan...")).toHaveValue("Aisyah");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(paramsOfLastList().get("page")).toBe("3");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(INVOICE_LIST_QUERY_KEY)).toBe(nav.query);
  });

  it("debounces search, resets its page, and preserves unrelated billing parameters", async () => {
    nav.query = "status=PAID&page=3&billingRun=keep-me";
    renderList();
    fireEvent.change(screen.getByPlaceholderText("Cari siswa atau nomor tagihan..."), { target: { value: "Bilal" } });
    expect(nav.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    const [href, options] = nav.replace.mock.calls[0];
    const query = new URL(href, "http://localhost").searchParams;
    expect(query.get("q")).toBe("Bilal");
    expect(query.get("status")).toBe("PAID");
    expect(query.get("billingRun")).toBe("keep-me");
    expect(query.has("page")).toBe(false);
    expect(options).toEqual({ scroll: false });
    expect(paramsOfLastList().get("page")).toBe("1");
  });

  it("restores browser-back query changes and discards the old pending search debounce", async () => {
    nav.query = "q=Aisyah&status=PAID&page=3";
    const { rerender } = renderList();
    await waitFor(() => expect(paramsOfLastList().get("search")).toBe("Aisyah"));
    fireEvent.change(screen.getByPlaceholderText("Cari siswa atau nomor tagihan..."), { target: { value: "Unsaved search" } });
    nav.query = "q=Bilal&status=UNPAID&page=2";
    rerender(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
    await waitFor(() => expect(paramsOfLastList().get("search")).toBe("Bilal"));
    expect(paramsOfLastList().get("status")).toBe("UNPAID");
    expect(paramsOfLastList().get("page")).toBe("2");
    expect(screen.getByPlaceholderText("Cari siswa atau nomor tagihan...")).toHaveValue("Bilal");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("filter change resets page and preserves search and unrelated params", async () => {
    nav.query = "q=Aisyah&status=PAID&page=3&billingRun=keep-me";
    renderList();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Filter Status" }));
    await user.click(await screen.findByRole("option", { name: /Belum lunas/ }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    const query = new URL(nav.replace.mock.calls.at(-1)![0], "http://localhost").searchParams;
    expect(query.get("status")).toBe("UNPAID");
    expect(query.get("q")).toBe("Aisyah");
    expect(query.get("billingRun")).toBe("keep-me");
    expect(query.has("page")).toBe(false);
  });

  it("does not overwrite newly typed text when its own preceding URL update arrives", async () => {
    const { rerender } = renderList();
    const input = screen.getByPlaceholderText("Cari siswa atau nomor tagihan...");
    fireEvent.change(input, { target: { value: "Ali" } });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "Alina" } });
    nav.query = "q=Ali";
    rerender(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
    expect(input).toHaveValue("Alina");
    await waitFor(() => expect(nav.replace).toHaveBeenLastCalledWith("/admin/invoices?q=Alina", { scroll: false }));
  });
});


it("restores the visible sort direction and next click after browser Back", async () => {
  rows = [{ id: "inv1", invoiceNumber: "INV-1", periodLabel: "November", dueDate: "2026-11-30", createdAt: "2026-11-01", totalDue: 5000, totalPaid: 0, status: "SENT", studentId: "s1", student: { name: "Aisyah" }, _count: { payments: 0 } }];
  nav.query = "sortBy=createdAt&sortOrder=asc";
  const { rerender } = renderList();
  const first = await screen.findByRole("button", { name: "Dibuat" });
  expect(first.querySelector(".lucide-arrow-up")).not.toBeNull();
  nav.query = "sortBy=createdAt&sortOrder=desc&page=2";
  rerender(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
  const restored = await screen.findByRole("button", { name: "Dibuat" });
  expect(restored.querySelector(".lucide-arrow-down")).not.toBeNull();
  expect(paramsOfLastList().get("sortBy")).toBe("createdAt");
  expect(paramsOfLastList().get("page")).toBe("2");
  fireEvent.click(restored);
  await waitFor(() => expect(paramsOfLastList().get("sortOrder")).toBe("asc"));
  expect(paramsOfLastList().get("page")).toBe("1");
});

it("does not mistake an earlier in-flight own replacement for browser Back", async () => {
  const { rerender } = renderList();
  fireEvent.change(screen.getByPlaceholderText("Cari siswa atau nomor tagihan..."), { target: { value: "Ali" } });
  await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Filter Status" }));
  await user.click(await screen.findByRole("option", { name: /^Lunas/ }));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(2));
  nav.query = "q=Ali";
  rerender(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
  expect(screen.getByRole("combobox", { name: "Filter Status" })).toHaveTextContent("Lunas");
  expect(paramsOfLastList().get("status")).toBe("PAID");
  expect(sessionStorage.getItem(INVOICE_LIST_QUERY_KEY)).toContain("status=PAID");
  nav.query = "q=Ali&status=PAID";
  rerender(<InvoicesClient gatewayId="doku" capabilities={capabilities} />);
  expect(screen.getByRole("combobox", { name: "Filter Status" })).toHaveTextContent("Lunas");
  expect(nav.replace).toHaveBeenCalledTimes(2);
});
