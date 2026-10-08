import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ session: vi.fn(), family: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/parent-helpers", () => ({ getParentWithChildren: mocks.family }));
vi.mock("../logout-button", () => ({ LogoutButton: () => null }));
import ParentProfilePage from "../page";

beforeEach(() => {
  vi.stubEnv("SCHOOL_CONTACT_PHONE", "");
  mocks.session.mockResolvedValue({ role: "GUARDIAN", tenantId: "t", email: "ibu@example.com" });
  mocks.family.mockResolvedValue({
    parent: { id: "p", name: "Ibu Rina", phone: "0811", email: null },
    children: [{ studentId: "c1", studentName: "Alya", className: "KB A", programName: "KB" }],
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const render = async () => renderToStaticMarkup(await ParentProfilePage({ searchParams: Promise.resolve({}) }));

describe("parent profile - Hubungi sekolah (R2-P-17)", () => {
  it("offers WhatsApp and telephone links when the school phone is configured", async () => {
    vi.stubEnv("SCHOOL_CONTACT_PHONE", "0812-8877-4402");
    const html = await render();
    expect(html).toContain("Hubungi sekolah");
    expect(html).toContain('href="https://wa.me/6281288774402"');
    expect(html).toContain('href="tel:081288774402"');
  });

  it("without a configured phone still names a concrete next step and renders no dead links", async () => {
    const html = await render();
    expect(html).toContain("Hubungi sekolah");
    expect(html).toContain("Silakan hubungi bagian tata usaha sekolah.");
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("tel:");
  });
});
