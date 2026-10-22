import { describe, it, expect, vi, afterEach } from "vitest";
import { isDemoAuthEnabled } from "../demo-mode";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isDemoAuthEnabled", () => {
  it("is off without DEMO_MODE", () => {
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("VERCEL", "");
    expect(isDemoAuthEnabled()).toBe(false);
  });

  it("is on for DEMO_MODE=true off Vercel (local dev, local Playwright, CI)", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL", "");
    expect(isDemoAuthEnabled()).toBe(true);
  });

  it("is refused on Vercel even with DEMO_MODE=true", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL", "1");
    expect(isDemoAuthEnabled()).toBe(false);
    expect(err).toHaveBeenCalled();
  });
});
