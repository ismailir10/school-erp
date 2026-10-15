import { describe, it, expect } from "vitest";
import { isFeeClosed } from "./fee-closed";

describe("isFeeClosed", () => {
  it.each([
    ["rejected", { status: "REJECTED" }],
    ["rejected, lead still open", { status: "REJECTED", admission: { status: "INQUIRY" } }],
    ["the lead was cancelled (form still INVITED)", { status: "INVITED", admission: { status: "CANCELLED" } }],
    ["the lead was cancelled (form submitted)", { status: "SUBMITTED", admission: { status: "CANCELLED" } }],
  ])("closed when %s", (_n, app) => {
    expect(isFeeClosed(app)).toBe(true);
  });

  it.each([
    ["INVITED, lead open", { status: "INVITED", admission: { status: "INQUIRY" } }],
    ["SUBMITTED, lead open", { status: "SUBMITTED", admission: { status: "ADMITTED" } }],
    ["no lead loaded", { status: "SUBMITTED" }],
    ["no lead at all", { status: "INVITED", admission: null }],
  ])("open when %s", (_n, app) => {
    expect(isFeeClosed(app)).toBe(false);
  });
});
