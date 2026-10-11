/**
 * Zod 4 (4.3.x) applies `.default()` values inside `.partial()`, so an update
 * endpoint built from `createSchema.partial()` overwrites columns the client
 * never sent (admission `source` -> WALK_IN on every status change, journal
 * `order` -> 0 on every activate/deactivate, employee `bpjsEnrolled` -> false).
 * Cycle 2026-09-29 data-integrity (CORE-1 / X-2, DRV-1, HR-7).
 *
 * The last block sweeps every `update*Schema` / `*UpdateSchema` export in
 * lib/validations so a new update schema can't reintroduce the class.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { partialWithoutDefaults } from "../zod-helpers";
import { updateAdmissionSchema } from "../admission";
import { updateCategorySchema, updateIndicatorSchema } from "../student-journal";
import { updateEmployeeSchema, employeeEditFormSchema } from "../employee";
import { updateStudentSchema } from "../student";

describe("partialWithoutDefaults", () => {
  const create = z.object({
    name: z.string(),
    source: z.enum(["A", "B"]).default("A"),
    order: z.number().default(0),
    note: z.string().optional(),
  });

  it("documents the Zod 4 behaviour it guards against", () => {
    expect(create.partial().parse({})).toEqual({ source: "A", order: 0 });
  });

  it("does not introduce default keys for an empty body", () => {
    expect(partialWithoutDefaults(create).parse({})).toEqual({});
  });

  it("keeps explicit values and still validates them", () => {
    const s = partialWithoutDefaults(create);
    expect(s.parse({ source: "B", order: 3 })).toEqual({ source: "B", order: 3 });
    expect(s.safeParse({ source: "Z" }).success).toBe(false);
  });

  it("leaves the create schema's own default untouched", () => {
    expect(create.parse({ name: "x" })).toMatchObject({ source: "A", order: 0 });
  });
});

describe("update schemas do not invent keys the client never sent", () => {
  it("updateAdmissionSchema: status-only body keeps source absent", () => {
    const data = updateAdmissionSchema.parse({ status: "VISIT_SCHEDULED" });
    expect(data).toEqual({ status: "VISIT_SCHEDULED" });
    expect("source" in data).toBe(false);
  });

  it("updateAdmissionSchema: source is not client-writable (stripped)", () => {
    expect(updateAdmissionSchema.parse({ source: "WEBSITE" })).toEqual({});
  });

  it("updateCategorySchema: status-only body keeps order absent", () => {
    expect(updateCategorySchema.parse({ status: "INACTIVE" })).toEqual({ status: "INACTIVE" });
    expect(updateCategorySchema.parse({ order: 4 })).toEqual({ order: 4 });
  });

  it("updateIndicatorSchema: status-only body keeps order absent", () => {
    expect(updateIndicatorSchema.parse({ status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(updateIndicatorSchema.parse({ label: "Shalat" })).toEqual({ label: "Shalat" });
  });

  it("updateEmployeeSchema: email-only body keeps bpjsEnrolled/role absent", () => {
    const data = updateEmployeeSchema.parse({ email: "a@b.co" });
    expect(data).toEqual({ email: "a@b.co" });
  });

  it("updateEmployeeSchema: explicit bpjsEnrolled=false is preserved", () => {
    expect(updateEmployeeSchema.parse({ bpjsEnrolled: false })).toEqual({ bpjsEnrolled: false });
  });

  it("employeeEditFormSchema no longer injects bpjsEnrolled", () => {
    const data = employeeEditFormSchema.parse({
      nama: "A",
      email: "a@b.co",
      jabatan: "Guru",
      campusId: "c1",
      hireDate: "2026-01-01",
    });
    expect("bpjsEnrolled" in data).toBe(false);
    expect("role" in data).toBe(false);
  });

  it("updateStudentSchema: empty body stays empty", () => {
    expect(updateStudentSchema.parse({})).toEqual({});
  });
});

describe("sweep: every exported update schema parses {} to {}", () => {
  const modules = import.meta.glob("../*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
  const updateSchemas: [string, z.ZodType][] = [];
  for (const [file, mod] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(mod)) {
      if (/^update[A-Z]\w*Schema$|^\w+UpdateSchema$/.test(name) && value instanceof z.ZodType) {
        updateSchemas.push([`${file.replace("../", "")}#${name}`, value]);
      }
    }
  }

  it("finds the update schemas", () => {
    expect(updateSchemas.length).toBeGreaterThan(5);
  });

  it.each(updateSchemas)("%s", (_label, schema) => {
    const result = schema.safeParse({});
    // A schema with required fields legitimately rejects {}; only assert on the
    // ones that accept it: they must not have invented any key.
    if (result.success) expect(result.data).toEqual({});
  });
});
