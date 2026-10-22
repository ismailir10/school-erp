import { describe, it, expect } from "vitest";
import { bearerMatches } from "../bearer";

describe("bearerMatches", () => {
  it("accepts the exact bearer header", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(bearerMatches("Bearer s3creX", "s3cret")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cretX", "s3cret")).toBe(false);
  });

  it("rejects a missing header or a bare secret without the scheme", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches(undefined, "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });

  it("fails closed when the secret is unset or empty", () => {
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", null)).toBe(false);
  });
});
