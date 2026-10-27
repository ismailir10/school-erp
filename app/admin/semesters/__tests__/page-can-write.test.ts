/**
 * admin-curriculum-write — the three Semester server pages hand the client a
 * `canWrite` flag. It must follow the `curriculum.write` permission (so the
 * school admin and a custom role holding it see Tambah), not the role name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { getSystemRolePermissions } from "@/lib/permissions";

const assertPermission = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  assertPermission: (perm: string) => assertPermission(perm),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    semester: {
      findFirst: vi.fn().mockResolvedValue({
        id: "sem1",
        number: 1,
        startDate: new Date("2026-07-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        status: "ACTIVE",
        academicYear: { name: "2026/2027" },
      }),
    },
  },
}));

// The pages only need to hand props to these; keep the real client trees out.
vi.mock("@/app/admin/semesters/client", () => ({ SemestersClient: () => null }));
vi.mock("@/app/admin/semesters/[id]/themes/client", () => ({ ThemesClient: () => null }));
vi.mock("@/app/admin/semesters/[id]/objectives/client", () => ({ ObjectivesClient: () => null }));

const params = Promise.resolve({ id: "sem1" });

function session(role: string, permissions: string[]) {
  return { role, tenantId: "t1", permissions };
}

async function canWriteOf(page: string, s: ReturnType<typeof session>) {
  assertPermission.mockResolvedValue(s);
  let el: ReactElement<{ canWrite: boolean }>;
  if (page === "list") {
    const mod = await import("@/app/admin/semesters/page");
    el = (await mod.default()) as never;
  } else if (page === "themes") {
    const mod = await import("@/app/admin/semesters/[id]/themes/page");
    el = (await mod.default({ params })) as never;
  } else {
    const mod = await import("@/app/admin/semesters/[id]/objectives/page");
    el = (await mod.default({ params })) as never;
  }
  return el.props.canWrite;
}

describe.each(["list", "themes", "objectives"])("semester %s page canWrite", (page) => {
  beforeEach(() => assertPermission.mockReset());

  it("school admin (system defaults) can write", async () => {
    const s = session("SCHOOL_ADMIN", getSystemRolePermissions("SCHOOL_ADMIN"));
    expect(await canWriteOf(page, s)).toBe(true);
  });

  it("super admin can write", async () => {
    expect(await canWriteOf(page, session("SUPER_ADMIN", []))).toBe(true);
  });

  it("custom role holding curriculum.write can write", async () => {
    const s = session("SCHOOL_ADMIN", ["curriculum.read", "curriculum.write"]);
    expect(await canWriteOf(page, s)).toBe(true);
  });

  it("read-only custom role cannot write", async () => {
    const s = session("SCHOOL_ADMIN", ["curriculum.read"]);
    expect(await canWriteOf(page, s)).toBe(false);
  });

  it("teacher cannot write", async () => {
    const s = session("TEACHER", getSystemRolePermissions("TEACHER"));
    expect(await canWriteOf(page, s)).toBe(false);
  });
});
