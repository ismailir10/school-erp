import { prisma } from "@/lib/db";

/** Indonesian field error for a `programId` that is not one of this school's programs. */
export const PROGRAM_NOT_FOUND = "Program tidak ditemukan";

/** True when `programId` is a program of `tenantId` (a lead must never point at another school's program). */
export async function programInTenant(tenantId: string, programId: string): Promise<boolean> {
  const program = await prisma.program.findFirst({ where: { id: programId, tenantId }, select: { id: true } });
  return program !== null;
}
