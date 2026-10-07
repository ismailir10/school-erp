import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ isMobile: false, props: null as Record<string, unknown> | null }));

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    mocks.props = props;
    return null;
  },
}));

import { Toaster } from "../sonner";

beforeEach(() => {
  mocks.props = null;
});

describe("Toaster position (PARX-2)", () => {
  it("sits at the top on small screens so it never covers a dialog's Simpan or the bottom nav", () => {
    mocks.isMobile = true;
    render(<Toaster />);
    expect(mocks.props?.position).toBe("top-center");
    expect(JSON.stringify(mocks.props?.offset)).toContain("safe-area-inset-top");
    expect(JSON.stringify(mocks.props?.mobileOffset)).toContain("safe-area-inset-top");
  });

  it("keeps the desktop bottom-right position", () => {
    mocks.isMobile = false;
    render(<Toaster />);
    expect(mocks.props?.position).toBe("bottom-right");
    expect(mocks.props?.offset).toBeUndefined();
  });
});
