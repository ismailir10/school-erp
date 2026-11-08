import { describe, expect, it } from "vitest";
import { legacyCenterFromSlug } from "../legacy-slug";

describe("legacyCenterFromSlug", () => {
  it("maps old lowercase enum slugs", () => {
    expect(legacyCenterFromSlug("worship")).toBe("WORSHIP");
    expect(legacyCenterFromSlug("natural_materials")).toBe("NATURAL_MATERIALS");
  });
  it("leaves sentra ids and uppercase values alone", () => {
    expect(legacyCenterFromSlug("clx1abc")).toBeNull();
    expect(legacyCenterFromSlug("WORSHIP")).toBeNull();
    expect(legacyCenterFromSlug("")).toBeNull();
  });
});
