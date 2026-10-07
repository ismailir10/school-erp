import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Indonesian status labels — same wording as StatusBadge (components/ui/status-badge.tsx). */
export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",
  GRADUATED: "Lulus",
  WITHDRAWN: "Keluar",
};

/**
 * ADM-1: only an ACTIVE student can be enrolled into a class. A WITHDRAWN
 * student enrolled anyway ended up with an ACTIVE enrollment that inflated
 * class counts, attendance recap and journal monitoring. Returns the 409 to
 * send, or null when enrolment may proceed.
 */
export function studentNotActiveResponse(status: string): NextResponse | null {
  if (status === "ACTIVE") return null;
  const label = STUDENT_STATUS_LABEL[status] ?? status;
  return NextResponse.json(
    {
      error: `Siswa berstatus ${label} tidak bisa didaftarkan ke kelas. Aktifkan kembali dulu.`,
      code: "STUDENT_NOT_ACTIVE",
    },
    { status: 409 },
  );
}

/**
 * ADM-2: NIS must be unique per tenant (any status, empty NIS ignored), and a
 * same name + same date of birth needs the admin's explicit confirmation.
 * Returns the 409 to send, or null when the write may proceed.
 *
 * `excludeId` leaves the student being edited out of the lookup.
 */
export async function findStudentConflict(params: {
  tenantId: string;
  nis?: string | null;
  name?: string | null;
  dateOfBirth?: string | null;
  excludeId?: string;
  /** Skip the name + date-of-birth check (edit path, or the admin confirmed). */
  skipDuplicateName?: boolean;
}): Promise<NextResponse | null> {
  const { tenantId, excludeId } = params;
  const notSelf = excludeId ? { id: { not: excludeId } } : {};

  const nis = params.nis?.trim();
  if (nis) {
    const taken = await prisma.student.findFirst({
      where: { tenantId, nis, ...notSelf },
      select: { id: true, name: true },
    });
    if (taken) {
      return NextResponse.json(
        { error: `NIS sudah dipakai oleh ${taken.name}.`, code: "NIS_TAKEN", field: "nis" },
        { status: 409 },
      );
    }
  }

  const name = params.name?.trim();
  const dateOfBirth = params.dateOfBirth?.trim();
  if (!params.skipDuplicateName && name && dateOfBirth) {
    const twin = await prisma.student.findFirst({
      where: { tenantId, dateOfBirth, name: { equals: name, mode: "insensitive" }, ...notSelf },
      select: { id: true, name: true, nis: true, status: true },
    });
    if (twin) {
      const hint = twin.nis || STUDENT_STATUS_LABEL[twin.status] || twin.status;
      return NextResponse.json(
        {
          error: `Siswa dengan nama dan tanggal lahir yang sama sudah ada: ${twin.name} (${hint}).`,
          code: "DUPLICATE_STUDENT",
          existingId: twin.id,
        },
        { status: 409 },
      );
    }
  }

  return null;
}
