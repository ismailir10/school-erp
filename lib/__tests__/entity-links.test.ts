import { describe, expect, it } from "vitest";
import { entityHref } from "@/lib/entity-links";

describe("entityHref", () => {
  it("builds admin and portal entity routes", () => {
    expect(entityHref.student("s1")).toBe("/admin/students/s1");
    expect(entityHref.guardian("p1")).toBe("/admin/guardians/p1");
    expect(entityHref.class("c1")).toBe("/admin/classes/c1");
    expect(entityHref.employee("e1")).toBe("/admin/employees/e1");
    expect(entityHref.invoice("i1")).toBe("/admin/invoices/i1");
    expect(entityHref.teacherStudentJournal("s1")).toBe("/teacher/student-journal/students/s1");
    expect(entityHref.parentChildProgress("k1")).toBe("/parent/perkembangan/k1");
  });
});
