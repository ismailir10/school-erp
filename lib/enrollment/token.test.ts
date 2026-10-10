import { describe, it, expect } from "vitest";
import { generateAccessToken, isTokenShape } from "./token";

describe("isTokenShape", () => {
  it("accepts every token the generator can produce", () => {
    for (let i = 0; i < 50; i++) expect(isTokenShape(generateAccessToken())).toBe(true);
  });

  it("accepts any URL-safe string up to 128 characters", () => {
    expect(isTokenShape("tok")).toBe(true);
    expect(isTokenShape("a".repeat(128))).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["129 characters", "a".repeat(129)],
    ["a space", "tok en"],
    ["a slash", "a/b"],
    ["a dot segment", ".."],
    ["a percent escape", "%2e%2e"],
    ["a newline", "tok\n"],
    ["non-ascii", "tokén"],
  ])("rejects %s", (_name, value) => {
    expect(isTokenShape(value)).toBe(false);
  });
});
