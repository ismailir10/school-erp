import { describe, it, expect } from "vitest";
import { readConflict } from "./conflict";

const res = (status: number, body?: unknown) => ({
  status,
  json: async () => {
    if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
    return body;
  },
});

describe("readConflict", () => {
  it("tells pay-first apart from a closed form", async () => {
    expect(await readConflict(res(409, { error: "PAYMENT_REQUIRED", message: "x" }))).toBe("PAYMENT_REQUIRED");
    expect(await readConflict(res(409, { error: "ALREADY_SUBMITTED" }))).toBe("ALREADY_SUBMITTED");
  });

  it("an unreadable or odd 409 body is the closed-form case, as before pay-first", async () => {
    expect(await readConflict(res(409))).toBe("ALREADY_SUBMITTED");
    expect(await readConflict(res(409, null))).toBe("ALREADY_SUBMITTED");
    expect(await readConflict(res(409, { error: 5 }))).toBe("ALREADY_SUBMITTED");
  });

  it("is null for every other status, without reading the body", async () => {
    for (const status of [200, 201, 400, 410, 422, 429, 500]) {
      expect(await readConflict({ status, json: () => Promise.reject(new Error("must not be read")) })).toBeNull();
    }
  });

  it("copes with a response object that has no body reader", async () => {
    expect(await readConflict({ status: 409 } as unknown as Response)).toBe("ALREADY_SUBMITTED");
  });
});
