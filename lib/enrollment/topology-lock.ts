import type { Prisma } from "@/lib/generated/prisma/client";

/** Acquire before student-stream/class locks and refresh any preflight class snapshot afterward.
 * Shared enrollment writers can overlap; a class program move excludes all of them until commit.
 */
export async function lockEnrollmentTopology(
  tx: Prisma.TransactionClient,
  tenantId: string,
  mode: "shared" | "exclusive",
): Promise<void> {
  const key = `enrollment-topology:${tenantId}`;
  if (mode === "shared") {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`;
  } else {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

/** Promotion batches take stream locks in the same order to avoid deadlocks. */
export async function lockEnrollmentStreams(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  academicYearId: string,
  programType: string,
): Promise<void> {
  for (const studentId of [...new Set(studentIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${studentId}:${academicYearId}:${programType}`}))`;
  }
}
