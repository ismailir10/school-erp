/**
 * Canonical hrefs for the entities the UI names (see ui.md "Names are doors").
 * Pure builders only; whether the viewer may open the page is the caller's
 * call (pass `null` to `EntityLink` when not).
 */
export const entityHref = {
  student: (id: string) => `/admin/students/${id}`,
  /** `id` is the Parent record id. */
  guardian: (id: string) => `/admin/guardians/${id}`,
  class: (id: string) => `/admin/classes/${id}`,
  /** Requires `hr.view`. */
  employee: (id: string) => `/admin/employees/${id}`,
  invoice: (id: string) => `/admin/invoices/${id}`,
  teacherStudentJournal: (studentId: string) => `/teacher/student-journal/students/${studentId}`,
  /** Parent portal progress page, scoped to a child. */
  parentChildProgress: (childId: string) => `/parent/perkembangan/${childId}`,
} as const;
