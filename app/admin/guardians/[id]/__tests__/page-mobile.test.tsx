/**
 * Phone defaults for the wali page. `useIsMobile` is mocked rather than the
 * window resized: with `innerWidth` at 390 the `use(params)` helper used by
 * these page tests suspends the whole tree in jsdom.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

import GuardianDetailPage from "../page";
import { fulfilledParams, makeParent, stubFetchWith } from "./parent-fixture";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));

describe("guardian page — phone defaults", () => {
  it("keeps children and invoices open, collapses Data Wali and Dokumen", async () => {
    stubFetchWith(makeParent());
    render(<GuardianDetailPage params={fulfilledParams({ id: "p1" })} />);
    await screen.findByRole("heading", { name: "Ibu Siti Aminah" });

    expect(screen.getByText("Ahmad Fajar")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.queryByText("siti@example.test")).not.toBeInTheDocument();
    expect(within(document.getElementById("profile")!).getByText("Lengkap")).toBeInTheDocument();
    expect(within(document.getElementById("documents")!).getByText("KTP ada · KK belum ada")).toBeInTheDocument();
    // Contact stays in the header on a phone.
    expect(screen.getByRole("link", { name: "WhatsApp" })).toBeInTheDocument();
  });
});
