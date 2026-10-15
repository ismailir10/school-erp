import { describe, it, expect } from "vitest";
import { denyTokenAccess } from "./access-response";

describe("denyTokenAccess: the public token routes' refusal ladder", () => {
  it.each([
    ["NOT_FOUND", 404, { error: "Not found" }],
    ["EXPIRED", 410, { error: "EXPIRED" }],
    ["SUBMITTED", 409, { error: "ALREADY_SUBMITTED" }],
  ] as const)("%s → %i", async (access, status, body) => {
    const res = denyTokenAccess(access);
    expect(res?.status).toBe(status);
    expect(await res?.json()).toEqual(body);
  });

  it("OK is let through", () => {
    expect(denyTokenAccess("OK")).toBeNull();
  });
});
