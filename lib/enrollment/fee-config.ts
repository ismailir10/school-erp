/**
 * Per-program pendaftaran fees, read from `Program.enrollmentFee`. Server-only
 * (Prisma). The pure math lives in ./fee.
 *
 * Only ACTIVE programs of the tenant are returned: an inactive program cannot
 * be chosen on the form, and another tenant's program must never price this
 * tenant's application.
 */

import { prisma } from "@/lib/db";
import { toRupiah, type FeeProgram } from "./fee";

export type ProgramFeeRow = FeeProgram & { name: string };

export async function getProgramFees(
  tenantId: string,
  db: Pick<typeof prisma, "program"> = prisma,
): Promise<ProgramFeeRow[]> {
  const rows = await db.program.findMany({
    where: { tenantId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, enrollmentFee: true },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    // Prisma Decimal arrives as a string-like; Number() before any arithmetic.
    enrollmentFee: toRupiah(Number(r.enrollmentFee)),
  }));
}
