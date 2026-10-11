import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { createProgramSchema, updateProgramSchema } from "../program";
import { updateEnrollmentSchema } from "../enrollment";
import { updateClassSectionSchema } from "../class-section";
import { updateStudentSchema } from "../student";
import {
  createGuardianSchema,
  updateGuardianSchema,
  toggleGuardianStatusSchema,
} from "../guardian";
import { updateAdmissionSchema } from "../admission";
import { recordPaymentSchema, updateInvoiceSchema } from "../invoice";
import { updateStudentAttendanceSchema } from "../student-attendance";
import { createCategorySchema } from "../student-journal";
import { updateTeachingAssignmentSchema } from "../teaching-assignment";
import { createLeaveRequestSchema } from "../leave";

/**
 * Schema enum conformance — Zod ↔ Prisma comment-documented values.
 *
 * Prisma uses `String` columns (not `enum`) for status/type fields, so
 * `npx prisma validate` cannot catch drift. The canonical set of allowed
 * values lives as an inline comment on each field in `prisma/schema.prisma`,
 * e.g. `type String // SEMESTER | YEAR_ROUND | SESSION`.
 *
 * This test parses the comment for the targeted fields, compares against
 * the matching Zod `z.enum([...])`, and fails the build if either side
 * drifts. To extend coverage, add a row to FIELDS below — the helper
 * does the rest.
 *
 * If you change a canonical value list, update BOTH the schema.prisma
 * inline comment AND the Zod enum in the same commit.
 */

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");
const SCHEMA = readFileSync(SCHEMA_PATH, "utf8");

/**
 * Extract the documented allowed values for `<field> String // A | B | C`
 * scoped to the body of `model <Model>`. Returns sorted unique strings.
 */
function prismaDocumentedValues(model: string, field: string): string[] {
  const modelRegex = new RegExp(`model\\s+${model}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const modelMatch = SCHEMA.match(modelRegex);
  if (!modelMatch) {
    throw new Error(`model ${model} not found in prisma/schema.prisma`);
  }
  const body = modelMatch[1];
  // Match `<field>  String  ... // VAL_A | VAL_B | VAL_C`
  // Allow `@default("…")` between String and the comment.
  const fieldRegex = new RegExp(
    `\\n\\s*${field}\\s+String[^\\n]*//\\s*([A-Z0-9_ |]+)`,
    "m"
  );
  const fieldMatch = body.match(fieldRegex);
  if (!fieldMatch) {
    throw new Error(
      `field ${model}.${field} comment not found or does not list canonical values`
    );
  }
  return fieldMatch[1]
    .split("|")
    .map((v) => v.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Pull the literal set out of a Zod object schema's enum field.
 * Handles `.optional()` / `.default()` / `.nullable()` wrappers.
 *
 * Zod v4 internals: `_def.type` is a string tag ("enum", "default",
 * "optional", "nullable"); wrappers expose the wrapped schema as
 * `_def.innerType`; enums expose `_def.entries` as `{ key: value }`.
 */
function zodEnumValues(schema: z.ZodObject<z.ZodRawShape>, key: string): string[] {
  const shape = schema.shape;
  let node = shape[key] as z.ZodTypeAny | undefined;
  if (!node) throw new Error(`zod schema has no field "${key}"`);
  while (
    node._def &&
    (node._def as { type?: string }).type !== "enum" &&
    (node._def as { innerType?: z.ZodTypeAny }).innerType
  ) {
    node = (node._def as unknown as { innerType: z.ZodTypeAny }).innerType;
  }
  if (!(node instanceof z.ZodEnum)) {
    throw new Error(
      "zodEnumValues: expected ZodEnum instance — Zod internals may have changed; update this helper."
    );
  }
  const def = node._def as { type?: string; entries?: Record<string, string> };
  if (def?.type !== "enum" || !def.entries) {
    throw new Error(`zod field "${key}" is not z.enum (got ${def?.type})`);
  }
  return Object.values(def.entries).sort();
}

/**
 * Coverage table — every (Model, field) combination where the Prisma
 * column has an inline `// A | B | C` canonical comment AND a matching
 * Zod enum exists in lib/validations.
 *
 * Skipped (no Zod schema yet — add a row when one is introduced):
 *   - User.status (no admin user CRUD schema)
 *   - LeaveRequest.status (only create schema; no update/approval schema)
 *   - AcademicYear.status (no Zod schema)
 *   - Student.livingWith (free-text, no enum in Zod)
 *   - Parent.status (no admin parent CRUD schema)
 *   - Parent.education (free-text, no enum in Zod)
 *   - Admission.parentEducation (free-text, no enum in Zod)
 *   - Admission.source (server-set: WALK_IN from the admin form, WEBSITE from /daftar; no API input)
 *   - FeeComponentDef.category (no Zod schema)
 *   - FeeComponentDef.status (no Zod schema)
 *   - ProgramFeeStructure.status (no Zod schema)
 *   - Payment.status (no Zod schema for payment status mutations)
 *   - StudentJournalTemplate.status (no Zod schema)
 *   - StudentJournalAudit.entityType / .action (server-set, no API input)
 */
type Row = {
  model: string;
  field: string;
  schema: z.ZodObject<z.ZodRawShape>;
  key: string;
  label: string;
};

const FIELDS: Row[] = [
  { model: "Program", field: "type", schema: createProgramSchema, key: "type", label: "Program.type / createProgramSchema" },
  { model: "Program", field: "type", schema: updateProgramSchema, key: "type", label: "Program.type / updateProgramSchema" },
  { model: "Program", field: "status", schema: updateProgramSchema, key: "status", label: "Program.status / updateProgramSchema" },
  { model: "ClassSection", field: "status", schema: updateClassSectionSchema, key: "status", label: "ClassSection.status / updateClassSectionSchema" },
  { model: "Student", field: "status", schema: updateStudentSchema, key: "status", label: "Student.status / updateStudentSchema" },
  { model: "StudentGuardian", field: "relationship", schema: createGuardianSchema, key: "relationship", label: "StudentGuardian.relationship / createGuardianSchema" },
  { model: "StudentGuardian", field: "relationship", schema: updateGuardianSchema, key: "relationship", label: "StudentGuardian.relationship / updateGuardianSchema" },
  { model: "StudentGuardian", field: "status", schema: toggleGuardianStatusSchema, key: "status", label: "StudentGuardian.status / toggleGuardianStatusSchema" },
  { model: "StudentEnrollment", field: "status", schema: updateEnrollmentSchema, key: "status", label: "StudentEnrollment.status / updateEnrollmentSchema" },
  { model: "Admission", field: "status", schema: updateAdmissionSchema, key: "status", label: "Admission.status / updateAdmissionSchema" },
  { model: "Invoice", field: "status", schema: updateInvoiceSchema, key: "status", label: "Invoice.status / updateInvoiceSchema" },
  { model: "Payment", field: "method", schema: recordPaymentSchema, key: "method", label: "Payment.method / recordPaymentSchema" },
  { model: "StudentAttendance", field: "status", schema: updateStudentAttendanceSchema, key: "status", label: "StudentAttendance.status / updateStudentAttendanceSchema" },
  { model: "StudentJournalCategory", field: "scope", schema: createCategorySchema, key: "scope", label: "StudentJournalCategory.scope / createCategorySchema" },
  { model: "TeachingAssignment", field: "role", schema: updateTeachingAssignmentSchema, key: "role", label: "TeachingAssignment.role / updateTeachingAssignmentSchema" },
  { model: "LeaveRequest", field: "leaveType", schema: createLeaveRequestSchema, key: "leaveType", label: "LeaveRequest.leaveType / createLeaveRequestSchema" },
];

describe("Zod ↔ Prisma enum conformance", () => {
  it.each(FIELDS)("$label", ({ model, field, schema, key }) => {
    expect(zodEnumValues(schema, key)).toEqual(prismaDocumentedValues(model, field));
  });
});
