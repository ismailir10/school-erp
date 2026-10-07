import type { prisma } from "@/lib/db";

// ClassSection is unique on (tenant, academicYear, campus, name), but Postgres
// compares that name case-sensitively, so "TK A" and "tk a" would coexist.
// Create/rename routes call this first so the school sees one 409, not two
// near-identical classes. The DB unique stays as the race backstop.

export const CLASS_NAME_CLASH_MESSAGE =
  "Kelas dengan nama ini sudah ada di kampus dan tahun ajaran tersebut.";

type ClassNameDb = Pick<typeof prisma, "classSection">;

/**
 * Returns the existing section whose name equals `name` ignoring case (after
 * trimming) in the same tenant + academic year + campus, or null.
 * Pass `excludeId` on rename so a class never clashes with itself.
 */
export async function findClassNameClash(
  db: ClassNameDb,
  args: {
    tenantId: string;
    academicYearId: string;
    campusId: string;
    name: string;
    excludeId?: string;
  },
): Promise<{ id: string; name: string } | null> {
  return db.classSection.findFirst({
    where: {
      tenantId: args.tenantId,
      academicYearId: args.academicYearId,
      campusId: args.campusId,
      name: { equals: args.name.trim(), mode: "insensitive" },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
}
