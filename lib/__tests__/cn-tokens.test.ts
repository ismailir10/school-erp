import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// Theme tokens must merge as their own group, not as colours (see lib/utils.ts).
describe("cn with theme tokens", () => {
  it("keeps a colour next to a size token", () => {
    expect(cn("text-caption", "text-muted-foreground")).toBe("text-caption text-muted-foreground");
    expect(cn("text-h2 text-foreground")).toBe("text-h2 text-foreground");
  });

  it("lets a later size token replace an earlier one", () => {
    expect(cn("text-sm", "text-body")).toBe("text-body");
    expect(cn("text-h2", "text-h1")).toBe("text-h1");
  });

  it("merges shadow and z-index tokens with the defaults", () => {
    expect(cn("shadow-sm", "shadow-raised")).toBe("shadow-raised");
    expect(cn("z-10", "z-sticky")).toBe("z-sticky");
    expect(cn("shadow-raised", "shadow-primary/20")).toBe("shadow-raised shadow-primary/20");
  });
});
