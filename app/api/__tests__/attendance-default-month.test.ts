/**
 * Default month/year of the staff-attendance routes follow the school's
 * calendar (Asia/Jakarta), not the server's clock.
 *
 * Vercel runs in UTC, so between 00:00 and 06:59 WIB on the 1st the server
 * still thinks it is the previous month (previous year on 1 Jan). A caller
 * that sends no `?month=&year=` — a bookmark, a script, the CSV link — got
 * last month's records. Explicit params must keep working exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth";
import { getSystemRolePermissions } from "@/lib/permissions";

vi.mock("@/lib/db", () => ({
  prisma: {
    employee: { findMany: vi.fn(), findUnique: vi.fn() },
    attendanceRecord: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

function session(): SessionUser {
  return {
    id: "u1",
    email: "t@t",
    name: "T",
    role: "SUPER_ADMIN",
    tenantId: "t1",
    employeeId: "emp-self",
    parentId: null,
    permissions: getSystemRolePermissions("SUPER_ADMIN"),
    customRoleCode: null,
  };
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

type DateRange = { gte: string; lt: string };

/** Each route, and where its date-range query lands in the Prisma mock. */
const ROUTES: {
  name: string;
  call: (qs: string) => Promise<Response>;
  range: () => Promise<DateRange>;
}[] = [
  {
    name: "GET /api/attendance/my",
    call: async (qs) =>
      (await import("../attendance/my/route")).GET(new Request(`http://localhost/api/attendance/my${qs}`) as never),
    range: async () => {
      const { prisma } = await import("@/lib/db");
      const where = vi.mocked(prisma.attendanceRecord.findMany).mock.calls[0]![0]!.where as { date: DateRange };
      return where.date;
    },
  },
  {
    name: "GET /api/attendance/monthly",
    call: async (qs) =>
      (await import("../attendance/monthly/route")).GET(
        new Request(`http://localhost/api/attendance/monthly${qs}`) as never,
      ),
    range: async () => {
      const { prisma } = await import("@/lib/db");
      const where = vi.mocked(prisma.attendanceRecord.findMany).mock.calls[0]![0]!.where as { date: DateRange };
      return where.date;
    },
  },
  {
    name: "GET /api/employees/[id]/attendance",
    call: async (qs) =>
      (await import("../employees/[id]/attendance/route")).GET(
        new Request(`http://localhost/api/employees/emp-other/attendance${qs}`) as never,
        idParams("emp-other"),
      ),
    range: async () => {
      const { prisma } = await import("@/lib/db");
      const where = vi.mocked(prisma.attendanceRecord.findMany).mock.calls[0]![0]!.where as { date: DateRange };
      return where.date;
    },
  },
  {
    name: "GET /api/attendance/export",
    call: async (qs) =>
      (await import("../attendance/export/route")).GET(
        new Request(`http://localhost/api/attendance/export${qs}`) as never,
      ),
    range: async () => {
      const { prisma } = await import("@/lib/db");
      const args = vi.mocked(prisma.employee.findMany).mock.calls[0]![0] as {
        include: { attendanceRecords: { where: { date: DateRange } } };
      };
      return args.include.attendanceRecords.where.date;
    },
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const { prisma } = await import("@/lib/db");
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.attendanceRecord.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-other", tenantId: "t1", nama: "Bu Lain" } as never);
  const { getSession } = await import("@/lib/auth");
  vi.mocked(getSession).mockResolvedValue(session());
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(ROUTES)("$name — default month/year", ({ call, range }) => {
  it("with no params at 03:00 WIB on 1 Oct (20:00Z on 30 Sep) queries October, not September", async () => {
    vi.setSystemTime(new Date("2026-09-30T20:00:00.000Z"));
    const res = await call("");
    expect(res.status).toBe(200);
    expect(await range()).toEqual({ gte: "2026-10-01", lt: "2026-11-01" });
  });

  it("with no params at 03:00 WIB on 1 Jan queries the new year (December rollover handled)", async () => {
    vi.setSystemTime(new Date("2026-12-31T20:00:00.000Z"));
    const res = await call("");
    expect(res.status).toBe(200);
    expect(await range()).toEqual({ gte: "2027-01-01", lt: "2027-02-01" });
  });

  it("with no params at 23:30 WIB on 30 Sep still queries September", async () => {
    vi.setSystemTime(new Date("2026-09-30T16:30:00.000Z"));
    const res = await call("");
    expect(res.status).toBe(200);
    expect(await range()).toEqual({ gte: "2026-09-01", lt: "2026-10-01" });
  });

  it("explicit month and year are used as given, whatever the clock says", async () => {
    vi.setSystemTime(new Date("2026-09-30T20:00:00.000Z"));
    const res = await call("?month=12&year=2025");
    expect(res.status).toBe(200);
    expect(await range()).toEqual({ gte: "2025-12-01", lt: "2026-01-01" });
  });
});
