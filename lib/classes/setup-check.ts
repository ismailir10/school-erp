/**
 * Setup check for the class ↔ program ↔ fee-structure chain that billing
 * silently depends on: a class is billed from the fee structure of the program
 * it is linked to. Pure, so the billing wizard and Tarif per Program share one
 * rule. Warnings only — nothing here ever blocks.
 */

export type SetupClass = {
  id: string;
  name: string;
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

// "TK A 1", "TKA 4", "TK B3", "TKIT-A", "KB A", "TK B (Reguler)": the A/B right after a
// school-level prefix. "TK A/B" and "TK Bintang" name no single group, so they read as none.
const GROUP_AFTER_PREFIX = /^\s*(?:TKIT|TK|KB|RA)\s*-?\s*([AB])(?=[\s\d-]|$)/i;
// "TK Islam Terpadu Kelas B": a program named for its group may also just end in A or B.
const GROUP_AT_END = /(?:^|\s)([AB])\s*$/i;

function asGroup(letter: string | undefined): Group | null {
  const g = letter?.toUpperCase();
  return g === "A" || g === "B" ? g : null;
}

/**
 * Group a name points at, or `null` when it names none ("Daycare", "Sakura").
 * Only the name is read: the kelompok usia on a class is required for every
 * class (daycare included), so it says too little to warn on.
 */
export function groupOf(name: string): Group | null {
  return asGroup(GROUP_AFTER_PREFIX.exec(name)?.[1]) ?? asGroup(GROUP_AT_END.exec(name)?.[1]);
}

/** One entry per problem, in class order. A class can carry both warnings. */
export function checkClassSetup(classes: SetupClass[]): SetupWarning[] {
  const warnings: SetupWarning[] = [];
  for (const c of classes) {
    const base = { classSectionId: c.id, className: c.name, programName: c.programName };
    if (c.recurringFeeTotal === null) warnings.push({ kind: "NO_FEE_STRUCTURE", ...base });
    const cg = groupOf(c.name);
    const pg = groupOf(c.programName);
    if (cg && pg && cg !== pg) warnings.push({ kind: "PROGRAM_NAME_MISMATCH", ...base });
  }
  return warnings;
}
