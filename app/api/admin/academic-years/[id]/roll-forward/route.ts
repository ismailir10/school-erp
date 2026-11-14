import { requirePermission } from "@/lib/auth-guards";
/**
 * `POST /api/admin/academic-years/[id]/roll-forward`
 *
 * Clones the ACTIVE `ClassSection` rows of a SOURCE academic year into a
 * TARGET year (`[id]`). Each cloned section keeps its stable `ClassTrack`
 * identity — the `@@unique([classTrackId, academicYearId])` constraint means
 * a track already present in the target year is skipped (P2002 caught
 * per-section, never aborts the whole run).
 *
 * After each successful create the new section's `ClassSession` rows are
 * generated via `reconcileSessions` — failure-isolated, same non-fatal
 * pattern Task 4 established for the ClassSection POST route.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { reconcileSessions } from "@/lib/sessions/reconcile";
import { rollForwardSchema } from "@/lib/validations/roll-forward";
import { Prisma } from "@/lib/generated/prisma/client";

/** Roll-forward is heavier than a plain academic-year write — keep the budget tight. */
const ROLL_FORWARD_BUDGET = 5;
const ROLL_FORWARD_WINDOW_MS = 60_000;

/**
 * Cap on source sections processed per request. Each section triggers a
 * `classSection.create` + a `reconcileSessions` call (up to ~10k rows), all
 * sequential — an uncapped fan-out on a large tenant means a multi-minute
 * request and long transaction pressure. When the cap is hit the response
 * carries `truncated: true`; the caller re-runs to roll the remainder
 * (already-rolled tracks are skipped idempotently via the P2002 path).
 */
const MAX_SOURCE_SECTIONS = 200;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { success } = rateLimit(
    `roll-forward-academic-year:${getClientIp(req)}`,
    ROLL_FORWARD_BUDGET,
    ROLL_FORWARD_WINDOW_MS,
  );
  if (!success) {
    return NextResponse.json(
      { error: "Terlalu banyak permintaan" },
      { status: 429 },
    );
  }

  const auth = await requirePermission("academic.edit");
  if ("error" in auth) return auth.error;
  const { session } = auth;
  const { id: targetYearId } = await params;
  const tenantId = session.tenantId;

  const parsed = rollForwardSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Input tidak valid" },
      { status: 400 },
    );
  }
  const { sourceYearId, trackIds } = parsed.data;

  if (sourceYearId === targetYearId) {
    return NextResponse.json(
      { error: "Tahun ajaran sumber dan tujuan tidak boleh sama" },
      { status: 400 },
    );
  }

  // Tenant-scope BOTH years — a year that does not belong to the caller's
  // tenant (or does not exist) is a 404, not a 403, so we never leak which
  // ids exist across tenants.
  const [targetYear, sourceYear] = await Promise.all([
    prisma.academicYear.findFirst({
      where: { id: targetYearId, tenantId },
      select: { id: true, status: true },
    }),
    prisma.academicYear.findFirst({
      where: { id: sourceYearId, tenantId },
      select: { id: true },
    }),
  ]);
  if (!targetYear || !sourceYear) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }

  if (targetYear.status === "ARCHIVED") {
    return NextResponse.json({ error: "Tahun ajaran sudah diarsipkan. Kelas tidak dapat disalin." }, { status: 409 });
  }

  // Only ACTIVE sections under ACTIVE tracks roll forward.
  const sourceSections = await prisma.classSection.findMany({
    where: {
      academicYearId: sourceYearId,
      tenantId,
      status: "ACTIVE",
      classTrack: { status: "ACTIVE" },
      ...(trackIds && trackIds.length > 0
        ? { classTrackId: { in: trackIds } }
        : {}),
    },
    select: {
      classTrackId: true,
      programId: true,
      campusId: true,
      name: true,
      ageGroup: true,
      capacity: true,
      slotTemplate: true,
    },
    // Bound the per-request fan-out — see MAX_SOURCE_SECTIONS.
    take: MAX_SOURCE_SECTIONS,
  });

  // A full page of results means there may be more sections to roll; the
  // caller re-runs to pick up the remainder.
  const truncated = sourceSections.length === MAX_SOURCE_SECTIONS;

  let sectionsCreated = 0;
  let tracksSkippedAlreadyRolled = 0;
  let sessionsReconcileFailed = 0;
  const skippedTracks: { classTrackId: string; name: string }[] = [];

  for (const src of sourceSections) {
    let newSectionId: string;
    try {
      const created = await prisma.classSection.create({
        data: {
          tenantId,
          classTrackId: src.classTrackId,
          programId: src.programId,
          campusId: src.campusId,
          academicYearId: targetYearId,
          name: src.name,
          ageGroup: src.ageGroup,
          capacity: src.capacity,
          slotTemplate: src.slotTemplate,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      newSectionId = created.id;
    } catch (err) {
      // @@unique([classTrackId, academicYearId]) — this track already has a
      // section in the target year. Skip it and keep going; do NOT abort the
      // run on one conflict.
      if (isUniqueViolation(err)) {
        tracksSkippedAlreadyRolled += 1;
        // Carry the stable classTrackId — two distinct tracks (different
        // campuses) can share a display name, so the name alone is ambiguous.
        skippedTracks.push({ classTrackId: src.classTrackId, name: src.name });
        continue;
      }
      throw err;
    }

    sectionsCreated += 1;

    // Reactive session generation — failure-isolated. A reconcile failure is
    // logged + counted but never rolls back the (already-committed) create;
    // reconcile is idempotent and re-runnable.
    try {
      await reconcileSessions(newSectionId);
    } catch (err) {
      console.error(
        `[academic-years roll-forward] reconcileSessions failed for section ${newSectionId}:`,
        err,
      );
      sessionsReconcileFailed += 1;
    }
  }

  await recordAudit({
    tenantId,
    actorId: session.id,
    entity: "AcademicYear",
    entityId: targetYearId,
    action: "roll_forward",
    after: {
      sourceYearId,
      trackIds: trackIds && trackIds.length > 0 ? trackIds : "all",
      sectionsCreated,
      tracksSkippedAlreadyRolled,
      sessionsReconcileFailed,
      truncated,
    },
  });

  return NextResponse.json({
    sectionsCreated,
    tracksSkippedAlreadyRolled,
    sessionsReconcileFailed,
    skippedTracks,
    truncated,
  });
}
