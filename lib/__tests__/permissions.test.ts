import { describe, it, expect } from "vitest";
import {
  hasPermission,
  getSystemRolePermissions,
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
} from "@/lib/permissions";

/**
 * Task 2: Permission table — hr.view, SCHOOL_ADMIN non-HR defaults, SUPER_ADMIN
 * owner escape hatch. Covers hasPermission() and getSystemRolePermissions()
 * contract changes.
 */

describe("hasPermission", () => {
  it("SUPER_ADMIN with empty permissions → true for anything (owner escape hatch)", () => {
    expect(
      hasPermission(
        { role: "SUPER_ADMIN", permissions: [] },
        "anything.whatever",
      ),
    ).toBe(true);
    expect(
      hasPermission(
        { role: "SUPER_ADMIN", permissions: [] },
        "payroll.approve",
      ),
    ).toBe(true);
  });

  it("SCHOOL_ADMIN with no permissions key → false (short-circuit removed)", () => {
    expect(
      hasPermission({ role: "SCHOOL_ADMIN" }, "students.view"),
    ).toBe(false);
    expect(
      hasPermission({ role: "SCHOOL_ADMIN", permissions: null }, "students.view"),
    ).toBe(false);
  });

  it("SCHOOL_ADMIN defaults → hr.view is denied", () => {
    expect(
      hasPermission(
        {
          role: "SCHOOL_ADMIN",
          permissions: getSystemRolePermissions("SCHOOL_ADMIN"),
        },
        "hr.view",
      ),
    ).toBe(false);
  });

  it("SCHOOL_ADMIN defaults → payroll.view is denied", () => {
    expect(
      hasPermission(
        {
          role: "SCHOOL_ADMIN",
          permissions: getSystemRolePermissions("SCHOOL_ADMIN"),
        },
        "payroll.view",
      ),
    ).toBe(false);
  });

  it("SCHOOL_ADMIN defaults → students.view is allowed", () => {
    expect(
      hasPermission(
        {
          role: "SCHOOL_ADMIN",
          permissions: getSystemRolePermissions("SCHOOL_ADMIN"),
        },
        "students.view",
      ),
    ).toBe(true);
  });

  it("TEACHER with empty permissions → students.view denied (no short-circuit)", () => {
    expect(
      hasPermission({ role: "TEACHER", permissions: [] }, "students.view"),
    ).toBe(false);
  });

  it("TEACHER with defaults → students.view allowed", () => {
    expect(
      hasPermission(
        { role: "TEACHER", permissions: getSystemRolePermissions("TEACHER") },
        "students.view",
      ),
    ).toBe(true);
  });

  it("custom role with [payroll.view] → payroll.view true, employees.view false", () => {
    const session = { role: "SCHOOL_ADMIN", permissions: ["payroll.view"] };
    expect(hasPermission(session, "payroll.view")).toBe(true);
    expect(hasPermission(session, "employees.view")).toBe(false);
  });
});

describe("getSystemRolePermissions", () => {
  it("SUPER_ADMIN → ALL_PERMISSIONS", () => {
    expect(getSystemRolePermissions("SUPER_ADMIN")).toEqual(ALL_PERMISSIONS);
  });

  it("SCHOOL_ADMIN → excludes all hr.*, payroll.*, employees.*, attendance.*, leave.* codes", () => {
    const perms = getSystemRolePermissions("SCHOOL_ADMIN");
    const forbidden = perms.filter(
      (p) =>
        p.startsWith("hr.") ||
        p.startsWith("payroll.") ||
        p.startsWith("employees.") ||
        p.startsWith("attendance.") ||
        p.startsWith("leave."),
    );
    expect(forbidden).toEqual([]);
  });

  it("SCHOOL_ADMIN → includes core academic + finance + settings codes", () => {
    const perms = getSystemRolePermissions("SCHOOL_ADMIN");
    expect(perms).toContain("students.view");
    expect(perms).toContain("invoices.view");
    expect(perms).toContain("settings.edit");
    expect(perms).toContain("users.edit");
  });

  it("SCHOOL_ADMIN → holds every non-HR code except the teacher-only assessments.write", () => {
    const hr = new Set(Object.keys(PERMISSION_GROUPS.hr.permissions));
    const expected = ALL_PERMISSIONS.filter(
      (p) => !hr.has(p) && p !== "assessments.write",
    );
    expect(getSystemRolePermissions("SCHOOL_ADMIN").sort()).toEqual(
      expected.sort(),
    );
  });

  it("TEACHER → self-service set: attendance + leave + students + curriculum.read + assessments r/w", () => {
    expect(getSystemRolePermissions("TEACHER")).toEqual([
      "attendance.view",
      "attendance.checkin",
      "leave.submit",
      "students.view",
      "curriculum.read",
      "assessments.read",
      "assessments.write",
    ]);
  });

  it("TEACHER → has attendance.checkin (Task 4 / F-09)", () => {
    expect(getSystemRolePermissions("TEACHER")).toContain("attendance.checkin");
  });

  it("TEACHER → has leave.submit (Task 4 / F-09)", () => {
    expect(getSystemRolePermissions("TEACHER")).toContain("leave.submit");
  });

  it("TEACHER → does NOT have leave.view (admin-only listing perm)", () => {
    expect(getSystemRolePermissions("TEACHER")).not.toContain("leave.view");
  });

  it("GUARDIAN → students.view + invoices.view + assessments.read", () => {
    expect(getSystemRolePermissions("GUARDIAN")).toEqual([
      "students.view",
      "invoices.view",
      "assessments.read",
    ]);
  });

  it("GUARDIAN → has assessments.read (C6 perkembangan rollup)", () => {
    expect(getSystemRolePermissions("GUARDIAN")).toContain("assessments.read");
  });

  it("GUARDIAN → does NOT have assessments.write (read-only)", () => {
    expect(getSystemRolePermissions("GUARDIAN")).not.toContain(
      "assessments.write",
    );
  });

  it("SCHOOL_ADMIN → has assessments.read + assessments.void (C7a override gate)", () => {
    const perms = getSystemRolePermissions("SCHOOL_ADMIN");
    expect(perms).toContain("assessments.read");
    expect(perms).toContain("assessments.void");
  });

  it("SCHOOL_ADMIN → does NOT have assessments.write (writing entries stays teacher-only)", () => {
    expect(getSystemRolePermissions("SCHOOL_ADMIN")).not.toContain(
      "assessments.write",
    );
  });

  it("TEACHER → does NOT have assessments.void (admin-only override)", () => {
    expect(getSystemRolePermissions("TEACHER")).not.toContain(
      "assessments.void",
    );
  });

  it("GUARDIAN → does NOT have assessments.void (admin-only override)", () => {
    expect(getSystemRolePermissions("GUARDIAN")).not.toContain(
      "assessments.void",
    );
  });
});

describe("ALL_PERMISSIONS", () => {
  it("includes hr.view (new entry added in Task 2)", () => {
    expect(ALL_PERMISSIONS).toContain("hr.view");
  });

  it("includes curriculum.read + curriculum.write (C1/T2)", () => {
    expect(ALL_PERMISSIONS).toContain("curriculum.read");
    expect(ALL_PERMISSIONS).toContain("curriculum.write");
  });

  it("includes assessments.read + assessments.write + assessments.void (C7a/T2)", () => {
    expect(ALL_PERMISSIONS).toContain("assessments.read");
    expect(ALL_PERMISSIONS).toContain("assessments.write");
    expect(ALL_PERMISSIONS).toContain("assessments.void");
  });
});

describe("curriculum permissions (C1/T2)", () => {
  it("SUPER_ADMIN owner escape hatch grants curriculum.write without explicit listing", () => {
    expect(
      hasPermission({ role: "SUPER_ADMIN", permissions: [] }, "curriculum.write"),
    ).toBe(true);
  });

  it("SCHOOL_ADMIN defaults → curriculum.read and curriculum.write allowed (admin-curriculum-write)", () => {
    const perms = getSystemRolePermissions("SCHOOL_ADMIN");
    expect(
      hasPermission({ role: "SCHOOL_ADMIN", permissions: perms }, "curriculum.read"),
    ).toBe(true);
    expect(
      hasPermission({ role: "SCHOOL_ADMIN", permissions: perms }, "curriculum.write"),
    ).toBe(true);
  });

  it("TEACHER defaults → curriculum.read allowed, curriculum.write denied", () => {
    const perms = getSystemRolePermissions("TEACHER");
    expect(
      hasPermission({ role: "TEACHER", permissions: perms }, "curriculum.read"),
    ).toBe(true);
    expect(
      hasPermission({ role: "TEACHER", permissions: perms }, "curriculum.write"),
    ).toBe(false);
  });

  it("GUARDIAN defaults → curriculum.read denied", () => {
    const perms = getSystemRolePermissions("GUARDIAN");
    expect(
      hasPermission({ role: "GUARDIAN", permissions: perms }, "curriculum.read"),
    ).toBe(false);
  });
});

describe("reportCard permissions (C8 admin-raport-mvp)", () => {
  it("ALL_PERMISSIONS includes reportCard.read/write/publish", () => {
    expect(ALL_PERMISSIONS).toContain("reportCard.read");
    expect(ALL_PERMISSIONS).toContain("reportCard.write");
    expect(ALL_PERMISSIONS).toContain("reportCard.publish");
  });

  it("SUPER_ADMIN owner escape hatch grants reportCard.publish without explicit listing", () => {
    expect(
      hasPermission({ role: "SUPER_ADMIN", permissions: [] }, "reportCard.publish"),
    ).toBe(true);
  });

  it("SCHOOL_ADMIN defaults → reportCard.read/write/publish all allowed", () => {
    const perms = getSystemRolePermissions("SCHOOL_ADMIN");
    expect(hasPermission({ role: "SCHOOL_ADMIN", permissions: perms }, "reportCard.read")).toBe(true);
    expect(hasPermission({ role: "SCHOOL_ADMIN", permissions: perms }, "reportCard.write")).toBe(true);
    expect(hasPermission({ role: "SCHOOL_ADMIN", permissions: perms }, "reportCard.publish")).toBe(true);
  });

  it("TEACHER defaults → no reportCard.* (admin-driven MVP)", () => {
    const perms = getSystemRolePermissions("TEACHER");
    expect(hasPermission({ role: "TEACHER", permissions: perms }, "reportCard.read")).toBe(false);
    expect(hasPermission({ role: "TEACHER", permissions: perms }, "reportCard.write")).toBe(false);
    expect(hasPermission({ role: "TEACHER", permissions: perms }, "reportCard.publish")).toBe(false);
  });

  it("GUARDIAN defaults → no reportCard.* (parent surface is a later phase)", () => {
    const perms = getSystemRolePermissions("GUARDIAN");
    expect(hasPermission({ role: "GUARDIAN", permissions: perms }, "reportCard.read")).toBe(false);
  });

  // Bank narasi templates (2026-07-31). Split from reportCard.write so cycle 4
  // can grant walas template authoring without per-student raport writes.
  it("ALL_PERMISSIONS includes reportCard.template", () => {
    expect(ALL_PERMISSIONS).toContain("reportCard.template");
  });

  it("SUPER_ADMIN + SCHOOL_ADMIN get reportCard.template; TEACHER and GUARDIAN do not", () => {
    expect(
      hasPermission({ role: "SUPER_ADMIN", permissions: [] }, "reportCard.template"),
    ).toBe(true);
    const admin = getSystemRolePermissions("SCHOOL_ADMIN");
    expect(
      hasPermission({ role: "SCHOOL_ADMIN", permissions: admin }, "reportCard.template"),
    ).toBe(true);
    const teacher = getSystemRolePermissions("TEACHER");
    expect(
      hasPermission({ role: "TEACHER", permissions: teacher }, "reportCard.template"),
    ).toBe(false);
    const guardian = getSystemRolePermissions("GUARDIAN");
    expect(
      hasPermission({ role: "GUARDIAN", permissions: guardian }, "reportCard.template"),
    ).toBe(false);
  });
});
