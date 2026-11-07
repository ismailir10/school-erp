import { describe, it, expect } from "vitest";
import { applyAllArrived, applyAllPickedUp, type BulkRow } from "../bulk";

const NOW = "2026-11-07T01:00:00.000Z";
const EARLIER = "2026-11-07T00:10:00.000Z";

const row = (p: Partial<BulkRow>): BulkRow => ({
  status: "PRESENT",
  checkInTime: null,
  checkOutTime: null,
  pickedUpByRelation: null,
  pickedUpByName: null,
  ...p,
});

describe("applyAllArrived", () => {
  it("stamps present children without an arrival", () => {
    const { rows, changed } = applyAllArrived([row({})], NOW);
    expect(changed).toBe(1);
    expect(rows[0].checkInTime).toBe(NOW);
  });

  it("never overwrites exceptions or existing times", () => {
    const input = [
      row({ status: "SICK" }),
      row({ status: "ABSENT" }),
      row({ status: "PERMISSION" }),
      row({ checkInTime: EARLIER }),
    ];
    const { rows, changed } = applyAllArrived(input, NOW);
    expect(changed).toBe(0);
    expect(rows).toEqual(input);
  });

  it("does not mutate its input", () => {
    const input = [row({})];
    applyAllArrived(input, NOW);
    expect(input[0].checkInTime).toBeNull();
  });
});

describe("applyAllPickedUp", () => {
  it("sets pickup time and defaults the relation to PARENT", () => {
    const { rows, changed } = applyAllPickedUp([row({ checkInTime: EARLIER })], NOW);
    expect(changed).toBe(1);
    expect(rows[0]).toMatchObject({
      checkOutTime: NOW,
      pickedUpByRelation: "PARENT",
      checkInTime: EARLIER,
    });
  });

  it("keeps an already chosen relation but skips picked-up and non-present rows", () => {
    const picked = row({ checkOutTime: EARLIER, pickedUpByRelation: "DRIVER" });
    const sick = row({ status: "SICK" });
    const { rows, changed } = applyAllPickedUp(
      [picked, sick, row({ pickedUpByRelation: "SIBLING" })],
      NOW,
    );
    expect(changed).toBe(1);
    expect(rows[0]).toEqual(picked);
    expect(rows[1]).toEqual(sick);
    expect(rows[2].pickedUpByRelation).toBe("SIBLING");
  });
});
