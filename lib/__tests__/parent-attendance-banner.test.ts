import { describe, it, expect } from "vitest";
import { attendanceBannerState } from "@/lib/parent-attendance-banner";

describe("attendanceBannerState", () => {
  it("returns all-present when 5/5 hadir", () => {
    expect(
      attendanceBannerState({ hadir: 5, sakit: 0, alpa: 0, izin: 0, logged: 5 }),
    ).toEqual({ kind: "all-present" });
  });

  it("returns null when nothing logged", () => {
    expect(
      attendanceBannerState({ hadir: 0, sakit: 0, alpa: 0, izin: 0, logged: 0 }),
    ).toBeNull();
  });

  it("returns null when only PRESENT days short of full week", () => {
    expect(
      attendanceBannerState({ hadir: 3, sakit: 0, alpa: 0, izin: 0, logged: 3 }),
    ).toBeNull();
  });

  it("returns warm tone for SICK weeks", () => {
    expect(
      attendanceBannerState({ hadir: 3, sakit: 1, alpa: 0, izin: 0, logged: 4 }),
    ).toEqual({
      kind: "attention",
      tone: "warm",
      reason: "sick",
      alsoSick: true,
      line: "Hadir 3 · Sakit 1 · Alpa 0",
    });
  });

  it("returns warm tone for ABSENT weeks", () => {
    expect(
      attendanceBannerState({ hadir: 2, sakit: 0, alpa: 1, izin: 0, logged: 3 }),
    ).toEqual({
      kind: "attention",
      tone: "warm",
      reason: "absent",
      alsoSick: false,
      line: "Hadir 2 · Sakit 0 · Alpa 1",
    });
  });

  it("returns neutral tone for PERMISSION-only weeks (UAT MAJOR-02 fix)", () => {
    expect(
      attendanceBannerState({ hadir: 3, sakit: 0, alpa: 0, izin: 1, logged: 4 }),
    ).toEqual({
      kind: "attention",
      tone: "neutral",
      reason: "permission",
      alsoSick: false,
      line: "Hadir 3 · Sakit 0 · Alpa 0 · Izin 1",
    });
  });

  it("returns warm tone (not neutral) when SICK and PERMISSION mix", () => {
    const state = attendanceBannerState({
      hadir: 2,
      sakit: 1,
      alpa: 0,
      izin: 1,
      logged: 4,
    });
    expect(state).toEqual({
      kind: "attention",
      tone: "warm",
      reason: "sick",
      alsoSick: true,
      line: "Hadir 2 · Sakit 1 · Alpa 0 · Izin 1",
    });
  });

  it("leads with the absence when Alpa and Sakit share a week (PARX-4)", () => {
    expect(
      attendanceBannerState({ hadir: 1, sakit: 1, alpa: 1, izin: 0, logged: 3 }),
    ).toEqual({
      kind: "attention",
      tone: "warm",
      reason: "absent",
      alsoSick: true,
      line: "Hadir 1 · Sakit 1 · Alpa 1",
    });
  });

  it("keeps Alpa first when the week mixes Alpa, Sakit and Izin", () => {
    const state = attendanceBannerState({ hadir: 1, sakit: 1, alpa: 1, izin: 1, logged: 4 });
    expect(state).toMatchObject({ kind: "attention", reason: "absent", alsoSick: true });
  });
});
