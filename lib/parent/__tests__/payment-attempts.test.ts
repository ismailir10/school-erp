import { describe, expect, it } from "vitest";
import { paymentAttemptKey, readPaymentAttempt, writePaymentAttempt } from "../payment-attempts";

const hint = { version: 1, totalPaid: 3000, startedAt: 123, phase: "confirming" } as const;
const store = (value: string | null) => ({getItem: () => value, setItem: (_key: string, next: string) => {value = next;}, removeItem: () => {value = null;}});
describe("browser payment hints", () => {
  it.each(["null", "[]", "true", "broken", '{}', JSON.stringify({...hint,totalPaid:-1}), JSON.stringify({...hint,totalPaid:"3000"}), JSON.stringify({...hint,startedAt:"123"}), JSON.stringify({...hint,version:2}), JSON.stringify({...hint,phase:"PAID"})])("ignores unexpected browser data %s", value => {
    expect(readPaymentAttempt(store(value), "key")).toBeNull();
  });
  it("round-trips only a valid non-authoritative hint", () => {
    const storage = store(null);
    expect(writePaymentAttempt(storage, "key", hint)).toBe(true);
    expect(readPaymentAttempt(storage, "key")).toEqual(hint);
  });
  it("recognizes blocked or silently discarded storage", () => {
    expect(writePaymentAttempt(null, "key", hint)).toBe(false);
    expect(writePaymentAttempt({...store(null),setItem: () => {}}, "key", hint)).toBe(false);
  });
  it("has unambiguous exact tenant, guardian, child and invoice boundaries", () => {
    expect(paymentAttemptKey({tenantId:"a:b",guardianId:"c",childId:"d"}, "e"))
      .not.toBe(paymentAttemptKey({tenantId:"a",guardianId:"b:c",childId:"d"}, "e"));
  });
});
