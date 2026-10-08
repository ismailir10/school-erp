import { describe, expect, it } from "vitest";
import { childShortName } from "../child-name";

describe("childShortName", () => {
  it("prefers the nickname", () => {
    expect(childShortName({ name: "Ahmad Zafran Hakim", nickname: "Zafran" })).toBe("Zafran");
  });
  it("falls back to the first word of the legal name", () => {
    expect(childShortName({ name: "Ahmad Zafran Hakim", nickname: null })).toBe("Ahmad");
    expect(childShortName({ name: "  Ahmad  Zafran ", nickname: undefined })).toBe("Ahmad");
  });
  it("ignores a blank nickname", () => {
    expect(childShortName({ name: "Ahmad Zafran", nickname: "   " })).toBe("Ahmad");
  });
});
