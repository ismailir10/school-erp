import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth-guards";
import { isAdminRole } from "@/lib/auth";
import { parseJakartaYmd } from "@/lib/validations/curriculum";
import { loadPenilaianMonitor } from "@/lib/curriculum/penilaian-monitor";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Jakarta (UTC+7, no DST) wall-clock date for "now". Used as the default
 * week/day anchor when the caller does not pass an explicit param.
 */
function jakartaTodayYmd(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resolveYmd(param: string | null): { ymd: string; date: Date } | null {
  const ymd = param ?? jakartaTodayYmd();
  if (!YMD.test(ymd)) return null;
  const date = parseJakartaYmd(ymd);
  if (Number.isNaN(date.getTime())) return null;
  return { ymd, date };
}

/**
 * GET /api/admin/assessments?week=YYYY-MM-DD&day=YYYY-MM-DD
 *
 * Read-only admin monitor over the new IKTP penilaian (`AssessmentEntry`):
 * walas-weekly completion per class + sentra-daily entries per center for
 * the active academic year. Gated by `assessments.read` AND an admin role
 * (SCHOOL_ADMIN + SUPER_ADMIN). `week` defaults to today's curriculum week; `day` to today.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission("assessments.read");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  // GUARDIAN/TEACHER hold assessments.read for their own children/classes;
  // this is the school-wide monitor, so it is admin-only on top of the permission.
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const weekArg = resolveYmd(searchParams.get("week"));
  const dayArg = resolveYmd(searchParams.get("day"));
  if (!weekArg || !dayArg) {
    return NextResponse.json(
      { error: "Parameter tanggal tidak valid (format YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  const activeYear = await prisma.academicYear.findFirst({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!activeYear) {
    return NextResponse.json(
      { error: "Tahun ajaran aktif belum diset. Aktifkan tahun ajaran terlebih dahulu." },
      { status: 422 },
    );
  }

  const monitor = await loadPenilaianMonitor(
    session.tenantId,
    activeYear.id,
    weekArg.date,
    dayArg.date,
  );

  return NextResponse.json({
    data: {
      academicYear: activeYear.name,
      weekDate: weekArg.ymd,
      sentraDate: dayArg.ymd,
      ...monitor,
    },
  });
}
