import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { isUniqueViolation } from "../classes/_helpers";

export { isUniqueViolation };

export const SENTRA_WRITE_BUDGET = 30;
export const SENTRA_WRITE_WINDOW_MS = 60_000;

/** Returns a 429 response when the caller is over budget, else null. */
export function limitWrites(req: Request, key: string): NextResponse | null {
  const { success } = rateLimit(
    `${key}:${getClientIp(req as never)}`,
    SENTRA_WRITE_BUDGET,
    SENTRA_WRITE_WINDOW_MS,
  );
  return success
    ? null
    : NextResponse.json({ error: "Terlalu banyak permintaan" }, { status: 429 });
}

export function notFound(what: string) {
  return NextResponse.json({ error: `${what} tidak ditemukan` }, { status: 404 });
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function findCampus(campusId: string, tenantId: string) {
  return prisma.campus.findFirst({
    where: { id: campusId, tenantId },
    select: { id: true },
  });
}

/** Every id must be an ACTIVE employee of this tenant and campus. */
export async function allActiveCampusEmployees(
  ids: string[],
  tenantId: string,
  campusId: string,
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const found = await prisma.employee.findMany({
    where: { id: { in: unique }, tenantId, campusId, status: "ACTIVE" },
    select: { id: true },
  });
  return found.length === unique.length;
}

export const TEACHER_ERROR =
  "Guru sentra harus karyawan aktif di kampus ini.";
export const DUP_SENTRA = "Nama sentra sudah dipakai di kampus ini";
export const DUP_ROTATION = "Nama putaran sudah dipakai di tahun ajaran dan kampus ini";
