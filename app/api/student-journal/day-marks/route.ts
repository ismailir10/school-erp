import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { validateBody } from "@/lib/api/validate";
import { dayMarkSchema, dayMarkRemoveSchema } from "@/lib/validations/student-journal";
import { requireDayMarkWriter } from "@/lib/student-journal/guards";
import {
  DAY_MARK_NOT_MARKABLE_MSG,
  isMarkableDate,
  removeDayMark,
  saveDayMark,
} from "@/lib/student-journal/day-marks";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

/**
 * PUT /api/student-journal/day-marks
 * Body: { classSectionId, date, reason }
 *
 * Marks one class-day "hari tanpa buku penghubung" with a short keterangan
 * (create or edit). Allowed for the class's guru and for school admins.
 *
 * DELETE /api/student-journal/day-marks
 * Body: { classSectionId, date } — removes the mark; entries are untouched.
 */
async function readBody(req: NextRequest): Promise<{ body: unknown } | { error: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    return { error: NextResponse.json({ error: "JSON tidak valid" }, { status: 400 }) };
  }
}

export async function PUT(req: NextRequest) {
  const read = await readBody(req);
  if ("error" in read) return read.error;
  const parsed = await validateBody(dayMarkSchema, read.body);
  if (parsed.error) return parsed.error;
  const { classSectionId, date, reason } = parsed.data;

  const guard = await requireDayMarkWriter(classSectionId);
  if (guard.error) return guard.error;
  const { session } = guard;

  const rl = rateLimit(`sj-daymark-${session.id}`, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }
  if (!isMarkableDate(date, getTodayInTimezone("Asia/Jakarta"))) {
    return NextResponse.json({ error: DAY_MARK_NOT_MARKABLE_MSG }, { status: 400 });
  }

  const data = await saveDayMark({
    tenantId: session.tenantId,
    actorUserId: session.id,
    classSectionId,
    date,
    reason,
  });
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const read = await readBody(req);
  if ("error" in read) return read.error;
  const parsed = await validateBody(dayMarkRemoveSchema, read.body);
  if (parsed.error) return parsed.error;
  const { classSectionId, date } = parsed.data;

  const guard = await requireDayMarkWriter(classSectionId);
  if (guard.error) return guard.error;
  const { session } = guard;

  const rl = rateLimit(`sj-daymark-${session.id}`, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
  }

  const removed = await removeDayMark({
    tenantId: session.tenantId,
    actorUserId: session.id,
    classSectionId,
    date,
  });
  return NextResponse.json({ data: { removed } });
}
