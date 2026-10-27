/**
 * Setup check for the class ↔ program ↔ fee-structure chain that billing
 * silently depends on: a class is billed from the fee structure of the program
 * it is linked to. Pure, so the billing wizard and Tarif per Program share one
 * rule. Warnings only — nothing here ever blocks.
 */

export type SetupClass = {
  id: string;
  name: string;
  /** Kelompok usia set on the class; the fallback when the name does not say. */
  ageGroup?: string | null;
  programName: string;
  /**
   * Recurring fee total of the class's program for its year. `null` = the
   * program has no billable fee line; `undefined` = not known, never warned on.
   */
  recurringFeeTotal?: number | null;
};

export type SetupWarning =
  | { kind: "NO_FEE_STRUCTURE"; classSectionId: string; className: string; programName: string }
  | { kind: "PROGRAM_NAME_MISMATCH"; classSectionId: string; className: string; programName: string };

type Group = "A" | "B";

// "TK A 1", "TKA 4", "TK B3", "TKIT-A", "KB A": the A/B right after a school-level prefix.
const CLASS_GROUP = /^\s*(?:TKIT|TK|KB|RA)\s*-?\s*([AB])(?=[\s\d-]|$)/i;
// "TK B", "TK  A", "TK Islam Terpadu Kelas B": a program named for its group ends in A or B.
const PROGRAM_GROUP = /(?:^|\s)([AB])\s*$/i;

function asGroup(letter: string | undefined): Group | null {
  const g = letter?.toUpperCase();
  return g === "A" || g === "B" ? g : null;
}

/** Group a class says it belongs to: its name first, then its kelompok usia. */
export function classGroup(c: Pick<SetupClass, "name" | "ageGroup">): Group | null {
  return asGroup(CLASS_GROUP.exec(c.name)?.[1]) ?? asGroup(c.ageGroup ?? undefined);
}

/** Group a program's name points at, or `null` when it names none ("Daycare"). */
export function programGroup(programName: string): Group | null {
  return asGroup(PROGRAM_GROUP.exec(programName)?.[1]);
}

/** One entry per problem, in class order. A class can carry both warnings. */
export function checkClassSetup(classes: SetupClass[]): SetupWarning[] {
  const warnings: SetupWarning[] = [];
  for (const c of classes) {
    const base = { classSectionId: c.id, className: c.name, programName: c.programName };
    if (c.recurringFeeTotal === null) warnings.push({ kind: "NO_FEE_STRUCTURE", ...base });
    const cg = classGroup(c);
    const pg = programGroup(c.programName);
    if (cg && pg && cg !== pg) warnings.push({ kind: "PROGRAM_NAME_MISMATCH", ...base });
  }
  return warnings;
}
