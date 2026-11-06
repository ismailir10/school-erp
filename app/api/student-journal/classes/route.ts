import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { getSentraClassIds, getTeacherSentraToday } from "@/lib/sentra/access";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date harus format YYYY-MM-DD").optional(),
});

const classSelect = {
  id: true,
  name: true,
  status: true,
  academicYear: { select: { status: true } },
  program: { select: { name: true } },
} as const;

type ClassItem = {
  id: string;
  classSection: {
    id: string;
    name: string;
    status: string;
    academicYear: { status: string } | null;
    program: { name: string };
  };
  access: "ASSIGNED" | "SENTRA";
  role?: string;
  todaySentraName?: string;
};

/**
 * GET /api/student-journal/classes?date=YYYY-MM-DD
 *
 * Classes a guru may open in Buku Penghubung: her teaching assignments plus
 * the classes of any putaran where she is guru sentra. Order: the class
 * visiting her sentra on `date` first, then assigned, then other sentra
 * classes, each by name. Teacher only; tenant-scoped.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "TEACHER" || !session.tenantId || !session.employeeId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { tenantId, employeeId } = session;

  const parsed = querySchema.safeParse({
    date: new URL(req.url).searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "date harus format YYYY-MM-DD" }, { status: 400 });
  }
  const date = parsed.data.date ?? getTodayInTimezone("Asia/Jakarta");

  const [assignments, sentraIds, todayHits] = await Promise.all([
    prisma.teachingAssignment.findMany({
      where: { employeeId, classSection: { tenantId } },
      select: { role: true, classSection: { select: classSelect } },
    }),
    getSentraClassIds(employeeId, tenantId),
    getTeacherSentraToday(employeeId, tenantId, date),
  ]);

  const todayByClass = new Map<string, string>();
  for (const h of todayHits) {
    if (!todayByClass.has(h.classSectionId)) todayByClass.set(h.classSectionId, h.sentraName);
  }

  const items = new Map<string, ClassItem>();
  for (const a of assignments) {
    if (items.has(a.classSection.id)) continue;
    items.set(a.classSection.id, {
      id: a.classSection.id,
      classSection: a.classSection,
      access: "ASSIGNED",
      role: a.role,
      todaySentraName: todayByClass.get(a.classSection.id),
    });
  }

  const extraIds = sentraIds.filter((id) => !items.has(id));
  if (extraIds.length > 0) {
    const classes = await prisma.classSection.findMany({
      where: {
        id: { in: extraIds },
        tenantId,
        status: "ACTIVE",
        academicYear: { status: "ACTIVE" },
      },
      select: classSelect,
    });
    for (const c of classes) {
      items.set(c.id, {
        id: c.id,
        classSection: c,
        access: "SENTRA",
        todaySentraName: todayByClass.get(c.id),
      });
    }
  }

  const rank = (i: ClassItem) => (i.todaySentraName ? 0 : i.access === "ASSIGNED" ? 1 : 2);
  const sorted = [...items.values()].sort(
    (a, b) =>
      rank(a) - rank(b) || a.classSection.name.localeCompare(b.classSection.name, "id"),
  );
  return NextResponse.json(sorted);
}
