import { describe, expect, it } from "vitest";
import { mergeDraft } from "./draft-merge";
describe("draft three-way merge", () => {
  it("preserves untouched concurrent leaves and signed evidence", () => {
    expect(mergeDraft({ ayah: { phone: "", name: "A" } }, { ayah: { phone: "", name: "New" } }, { ayah: { phone: "saved", name: "A", signatureToken: "token", signedAt: "today" } })).toEqual({ ayah: { phone: "saved", name: "New", signatureToken: "token", signedAt: "today" } });
  });
  it("allows missing initial optional values and explicit clear", () => {
    expect(mergeDraft({ phone: "" }, { phone: "123" }, {})).toEqual({ phone: "123" });
    expect(mergeDraft({ programId: "" }, { programId: "p" }, { programId: null })).toEqual({ programId: "p" });
    expect(mergeDraft({ phone: "123" }, { phone: "" }, { phone: "123" })).toEqual({ phone: "" });
  });
  it("clears a parent's waiver explicitly without erasing a concurrent unchanged waiver", () => {
    expect(mergeDraft({ onlyParent: "ibu" }, { onlyParent: null }, { onlyParent: "ibu" })).toEqual({ onlyParent: null });
    expect(mergeDraft({ onlyParent: null }, { onlyParent: null }, { onlyParent: "ibu" })).toEqual({ onlyParent: "ibu" });
  });
  it("rejects conflicting array or primitive edits but permits retries", () => {
    expect(() => mergeDraft({ phone: "old" }, { phone: "mine" }, { phone: "theirs" })).toThrow("DRAFT_CONFLICT");
    expect(mergeDraft({ phone: "old" }, { phone: "mine" }, { phone: "mine" })).toEqual({ phone: "mine" });
  });
});
