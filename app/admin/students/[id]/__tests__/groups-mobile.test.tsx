/**
 * Phone defaults for the student page. `useIsMobile` is mocked rather than the
 * window resized (same reason as the wali page's phone suite).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import StudentDetailPage from "@/app/admin/students/[id]/page";
import { ResizeObserverStub, stubFetch } from "./student-fixture";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/admin/class-section-picker", () => ({
  ClassSectionCombobox: () => <select aria-label="kelas stub" />,
}));

describe("student page — phone defaults", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("opens only Profil; the other four groups are closed", async () => {
    vi.stubGlobal("fetch", stubFetch().fn);
    render(<StudentDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Aisyah Putri" });

    const ids = ["group-profil", "group-keluarga", "group-kelas", "group-keuangan", "group-catatan"];
    await vi.waitFor(() =>
      expect(
        ids.map((id) => document.querySelector(`[aria-controls="${id}-content"]`)?.getAttribute("aria-expanded")),
      ).toEqual(["true", "false", "false", "false", "false"]),
    );
  });
});
