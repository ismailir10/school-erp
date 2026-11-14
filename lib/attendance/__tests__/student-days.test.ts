import { describe, expect, it } from "vitest";
import { studentDays } from "../student-days";
const row = (status: string, sessionId: string | null = "morning", classSectionId?: string) => ({ studentId: "s1", date: "2026-11-13", sessionId, status, classSectionId });
describe("school date attendance", () => {
  it("counts primary plus two sessions once and gives the explicit daily mark precedence", () => {
    const rows = [row("PRESENT"), row("PRESENT", "afternoon"), row("SICK", null)];
    expect(studentDays(rows).map(r => r.status)).toEqual(["SICK"]);
    expect(studentDays([...rows].reverse()).map(r => r.status)).toEqual(["SICK"]);
  });
  it("counts session-only sick days once and treats partial-day presence as present", () => {
    expect(studentDays([row("SICK"), row("SICK", "afternoon")])).toHaveLength(1);
    expect(studentDays([row("ABSENT"), row("PRESENT", "afternoon")])[0].status).toBe("PRESENT");
  });
  it("retains separate monthly roster placements", () => {
    expect(studentDays([row("SICK", null, "school"), row("PRESENT", null, "daycare")])).toHaveLength(2);
  });
});
