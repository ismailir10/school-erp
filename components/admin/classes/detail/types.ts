/**
 * Shared types + small helpers for the class-detail dossier split
 * (`app/admin/classes/[id]/client.tsx` + `components/admin/classes/detail/*`,
 * T2, 2026-09-27 admin-finish-standard cycle). One module so the orchestrator
 * and every section/dialog file agree on the shape of a class detail row
 * without importing from each other.
 */

export type SlotTemplate = "FULL_DAY" | "MORNING_AND_AFTERNOON";

export type TeachingRole = "HOMEROOM" | "ASSISTANT";

export type ClassDetail = {
  id: string;
  name: string;
  capacity: number;
  slotTemplate: SlotTemplate;
  status: "ACTIVE" | "INACTIVE";
  campusId: string;
  programId: string;
  academicYearId: string;
  classTrackId: string;
  campus: { id: string; name: string };
  program: { id: string; code: string; name: string };
  academicYear: {
    id: string;
    name: string;
    status: "PLANNING" | "ACTIVE" | "ARCHIVED";
  };
  classTrack: { id: string; name: string; status: string };
  enrollments: {
    id: string;
    enrollDate: string;
    status: string;
    student: { id: string; name: string; nis: string | null };
  }[];
  teachingAssignments: {
    id: string;
    role: TeachingRole;
    createdAt: string;
    employee: { id: string; nama: string; formalName: string | null };
  }[];
  enrolledCount: number;
};

export type Employee = { id: string; nama: string; formalName?: string | null };

export type StudentOption = {
  id: string;
  name: string;
  nickname?: string | null;
  nis: string | null;
  status: string;
  /** YYYY-MM-DD — shown so homonyms can be told apart (CORE-3). */
  dateOfBirth?: string | null;
  /** Classes the student is already ACTIVE in, for the same reason. */
  enrollments?: { classSection?: { name: string } | null }[];
};

export const ROLE_LABEL: Record<TeachingRole, string> = {
  HOMEROOM: "Wali Kelas",
  ASSISTANT: "Asisten",
};

/**
 * Section ids double as DOM anchor targets for `DossierNav` — English
 * identifiers per the class-detail migration (copy stays Indonesian, ids
 * stay English so they read as stable API-ish anchors, matching the T0
 * English-slug pass elsewhere in this cycle).
 */
export const SECTION_ROSTER = "roster";
export const SECTION_TEACHERS = "teachers";
export const SECTION_SESSIONS = "sessions";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // The API surfaces dates as YYYY-MM-DD strings; format to YYYY-MM-DD literally
  // (spec calls for that exact shape on roster rows).
  return value.slice(0, 10);
}
