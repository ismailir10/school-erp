/**
 * Shared shapes for the student dossier (`app/admin/students/[id]/page.tsx`
 * and `components/admin/students/detail/*`). One definition instead of each
 * section re-declaring its own slice of `Student` — the page and every
 * section that reads `student.guardians`/`student.enrollments` import from
 * here.
 */
import type { GuardianCardData } from "@/components/admin/guardian-detail-card";

export type Sibling = { id: string; name: string; status: string };

export type Guardian = GuardianCardData & {
  parent: GuardianCardData["parent"] & { guardians?: { student: Sibling }[] };
};

export type Enrollment = {
  id: string;
  enrollDate: string;
  status: string;
  classSection: {
    id: string;
    name: string;
    program: { name: string; code: string; type: string };
    academicYear: { name: string; status: string };
    campus: { name: string };
  };
};

export type Student = {
  canEdit: boolean;
  id: string;
  name: string;
  nickname: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
  notes: string | null;
  metadata: string | null;
  status: string;
  nis: string | null;
  nisn: string | null;
  birthPlace: string | null;
  nik: string | null;
  kkNumber: string | null;
  livingWith: string | null;
  photoUrl: string | null;
  createdAt: string | null;
  withdrawalReason: string | null;
  withdrawalDate: string | null;
  graduationDate: string | null;
  guardians: Guardian[];
  enrollments: Enrollment[];
};
