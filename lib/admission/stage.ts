/**
 * Tahap: where a family is on the way from first inquiry to student, DERIVED from
 * the lead (`Admission`), its formulir (`EnrollmentApplication`) and the student
 * link. Nothing here is stored or clicked (cycle 2026-10-11-pendaftaran-simplify,
 * decision 2).
 *
 * `deriveStage` is the one definition. `stageWhere` is the same definition written
 * as a Prisma `where`, so the list can filter and count in the database (correct
 * pagination, no fetch-everything). The two are tested against the same fixtures:
 * change one, the other test fails.
 *
 * Legacy values are READ as their neighbour and never rewritten: the retired lead
 * statuses VISIT_SCHEDULED / VISITED, and a lead left at ADMITTED without a
 * formulir or student, are BARU; a formulir at UNDER_REVIEW is FORMULIR_MASUK.
 * Pure, no Prisma runtime (type import only).
 */

import type { Prisma } from "@/lib/generated/prisma/client";

export const STAGES = [
  "BARU",
  "FORMULIR_DIKIRIM",
  "FORMULIR_MASUK",
  "DITERIMA",
  "SISWA",
  "DITOLAK",
  "BATAL",
] as const;

export type Stage = (typeof STAGES)[number];

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

type LeadLike = { status: string; studentId?: string | null };
type FormulirLike = { status: string; studentId?: string | null };

/**
 * The ONE place a formulir status maps to a stage. `deriveStage` reads it and
 * `stageWhere` builds its `in` / `notIn` from its keys, so a status added here
 * lands in exactly one stage everywhere and can never match two. A status not
 * listed (unknown, or no formulir at all) is BARU.
 */
export const FORMULIR_STAGE: Readonly<Record<string, Stage>> = {
  INVITED: "FORMULIR_DIKIRIM",
  SUBMITTED: "FORMULIR_MASUK",
  UNDER_REVIEW: "FORMULIR_MASUK", // legacy: read as Formulir masuk
  ACCEPTED: "DITERIMA",
  REJECTED: "DITOLAK",
};

const FORMULIR_STATUSES = Object.keys(FORMULIR_STAGE);
const statusesOf = (stage: Stage) => FORMULIR_STATUSES.filter((s) => FORMULIR_STAGE[s] === stage);

/**
 * Precedence: a student link wins over everything (converted is final, even if the
 * lead was cancelled afterwards), then a cancelled lead, then the formulir's own
 * status. Anything not recognised is BARU.
 */
export function deriveStage(admission: LeadLike, application: FormulirLike | null | undefined): Stage {
  if (admission.studentId || application?.studentId) return "SISWA";
  if (admission.status === "CANCELLED") return "BATAL";
  const status = application?.status;
  return status !== undefined && Object.hasOwn(FORMULIR_STAGE, status) ? FORMULIR_STAGE[status] : "BARU";
}

// ── The same rules as a Prisma where (Admission is the root) ─────────────────
// Nested `is:` filters carry no tenantId on purpose: an application and its lead
// are 1:1 through a foreign key and are created together, so they always share a
// tenant; the root `tenantId` filter on the Admission is the boundary.

/** No student on the lead and none on its formulir. */
const NOT_STUDENT: Prisma.AdmissionWhereInput = {
  AND: [
    { studentId: null },
    { OR: [{ enrollmentApplication: { is: null } }, { enrollmentApplication: { is: { studentId: null } } }] },
  ],
};

/** Not a student and the lead is not cancelled: the stage is up to the formulir. */
const OPEN: Prisma.AdmissionWhereInput = { AND: [NOT_STUDENT, { status: { not: "CANCELLED" } }] };

const formulirIn = (statuses: string[]): Prisma.AdmissionWhereInput => ({
  AND: [OPEN, { enrollmentApplication: { is: { status: { in: statuses } } } }],
});

/** The where clause (without tenant) for the leads in one stage. Mirrors `deriveStage`. */
export function stageWhere(stage: Stage): Prisma.AdmissionWhereInput {
  switch (stage) {
    case "SISWA":
      return { OR: [{ studentId: { not: null } }, { enrollmentApplication: { is: { studentId: { not: null } } } }] };
    case "BATAL":
      return { AND: [NOT_STUDENT, { status: "CANCELLED" }] };
    case "BARU":
      return {
        AND: [
          OPEN,
          {
            OR: [
              { enrollmentApplication: { is: null } },
              { enrollmentApplication: { is: { status: { notIn: FORMULIR_STATUSES } } } },
            ],
          },
        ],
      };
    default:
      return formulirIn(statusesOf(stage));
  }
}

/**
 * "Belum bayar": the formulir has an UNPAID fee. A rejected application's link is
 * closed and so is a cancelled lead's, so neither is something to chase (same
 * rule as the old enrollments list).
 */
export const UNPAID_WHERE: Prisma.AdmissionWhereInput = {
  AND: [
    { status: { not: "CANCELLED" } },
    { enrollmentApplication: { is: { status: { not: "REJECTED" }, fee: { is: { status: "UNPAID" } } } } },
  ],
};
