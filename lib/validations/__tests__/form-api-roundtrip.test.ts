import { describe, expect, it } from "vitest";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// ---------------------------------------------------------------------------
// Form -> wire -> server-schema round-trip tests.
//
// Every admin form migrated to react-hook-form (docs/cycles/2026-09-27-
// admin-forms-rhf.md) hands `form.handleSubmit` the FORM SCHEMA's parsed
// OUTPUT. Some pages send that output straight through as the JSON body
// (`sendJson(url, { body: values })`); others hand-build a narrower object
// from `values`. Either way, unit tests that mock `fetch` never notice a
// mismatch between what the client actually puts on the wire and what the
// API route's own schema accepts. This file replays each pair: parse a
// realistic valid form value through the CLIENT schema, build the body
// exactly as the page's submit handler does (cited by file:line), round-trip
// it through JSON (matching `lib/api/send-json.ts`'s `JSON.stringify`, which
// drops `undefined`-valued keys), then assert the SERVER schema accepts it.
// ---------------------------------------------------------------------------

function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

// ── Employees — app/admin/(hr)/employees/page.tsx:201-214 ──────────────────
// POST /api/employees uses the SAME schema object (app/api/employees/route.ts:8),
// so this is a same-schema sanity check, not a divergence risk.
describe("Employees: createEmployeeSchema (form) -> createEmployeeSchema (route)", () => {
  it("round-trips a realistic create submission, including blank leave balances", async () => {
    const { createEmployeeSchema } = await import("../employee");
    const form = createEmployeeSchema.safeParse({
      nama: "Ismail Teacher",
      formalName: "",
      email: "ismail@example.com",
      noHp: "",
      jabatan: "Guru Kelas",
      campusId: "campus-1",
      hireDate: "2026-07-01",
      bankName: "Bank BSI",
      bankAccountNo: "1234567890",
      bpjsEnrolled: false,
      leaveBalanceAnnual: "",
      leaveBalanceSick: "",
      role: "TEACHER",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    // handleSubmit sends `values` directly (page.tsx:205 `body: values`).
    const body = wire(form.data);
    const route = createEmployeeSchema.safeParse(body);
    expect(route.success).toBe(true);
  });
});

// ── Semesters — app/admin/semesters/client.tsx:140-152 ──────────────────────
describe("Semesters: semesterFormSchema (form) -> semesterCreateSchema/semesterUpdateSchema (route)", () => {
  it("create body round-trips (number coerced from the Select's string value)", async () => {
    const { semesterFormSchema, semesterCreateSchema } = await import("../curriculum");
    const form = semesterFormSchema.safeParse({
      academicYearId: "ay-1",
      number: "1", // native Select value, per client.tsx:132/54
      startDate: "2026-07-01",
      endDate: "2026-12-01",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.number).toBe(1); // transformed to the literal number
    const body = wire({
      academicYearId: form.data.academicYearId,
      number: form.data.number,
      startDate: form.data.startDate,
      endDate: form.data.endDate,
    }); // client.tsx:147-152 (create branch)
    expect(semesterCreateSchema.safeParse(body).success).toBe(true);
  });

  it("edit body (no academicYearId) round-trips against semesterUpdateSchema", async () => {
    const { semesterFormSchema, semesterUpdateSchema } = await import("../curriculum");
    const form = semesterFormSchema.safeParse({
      academicYearId: "ay-1",
      number: "2",
      startDate: "2027-01-01",
      endDate: "2027-06-01",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      number: form.data.number,
      startDate: form.data.startDate,
      endDate: form.data.endDate,
    }); // client.tsx:145-146 (edit branch)
    expect(semesterUpdateSchema.safeParse(body).success).toBe(true);
  });
});

// ── Guardians (Wali) — app/admin/guardians/page.tsx:262-274 ─────────────────
describe("Guardians: parentFormSchema (form) -> updateParentSchema (PUT /api/parents/[id])", () => {
  it("a cleared 'Jumlah anak' field (childrenTotal '') round-trips as null", async () => {
    const { parentFormSchema, updateParentSchema } = await import("../parent");
    const form = parentFormSchema.safeParse({
      name: "Budi Santoso",
      phone: "081234567890",
      email: "",
      whatsapp: "",
      address: "",
      parentNik: "",
      education: "",
      occupation: "",
      incomeRange: "",
      employer: "",
      employerAddress: "",
      employerCity: "",
      childrenTotal: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.childrenTotal).toBeNull();
    // page.tsx:266 sends `values` directly as the PUT body.
    const body = wire(form.data);
    const route = updateParentSchema.safeParse(body);
    expect(route.success).toBe(true);
  });

  it("a filled childrenTotal coerces to a number and still round-trips", async () => {
    const { parentFormSchema, updateParentSchema } = await import("../parent");
    const form = parentFormSchema.safeParse({ name: "Siti", childrenTotal: "3" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.childrenTotal).toBe(3);
    expect(updateParentSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

// ── Student-detail guardian dialog — app/admin/students/[id]/page.tsx ─────
// T3 (2026-09-27, admin-finish-standard): GuardianFormBody moved onto RHF;
// its create/edit steps each run a form schema derived from the wire schema
// they post to (lib/validations/guardian.ts). createNewParent/saveGuardian
// send `values` (the parsed output) directly as the JSON body.
describe("Student-detail guardian create: guardianCreateFormSchema (form) -> createGuardianSchema (POST .../guardians)", () => {
  it("round-trips a full submission — address/childrenTotal/childOrder included (T3 data-loss fix)", async () => {
    const { guardianCreateFormSchema, createGuardianSchema } = await import("../guardian");
    const form = guardianCreateFormSchema.safeParse({
      name: "Siti Aminah",
      relationship: "IBU",
      phone: "081234567890",
      whatsapp: "",
      email: "siti@example.test",
      parentNik: "",
      education: "",
      occupation: "",
      incomeRange: "",
      employer: "",
      employerAddress: "",
      employerCity: "",
      address: "Jl. Merdeka No. 1",
      childrenTotal: "2",
      childOrder: "1",
      isPrimary: false,
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.childrenTotal).toBe(2);
    expect(form.data.childOrder).toBe(1);
    // page.tsx's createNewParent sends `{ ...guardianCreatePayload(values), confirmNew }`;
    // isPrimary is stripped here (Switch off), confirmNew added by the handler.
    const body = wire({ ...form.data, isPrimary: undefined, confirmNew: true });
    const route = createGuardianSchema.safeParse(body);
    expect(route.success).toBe(true);
    if (!route.success) return;
    expect(route.data.address).toBe("Jl. Merdeka No. 1");
    expect(route.data.childrenTotal).toBe(2);
    expect(route.data.childOrder).toBe(1);
  });

  it("a blank childrenTotal collapses to explicit null (not 0 — lesson 3), a blank childOrder to undefined", async () => {
    const { guardianCreateFormSchema, createGuardianSchema } = await import("../guardian");
    const form = guardianCreateFormSchema.safeParse({
      name: "Budi",
      relationship: "AYAH",
      childrenTotal: "",
      childOrder: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    // childrenTotal: null (present key) so a PUT edit later can clear it
    // (lesson 2) — see childrenTotalFormField's doc comment. childOrder
    // keeps childOrderField's existing undefined-on-blank shape (shared,
    // unchanged, with linkGuardianSchema/updateGuardianSchema).
    expect(form.data.childrenTotal).toBeNull();
    expect(form.data.childOrder).toBeUndefined();
    expect(createGuardianSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

describe("Student-detail guardian edit: guardianUpdateFormSchema (form) -> updateGuardianSchema (PUT .../guardians/[guardianId])", () => {
  it("round-trips every field, including a cleared address/childrenTotal (lesson 2)", async () => {
    const { guardianUpdateFormSchema, updateGuardianSchema } = await import("../guardian");
    const form = guardianUpdateFormSchema.safeParse({
      name: "Siti Aminah",
      relationship: "IBU",
      phone: "081234567890",
      whatsapp: "",
      email: "",
      parentNik: "",
      education: "",
      occupation: "",
      incomeRange: "",
      employer: "",
      employerAddress: "",
      employerCity: "",
      address: "",
      childrenTotal: "",
      childOrder: "2",
      isPrimary: true,
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.childrenTotal).toBeNull();
    expect(form.data.childOrder).toBe(2);
    // saveGuardian (page.tsx) sends `values` directly as the PUT body.
    const route = updateGuardianSchema.safeParse(wire(form.data));
    expect(route.success).toBe(true);
    if (!route.success) return;
    expect(route.data.address).toBe("");
    expect(route.data.childrenTotal).toBeNull();
  });

  it("a cleared Anak ke- is sent as null (a clear), not dropped", async () => {
    const { guardianUpdateFormSchema, updateGuardianSchema } = await import("../guardian");
    const form = guardianUpdateFormSchema.safeParse({ name: "Siti", relationship: "IBU", childOrder: "" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire(form.data) as Record<string, unknown>;
    expect("childOrder" in body).toBe(true);
    expect(body.childOrder).toBeNull();
    const route = updateGuardianSchema.safeParse(body);
    expect(route.success && route.data.childOrder).toBeNull();
  });

  it("a cleared Nama is rejected client-side with an inline message, not silently sent", async () => {
    const { guardianUpdateFormSchema } = await import("../guardian");
    const form = guardianUpdateFormSchema.safeParse({ name: "", relationship: "IBU" });
    expect(form.success).toBe(false);
    if (form.success) return;
    expect(form.error.issues.some((i) => i.path.join(".") === "name" && i.message.includes("wajib diisi"))).toBe(true);
  });
});

// ── Payroll — app/admin/(hr)/payroll/[id]/page.tsx ──────────────────────────
describe("Payroll variables: payrollVariablesSchema (form) -> payrollVariablesSchema (route, same object)", () => {
  it("a fully-blanked variables form collapses every field to 0 and round-trips", async () => {
    const { payrollVariablesSchema } = await import("../payroll");
    const form = payrollVariablesSchema.safeParse({
      overtimeHours: "",
      outdoorDays: "",
      holidayWorkedDays: "",
      dcDays: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data).toEqual({ overtimeHours: 0, outdoorDays: 0, holidayWorkedDays: 0, dcDays: 0 });
    // page.tsx:155 sends `values` directly.
    expect(payrollVariablesSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

describe("Payroll line adjustment: adjustPayrollLineFormSchema (form) -> adjustPayrollLineSchema (route)", () => {
  it("a string amount from <Input type=number> coerces to a plain number", async () => {
    const { adjustPayrollLineFormSchema, adjustPayrollLineSchema } = await import("../payroll");
    const form = adjustPayrollLineFormSchema.safeParse({
      adjustmentAmount: "150000",
      adjustmentNote: "Koreksi lembur",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.adjustmentAmount).toBe(150000);
    // page.tsx:178 sends `values` directly.
    expect(adjustPayrollLineSchema.safeParse(wire(form.data)).success).toBe(true);
  });

  it("a blank amount collapses to 0, which the route's z.number() still accepts", async () => {
    const { adjustPayrollLineFormSchema, adjustPayrollLineSchema } = await import("../payroll");
    const form = adjustPayrollLineFormSchema.safeParse({ adjustmentAmount: "", adjustmentNote: "Batal" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.adjustmentAmount).toBe(0);
    expect(adjustPayrollLineSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

describe("Payroll generate: generatePayrollSchema (form) -> generatePayrollSchema (route, same object)", () => {
  it("round-trips a valid period", async () => {
    const { generatePayrollSchema } = await import("../payroll");
    const form = generatePayrollSchema.safeParse({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(generatePayrollSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

describe("Salary components: salaryComponentFormSchema (form) -> createSalaryComponentSchema (POST) / inline PUT", () => {
  it("a create submission with sortOrder as a string round-trips against POST's schema", async () => {
    const { salaryComponentFormSchema, createSalaryComponentSchema } = await import("../payroll");
    const form = salaryComponentFormSchema.safeParse({
      code: "tunjangan_baru",
      label: "Tunjangan Baru",
      category: "INCOME",
      calcType: "FIXED",
      isProRated: false,
      sortOrder: "4",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.sortOrder).toBe(4);
    // page.tsx:93-97 sends `values` directly for both create and edit.
    expect(createSalaryComponentSchema.safeParse(wire(form.data)).success).toBe(true);
  });

  it("F-15 (was a documented gap): a create submission with calcType PCT_OF_BASE is now " +
    "accepted by createSalaryComponentSchema — the ordering rule against `gaji_pokok` is " +
    "enforced by the route (checkSalaryComponentOrdering), not by the zod schema", async () => {
    const { salaryComponentFormSchema, createSalaryComponentSchema } = await import("../payroll");
    const form = salaryComponentFormSchema.safeParse({
      code: "insentif",
      label: "Insentif",
      category: "INCOME",
      calcType: "PCT_OF_BASE",
      sortOrder: "5",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(createSalaryComponentSchema.safeParse(wire(form.data)).success).toBe(true);
  });

  it("edit PUT now validates with updateSalaryComponentSchema (salary-components/[id]/route.ts) " +
    "and accepts the full form output, ignoring the unused 'code' key", async () => {
    const { salaryComponentFormSchema, updateSalaryComponentSchema } = await import("../payroll");
    const form = salaryComponentFormSchema.safeParse({
      code: "spp", // present in the form's defaultValues even though the field is hidden on edit
      label: "SPP",
      category: "DEDUCTION",
      calcType: "PCT_OF_BASE",
      isProRated: true,
      sortOrder: "2",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const parsed = updateSalaryComponentSchema.safeParse(wire(form.data));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // `code` is not part of the PUT schema — zod strips it, matching the
    // route's existing behaviour of never reading it from the body.
    expect(parsed.data).not.toHaveProperty("code");
  });

  it("the { isEnabled }-only toggle body still round-trips through updateSalaryComponentSchema", async () => {
    const { updateSalaryComponentSchema } = await import("../payroll");
    const parsed = updateSalaryComponentSchema.safeParse(wire({ isEnabled: false }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({ isEnabled: false });
  });
});

// ── Settings / Users — app/admin/settings/users/page.tsx:300-314 ───────────
describe("Users: userEditFormSchema (form) -> updateUserSchema (PUT /api/users/[id])", () => {
  it("the 'none' role sentinel is mapped to null before the wire, and round-trips", async () => {
    const { userEditFormSchema, updateUserSchema } = await import("../user");
    const form = userEditFormSchema.safeParse({ customRoleId: "none", status: "ACTIVE" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      customRoleId: form.data.customRoleId === "none" ? null : form.data.customRoleId,
      status: form.data.status,
    }); // page.tsx:307-310
    expect(updateUserSchema.safeParse(body).success).toBe(true);
  });

  it("a real role id passes through unmapped", async () => {
    const { userEditFormSchema, updateUserSchema } = await import("../user");
    const form = userEditFormSchema.safeParse({ customRoleId: "role-123", status: "INACTIVE" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      customRoleId: form.data.customRoleId === "none" ? null : form.data.customRoleId,
      status: form.data.status,
    });
    expect(updateUserSchema.safeParse(body).success).toBe(true);
  });
});

// ── Settings / Work hours — app/admin/settings/work-hours/page.tsx:76-84 ───
describe("Org config: orgConfigSchema (form) -> orgConfigSchema (route, same object)", () => {
  it("round-trips string-coerced numeric fields", async () => {
    const { orgConfigSchema } = await import("../org-config");
    const form = orgConfigSchema.safeParse({
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      workStartTime: "07:00",
      workEndTime: "16:00",
      gracePeriodMinutes: "15",
      timezone: "Asia/Jakarta",
      payrollPeriodStartDay: "21",
      payrollPeriodEndDay: "20",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(orgConfigSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

// ── Settings / Campuses — app/admin/settings/campuses/page.tsx:100-113 ─────
describe("Campuses: createCampusSchema (form, reused for edit) -> createCampusSchema (POST) / updateCampusSchema (PUT)", () => {
  it("create round-trips with blank lat/lng collapsing to undefined", async () => {
    const { createCampusSchema } = await import("../campus");
    const form = createCampusSchema.safeParse({ name: "Taman Aster", address: "", lat: "", lng: "" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.lat).toBeUndefined();
    expect(createCampusSchema.safeParse(wire(form.data)).success).toBe(true);
  });

  it("edit (same form schema) round-trips against updateCampusSchema", async () => {
    const { createCampusSchema, updateCampusSchema } = await import("../campus");
    const form = createCampusSchema.safeParse({
      name: "Taman Aster",
      address: "Jl. Contoh No.1",
      lat: "-6.2234",
      lng: "106.8432",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(typeof form.data.lat).toBe("number");
    expect(updateCampusSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

// ── Settings / Holidays — app/admin/settings/holidays/page.tsx:74-84 ───────
describe("Holidays: holidaySchema (form) -> holidaySchema (route, same object)", () => {
  it("round-trips a create/edit submission", async () => {
    const { holidaySchema } = await import("../holiday");
    const form = holidaySchema.safeParse({ date: "2026-12-25", name: "Natal", type: "NATIONAL", isHalfDay: false });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(holidaySchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

// ── Settings / Roles — app/admin/settings/roles/page.tsx:337-353 ──────────
describe("Roles: roleFormSchema (form) -> createRoleSchema/updateRoleSchema (route) + raw-body permissions", () => {
  it("create body round-trips; `permissions` is read from the raw body, not the validated schema", async () => {
    const { roleFormSchema, createRoleSchema } = await import("../role");
    const form = roleFormSchema.safeParse({
      name: "Finance Admin",
      code: "FINANCE_ADMIN",
      description: "",
      permissions: ["invoices.view", "payroll.view"],
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      name: form.data.name,
      code: form.data.code,
      description: form.data.description,
      permissions: form.data.permissions,
    }); // page.tsx:344 (create branch)
    expect(createRoleSchema.safeParse(body).success).toBe(true);
    // Route reads `body.permissions` off the raw JSON directly (roles/route.ts:48).
    expect(Array.isArray((body as { permissions: unknown }).permissions)).toBe(true);
  });

  it("edit body (no code) round-trips against updateRoleSchema", async () => {
    const { roleFormSchema, updateRoleSchema } = await import("../role");
    const form = roleFormSchema.safeParse({
      name: "Finance Admin",
      code: "FINANCE_ADMIN", // required by the schema even though the edit dialog hides the field
      description: "Updated",
      permissions: [],
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ name: form.data.name, description: form.data.description, permissions: form.data.permissions }); // page.tsx:343
    expect(updateRoleSchema.safeParse(body).success).toBe(true);
  });
});

// ── Academic years / Programs / Roll-forward — app/admin/academic-years/page.tsx ─
describe("Academic years: academicYearFormSchema (form) -> createAcademicYearSchema (POST) / updateAcademicYearSchema (PUT)", () => {
  it("round-trips for both create and edit (same body shape sent either way)", async () => {
    const { academicYearFormSchema, createAcademicYearSchema, updateAcademicYearSchema } = await import(
      "../academic-year"
    );
    const form = academicYearFormSchema.safeParse({
      name: "2026/2027",
      startDate: "2026-07-01",
      endDate: "2027-06-30",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire(form.data); // page.tsx:108 sends `values` directly
    expect(createAcademicYearSchema.safeParse(body).success).toBe(true);
    expect(updateAcademicYearSchema.safeParse(body).success).toBe(true);
  });
});

describe("Programs: programFormSchema (form) -> createProgramSchema (POST) / updateProgramSchema (PUT)", () => {
  it("blank Usia Min/Max collapse to null (not 0) and round-trip", async () => {
    const { programFormSchema, createProgramSchema, updateProgramSchema } = await import("../program");
    const form = programFormSchema.safeParse({
      code: "TKIT",
      name: "TK Islam Terpadu",
      description: "",
      type: "SEMESTER",
      ageMin: "",
      ageMax: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.ageMin).toBeNull();
    const body = wire(form.data); // page.tsx:125 sends `values` directly
    expect(createProgramSchema.safeParse(body).success).toBe(true);
    expect(updateProgramSchema.safeParse(body).success).toBe(true);
  });

  it("a filled age in months (>30, previously out of range for a years-based bound) round-trips", async () => {
    const { programFormSchema, createProgramSchema } = await import("../program");
    const form = programFormSchema.safeParse({
      code: "TKIT",
      name: "TK Islam Terpadu",
      type: "SEMESTER",
      ageMin: "48",
      ageMax: "84",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.ageMax).toBe(84);
    expect(createProgramSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

describe("Roll forward: rollForwardSchema (form) -> rollForwardSchema (route, same object)", () => {
  it("round-trips with the hard-coded empty trackIds array", async () => {
    const { rollForwardSchema } = await import("../roll-forward");
    const form = rollForwardSchema.safeParse({ sourceYearId: "ay-2025" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ sourceYearId: form.data.sourceYearId, trackIds: [] }); // page.tsx:175
    expect(rollForwardSchema.safeParse(body).success).toBe(true);
  });
});

// ── Class detail dossier — app/admin/classes/[id]/client.tsx ───────────────
describe("Class roster: enrollmentAddSchema (form) -> enrollmentAddWithOverrideSchema (route, extends it)", () => {
  it("a plain enroll (no age override) round-trips", async () => {
    const { enrollmentAddSchema } = await import("../class");
    const form = enrollmentAddSchema.safeParse({ studentId: "student-1" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ studentId: form.data.studentId }); // client.tsx:472
    expect(enrollmentAddSchema.safeParse(body).success).toBe(true);
  });
});

describe("Teaching assignments: teachingAssignmentAddSchema (form) -> teachingAssignmentAddSchema (route, same object)", () => {
  it("round-trips employeeId + role", async () => {
    const { teachingAssignmentAddSchema } = await import("../class");
    const form = teachingAssignmentAddSchema.safeParse({ employeeId: "emp-1", role: "HOMEROOM" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ employeeId: form.data.employeeId, role: form.data.role }); // client.tsx:535-537
    expect(teachingAssignmentAddSchema.safeParse(body).success).toBe(true);
  });
});

// ── Class-session swap — components/admin/classes/detail/swap-session-dialog.tsx ─
describe("Class-session swap: swapClassSessionTeacherFormSchema (form) -> swapClassSessionTeacherSchema (route)", () => {
  // T2 (2026-09-27 admin-finish-standard): Simpan now submits through
  // `swapForm.handleSubmit`, so `swapClassSessionTeacherFormSchema`'s
  // reason-required superRefine actually runs before the PATCH body is
  // built (swap-session-dialog.tsx's `submitSwap`). `defaultTeacherId` is a
  // hidden, form-only field never sent to the API.
  it("a revert to homeroom (teacherId === defaultTeacherId) needs no reason and round-trips", async () => {
    const { swapClassSessionTeacherFormSchema, swapClassSessionTeacherSchema } = await import(
      "../class-session"
    );
    const form = swapClassSessionTeacherFormSchema.safeParse({
      teacherId: "emp-1",
      substituteReason: "",
      defaultTeacherId: "emp-1",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      teacherId: form.data.teacherId || null,
      substituteReason: form.data.substituteReason || undefined,
    }); // swap-session-dialog.tsx submitSwap
    expect(swapClassSessionTeacherSchema.safeParse(body).success).toBe(true);
  });

  it("a genuine substitution with a reason round-trips", async () => {
    const { swapClassSessionTeacherFormSchema, swapClassSessionTeacherSchema } = await import(
      "../class-session"
    );
    const form = swapClassSessionTeacherFormSchema.safeParse({
      teacherId: "emp-2",
      substituteReason: "Sakit",
      defaultTeacherId: "emp-1",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      teacherId: form.data.teacherId || null,
      substituteReason: form.data.substituteReason || undefined,
    });
    expect(swapClassSessionTeacherSchema.safeParse(body).success).toBe(true);
  });

  it("a genuine substitution with no reason is rejected client-side before it ever reaches the wire", async () => {
    const { swapClassSessionTeacherFormSchema } = await import("../class-session");
    const form = swapClassSessionTeacherFormSchema.safeParse({
      teacherId: "emp-2",
      defaultTeacherId: "emp-1",
    });
    expect(form.success).toBe(false);
  });
});

// ── Ubah Kelas (class detail) — components/admin/classes/detail/edit-class-dialog.tsx ─
describe("Class detail edit: classEditFormSchema (form) -> classUpdateSchema (route)", () => {
  it("round-trips name/capacity/slotTemplate with capacity coerced from a string input", async () => {
    const { classEditFormSchema, classUpdateSchema } = await import("../class");
    const form = classEditFormSchema.safeParse({
      name: "KB 1",
      capacity: "25",
      slotTemplate: "MORNING_AND_AFTERNOON",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.capacity).toBe(25);
    const body = wire({
      name: form.data.name,
      capacity: form.data.capacity,
      slotTemplate: form.data.slotTemplate,
    }); // edit-class-dialog.tsx's `save`
    expect(classUpdateSchema.safeParse(body).success).toBe(true);
  });

  it("a blanked capacity fails client-side with a 'wajib diisi' message, not a silent 0", async () => {
    const { classEditFormSchema } = await import("../class");
    const form = classEditFormSchema.safeParse({
      name: "KB 1",
      capacity: "",
      slotTemplate: "FULL_DAY",
    });
    expect(form.success).toBe(false);
    if (form.success) return;
    expect(form.error.issues.some((i) => i.message.includes("wajib diisi"))).toBe(true);
  });
});

// ── Classes list — app/admin/classes/client.tsx:202-224 ─────────────────────
describe("Classes: classFormSchema (form) -> classCreateSchema (POST) / classUpdateSchema (PATCH)", () => {
  it("create round-trips with capacity coerced from a string input", async () => {
    const { classFormSchema, classCreateSchema } = await import("../class");
    const form = classFormSchema.safeParse({
      campusId: "campus-1",
      programId: "program-1",
      name: "Kelas A1",
      capacity: "20",
      slotTemplate: "FULL_DAY",
      ageGroup: "A",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.capacity).toBe(20);
    const body = wire({
      campusId: form.data.campusId,
      programId: form.data.programId,
      academicYearId: "ay-1", // spliced in from the page's year switcher, client.tsx:217
      name: form.data.name,
      capacity: form.data.capacity,
      slotTemplate: form.data.slotTemplate,
      ageGroup: form.data.ageGroup,
    });
    expect(classCreateSchema.safeParse(body).success).toBe(true);
  });

  it("edit round-trips against classUpdateSchema", async () => {
    const { classFormSchema, classUpdateSchema } = await import("../class");
    const form = classFormSchema.safeParse({
      campusId: "campus-1",
      programId: "program-1",
      name: "Kelas A1",
      capacity: "25",
      slotTemplate: "MORNING_AND_AFTERNOON",
      ageGroup: "B",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      name: form.data.name,
      capacity: form.data.capacity,
      slotTemplate: form.data.slotTemplate,
      ageGroup: form.data.ageGroup,
    }); // client.tsx:208-213
    expect(classUpdateSchema.safeParse(body).success).toBe(true);
  });
});

// ── Students — app/admin/students/page.tsx:644-676 ─────────────────────────
describe("Students: studentFormSchema (form, shared create+edit) -> createStudentSchema (POST) / updateStudentSchema (PUT)", () => {
  it("create round-trips, blanked optional fields becoming explicit null", async () => {
    const { studentFormSchema, createStudentSchema } = await import("../student");
    const form = studentFormSchema.safeParse({
      name: "Ahmad",
      nickname: "",
      dateOfBirth: "",
      gender: "",
      address: "",
      notes: "",
      nis: "",
      nisn: "",
      birthPlace: "",
      nik: "",
      kkNumber: "",
      livingWith: "",
      status: "ACTIVE",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.nickname).toBeNull();
    expect(form.data.gender).toBeNull();
    const body = wire(form.data); // page.tsx:665 sends `values` directly
    expect(createStudentSchema.safeParse(body).success).toBe(true);
  });

  it("edit round-trips against updateStudentSchema, including an explicit-null clear", async () => {
    const { studentFormSchema, updateStudentSchema } = await import("../student");
    const form = studentFormSchema.safeParse({
      name: "Ahmad",
      nickname: null,
      dateOfBirth: "2020-01-15",
      gender: "L",
      address: "Jl. Merdeka",
      notes: null,
      nis: "12345",
      nisn: null,
      birthPlace: "Bekasi",
      nik: null,
      kkNumber: null,
      livingWith: null,
      status: "ACTIVE",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire(form.data); // page.tsx:649 sends `values` directly
    expect(updateStudentSchema.safeParse(body).success).toBe(true);
  });
});

// ── Student journal — app/admin/student-journal/page.tsx ──────────────────
describe("Student journal categories: categoryFormSchema (form) -> createCategorySchema / updateCategorySchema", () => {
  it("create round-trips with the spliced-in `order`", async () => {
    const { categoryFormSchema, createCategorySchema } = await import("../student-journal");
    const form = categoryFormSchema.safeParse({ name: "Ibadah", scope: "SCHOOL" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ name: form.data.name, scope: form.data.scope, order: 3 }); // page.tsx:113
    expect(createCategorySchema.safeParse(body).success).toBe(true);
  });

  it("edit round-trips (name + scope only)", async () => {
    const { categoryFormSchema, updateCategorySchema } = await import("../student-journal");
    const form = categoryFormSchema.safeParse({ name: "Ibadah", scope: "HOME" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ name: form.data.name, scope: form.data.scope }); // page.tsx:112
    expect(updateCategorySchema.safeParse(body).success).toBe(true);
  });
});

describe("Student journal indicators: indicatorFormSchema (form) -> createIndicatorSchema / updateIndicatorSchema", () => {
  it("create round-trips with categoryId + order spliced in", async () => {
    const { indicatorFormSchema, createIndicatorSchema } = await import("../student-journal");
    const form = indicatorFormSchema.safeParse({ label: "Sholat 5 waktu" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ categoryId: "cat-1", label: form.data.label, order: 0 }); // page.tsx:158
    expect(createIndicatorSchema.safeParse(body).success).toBe(true);
  });

  it("edit round-trips (label only)", async () => {
    const { indicatorFormSchema, updateIndicatorSchema } = await import("../student-journal");
    const form = indicatorFormSchema.safeParse({ label: "Sholat 5 waktu" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ label: form.data.label }); // page.tsx:159
    expect(updateIndicatorSchema.safeParse(body).success).toBe(true);
  });
});

// ── Admissions — app/admin/admissions/page.tsx:696-708 ──────────────────────
describe("Admissions: createAdmissionSchema (form, reused for edit) -> createAdmissionSchema (POST) / updateAdmissionSchema (PUT)", () => {
  it("round-trips a minimal valid create submission", async () => {
    const { createAdmissionSchema } = await import("../admission");
    const form = createAdmissionSchema.safeParse({
      childName: "Aisyah",
      parentName: "Budi",
      parentEmail: "",
      source: "WALK_IN",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(createAdmissionSchema.safeParse(wire(form.data)).success).toBe(true);
  });

  it("the same form output round-trips as a PUT edit body against updateAdmissionSchema", async () => {
    const { createAdmissionSchema, updateAdmissionSchema } = await import("../admission");
    const form = createAdmissionSchema.safeParse({
      childName: "Aisyah",
      parentName: "Budi",
      parentEmail: "budi@example.com",
      source: "WEBSITE",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(updateAdmissionSchema.safeParse(wire(form.data)).success).toBe(true);
  });
});

// ── Keringanan (fee adjustments) — components/admin/fees/keringanan-tab.tsx ─
describe("Keringanan: keringananFormSchema (form) -> createStudentFeeAdjustmentSchema (POST) / updateStudentFeeAdjustmentSchema (PUT)", () => {
  it("create body (hand-built, excludes `isEditing`) round-trips", async () => {
    const { keringananFormSchema, createStudentFeeAdjustmentSchema } = await import(
      "../student-fee-adjustment"
    );
    const form = keringananFormSchema.safeParse({
      isEditing: false,
      studentId: "student-1",
      academicYearId: "ay-1",
      feeComponentId: "fee-1",
      type: "DISCOUNT",
      mode: "PERCENT",
      value: "50",
      reason: "Anak yatim",
      validFrom: "",
      validTo: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.value).toBe(50);
    const body = wire({
      studentId: form.data.studentId,
      academicYearId: form.data.academicYearId,
      feeComponentId: form.data.feeComponentId,
      type: form.data.type,
      mode: form.data.mode,
      value: form.data.value,
      reason: form.data.reason,
      ...(form.data.validFrom ? { validFrom: form.data.validFrom } : {}),
      ...(form.data.validTo ? { validTo: form.data.validTo } : {}),
    }); // keringanan-tab.tsx:313-324
    expect("isEditing" in (body as object)).toBe(false);
    expect(createStudentFeeAdjustmentSchema.safeParse(body).success).toBe(true);
  });

  it("edit body sends explicit null dates (not omitted) and round-trips", async () => {
    const { keringananFormSchema, updateStudentFeeAdjustmentSchema } = await import(
      "../student-fee-adjustment"
    );
    const form = keringananFormSchema.safeParse({
      isEditing: true,
      studentId: "student-1",
      academicYearId: "ay-1",
      feeComponentId: "fee-1",
      type: "DISCOUNT",
      mode: "FIXED",
      value: "100000",
      reason: "Koreksi",
      validFrom: "",
      validTo: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      mode: form.data.mode,
      value: form.data.value,
      reason: form.data.reason,
      validFrom: form.data.validFrom ?? null,
      validTo: form.data.validTo ?? null,
    }); // keringanan-tab.tsx:295-304
    expect((body as { validFrom: unknown }).validFrom).toBeNull();
    expect(updateStudentFeeAdjustmentSchema.safeParse(body).success).toBe(true);
  });
});

// ── Manual invoice — components/admin/invoices/manual-invoice-dialog.tsx ───
describe("Manual invoice: manualInvoiceFormSchema (form) -> createManualInvoiceSchema (POST /api/invoices)", () => {
  it("round-trips a create submission with a filled RupiahInput amount", async () => {
    const { manualInvoiceFormSchema, createManualInvoiceSchema } = await import("../invoice");
    const form = manualInvoiceFormSchema.safeParse({
      studentId: "student-1",
      periodLabel: "September 2026",
      dueDate: "2026-09-30",
      lines: [{ feeComponentId: "fee-1", amount: 500000 }],
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      studentId: form.data.studentId,
      periodLabel: form.data.periodLabel,
      dueDate: form.data.dueDate,
      lines: form.data.lines,
    }); // manual-invoice-dialog.tsx:162-167
    expect(createManualInvoiceSchema.safeParse(body).success).toBe(true);
  });

  it("a not-yet-filled amount (null) is rejected client-side before it ever reaches the wire", async () => {
    const { manualInvoiceFormSchema } = await import("../invoice");
    const form = manualInvoiceFormSchema.safeParse({
      studentId: "student-1",
      periodLabel: "September 2026",
      dueDate: "2026-09-30",
      lines: [{ feeComponentId: "fee-1", amount: null }],
    });
    expect(form.success).toBe(false);
  });
});

// ── Student enroll dialog — components/admin/student-enroll-dialog.tsx ─────
describe("Student enroll dialog: enrollStudentFormSchema (form) -> enrollStudentSchema (POST /api/students/[id]/enroll)", () => {
  it("a plain enroll (no age override) round-trips", async () => {
    const { enrollStudentFormSchema, enrollStudentSchema } = await import("../student");
    const form = enrollStudentFormSchema.safeParse({ classSectionId: "section-1", ageOverrideReason: "" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ classSectionId: form.data.classSectionId }); // dialog.tsx:123-126 (no override branch)
    expect(enrollStudentSchema.safeParse(body).success).toBe(true);
  });

  it("an age-override retry with a reason round-trips", async () => {
    const { enrollStudentFormSchema, enrollStudentSchema } = await import("../student");
    const form = enrollStudentFormSchema.safeParse({
      classSectionId: "section-1",
      ageOverrideReason: "Penempatan sesuai kemampuan anak",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({
      classSectionId: form.data.classSectionId,
      ageOverrideReason: form.data.ageOverrideReason,
    }); // dialog.tsx:123-126 (override branch)
    expect(enrollStudentSchema.safeParse(body).success).toBe(true);
  });
});

// ── Student attendance override — app/admin/student-attendance/page.tsx ───
describe("Student attendance override: updateStudentAttendanceSchema (form) -> updateStudentAttendanceSchema (route, same object)", () => {
  it("round-trips with a blank note becoming null", async () => {
    const { updateStudentAttendanceSchema } = await import("../student-attendance");
    const form = updateStudentAttendanceSchema.safeParse({ status: "SICK", notes: "" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ status: form.data.status, notes: form.data.notes || null }); // page.tsx:303
    expect(updateStudentAttendanceSchema.safeParse(body).success).toBe(true);
  });
});

// ── Leave requests — app/admin/(hr)/leave-requests/page.tsx:327-342 ─────────
describe("Leave review: leaveReviewFormSchema (form) -> inline (POST .../approve) / rejectLeaveRequestSchema (POST .../reject)", () => {
  it("approve sends { note } to a route that reads body.note inline (no schema) — any shape is accepted", async () => {
    const { leaveReviewFormSchema } = await import("../leave");
    const form = leaveReviewFormSchema.safeParse({ action: "approve", note: "" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ note: form.data.note }); // page.tsx:332
    // approve/route.ts:69 does `body.note?.trim() || null` with no zod schema.
    expect(typeof (body as { note?: unknown }).note === "string" || (body as { note?: unknown }).note === undefined).toBe(true);
  });

  it("reject requires a non-empty note client-side, matching rejectLeaveRequestSchema", async () => {
    const { leaveReviewFormSchema, rejectLeaveRequestSchema } = await import("../leave");
    const rejectNoNote = leaveReviewFormSchema.safeParse({ action: "reject", note: "" });
    expect(rejectNoNote.success).toBe(false); // client-side superRefine catches this first

    const rejectWithNote = leaveReviewFormSchema.safeParse({ action: "reject", note: "Kuota cuti habis" });
    expect(rejectWithNote.success).toBe(true);
    if (!rejectWithNote.success) return;
    const body = wire({ note: rejectWithNote.data.note }); // page.tsx:332
    expect(rejectLeaveRequestSchema.safeParse(body).success).toBe(true);
  });
});

// ── Payroll period edit — app/admin/(hr)/payroll/[id]/page.tsx:312-314 ──────
describe("Payroll period edit: payrollEditFormSchema (form) -> updatePayrollRunSchema (PUT /api/payroll/[id])", () => {
  it("round-trips all three fields (the card always sends a full body, never a patch)", async () => {
    const { payrollEditFormSchema, updatePayrollRunSchema } = await import("../payroll");
    const form = payrollEditFormSchema.safeParse({
      periodStart: "2026-08-21",
      periodEnd: "2026-09-20",
      actualWorkDays: "22",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.actualWorkDays).toBe(22);
    const body = wire(form.data); // page.tsx:314 sends `values` directly
    expect(updatePayrollRunSchema.safeParse(body).success).toBe(true);
  });

  it("a blank actualWorkDays is rejected client-side (not silently coerced to 0)", async () => {
    const { payrollEditFormSchema } = await import("../payroll");
    const form = payrollEditFormSchema.safeParse({
      periodStart: "2026-08-21",
      periodEnd: "2026-09-20",
      actualWorkDays: "",
    });
    expect(form.success).toBe(false);
  });
});

// ── Employee profile edit — app/admin/(hr)/employees/[id]/page.tsx:146-148 ──
describe("Employee profile edit: employeeEditFormSchema (form) -> updateEmployeeSchema (PUT /api/employees/[id])", () => {
  it("round-trips a full edit submission, `role` never appearing on the wire", async () => {
    const { employeeEditFormSchema, updateEmployeeSchema } = await import("../employee");
    const form = employeeEditFormSchema.safeParse({
      nama: "Budi Santoso",
      formalName: "",
      email: "budi@example.com",
      noHp: "",
      jabatan: "Guru Kelas",
      campusId: "campus-1",
      hireDate: "2022-01-10",
      bankName: "BCA",
      bankAccountNo: "1234567890",
      bpjsEnrolled: true,
      leaveBalanceAnnual: "12",
      leaveBalanceSick: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect("role" in form.data).toBe(false);
    // page.tsx:148 sends `values` directly.
    const body = wire(form.data);
    expect("role" in (body as object)).toBe(false);
    expect(updateEmployeeSchema.safeParse(body).success).toBe(true);
  });

  it("a bank name with no account number is rejected on the same field the wire schema flags", async () => {
    const { employeeEditFormSchema } = await import("../employee");
    const form = employeeEditFormSchema.safeParse({
      nama: "Budi Santoso",
      email: "budi@example.com",
      jabatan: "Guru Kelas",
      campusId: "campus-1",
      hireDate: "2022-01-10",
      bankName: "BCA",
      bankAccountNo: "",
    });
    expect(form.success).toBe(false);
    if (form.success) return;
    expect(form.error.issues.some((i) => i.path.join(".") === "bankAccountNo")).toBe(true);
  });
});

// ── Invoice record payment — app/admin/invoices/[id]/page.tsx:148-150 ───────
describe("Invoice record payment: invoicePaymentFormSchema (form) -> recordPaymentSchema (POST .../payments)", () => {
  it("round-trips a filled RupiahInput amount", async () => {
    const { invoicePaymentFormSchema, recordPaymentSchema } = await import("../invoice");
    const form = invoicePaymentFormSchema.safeParse({
      amount: 500000,
      method: "CASH",
      reference: "",
      notes: "",
      paidAt: getTodayInTimezone("Asia/Jakarta"),
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire(form.data); // page.tsx:150 sends `values` directly
    expect(recordPaymentSchema.safeParse(body).success).toBe(true);
  });

  it("a not-yet-filled amount (null) is rejected client-side before it ever reaches the wire", async () => {
    const { invoicePaymentFormSchema } = await import("../invoice");
    const form = invoicePaymentFormSchema.safeParse({ amount: null, method: "CASH" });
    expect(form.success).toBe(false);
    if (form.success) return;
    expect(form.error.issues[0]?.message).toBe("Jumlah pembayaran wajib diisi");
  });
});

// ── Curriculum objectives — app/admin/semesters/[id]/objectives/client.tsx ──
describe("TP edit: objectiveEditFormSchema (form) -> objectiveUpdateSchema (PUT .../objectives/[id])", () => {
  it("round-trips both fields, trimmed", async () => {
    const { objectiveEditFormSchema, objectiveUpdateSchema } = await import("../curriculum");
    const form = objectiveEditFormSchema.safeParse({
      competencyText: "  Anak mengenal konsep sains sederhana  ",
      content: "Anak dapat mengamati perubahan benda",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.competencyText).toBe("Anak mengenal konsep sains sederhana");
    const body = wire(form.data); // client.tsx:685 sends `values` directly
    expect(objectiveUpdateSchema.safeParse(body).success).toBe(true);
  });
});

describe("Tambah IKTP: indicatorAddFormSchema (form) -> indicatorAdminCreateSchema (POST .../indicators)", () => {
  it("round-trips with objectiveId spliced in and order coerced from a string", async () => {
    const { indicatorAddFormSchema, indicatorAdminCreateSchema } = await import("../curriculum");
    const form = indicatorAddFormSchema.safeParse({ content: "Anak mampu berhitung 1-10", order: "3" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.order).toBe(3);
    // client.tsx:764 splices `objectiveId` (a prop, not a form field) into the body.
    const body = wire({ ...form.data, objectiveId: "obj-1" });
    expect(indicatorAdminCreateSchema.safeParse(body).success).toBe(true);
  });

  it("a blank order is rejected client-side, not silently defaulted to 1", async () => {
    const { indicatorAddFormSchema } = await import("../curriculum");
    const form = indicatorAddFormSchema.safeParse({ content: "Anak mampu berhitung 1-10", order: "" });
    expect(form.success).toBe(false);
    if (form.success) return;
    expect(form.error.issues[0]?.message).toBe("Urutan wajib diisi");
  });
});

describe("Edit IKTP: indicatorEditFormSchema (form) -> indicatorUpdateSchema (PUT .../indicators/[id])", () => {
  it("round-trips content + a coerced order", async () => {
    const { indicatorEditFormSchema, indicatorUpdateSchema } = await import("../curriculum");
    const form = indicatorEditFormSchema.safeParse({ content: "Anak mampu menyebutkan angka 1-10", order: "5" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.order).toBe(5);
    const body = wire(form.data); // client.tsx:838 sends `values` directly
    expect(indicatorUpdateSchema.safeParse(body).success).toBe(true);
  });
});

// =============================================================================
// T4 (2026-09-27, admin-finish-standard) — students/[id] dossier split.
// Appended at the end of the file per the cycle's parallel-editing brief:
// touches nothing above this marker.
// =============================================================================

// ── Data Anak inline edit — components/admin/students/detail/
//    data-anak-section.tsx, saveDataAnak in app/admin/students/[id]/page.tsx ─
describe("Data Anak edit: studentDetailEditFormSchema (form) -> updateStudentSchema (PUT .../students/[id])", () => {
  it("round-trips a no-gender student, sending gender: null (not \"\") — the bug this schema fixes", async () => {
    const { studentDetailEditFormSchema, updateStudentSchema } = await import("../student");
    const form = studentDetailEditFormSchema.safeParse({
      name: "Ahmad",
      nickname: "",
      dateOfBirth: "",
      gender: "",
      address: "",
      notes: "",
      nis: "",
      nisn: "",
      birthPlace: "",
      nik: "",
      kkNumber: "",
      livingWith: "",
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.gender).toBeNull();
    const body = wire(form.data); // page.tsx saveDataAnak sends `values` directly
    expect(updateStudentSchema.safeParse(body).success).toBe(true);
    // The pre-fix bug: sending the literal string "" instead of null is what
    // `updateStudentSchema`'s `z.enum(["L","P"]).optional().nullable()` rejects.
    expect(
      updateStudentSchema.safeParse({ ...(body as Record<string, unknown>), gender: "" }).success,
    ).toBe(false);
  });

  it("round-trips a filled-in edit, including an explicit-null clear of an official-id field", async () => {
    const { studentDetailEditFormSchema, updateStudentSchema } = await import("../student");
    const form = studentDetailEditFormSchema.safeParse({
      name: "Ahmad",
      nickname: null,
      dateOfBirth: "2020-01-15",
      gender: "L",
      address: "Jl. Merdeka",
      notes: null,
      nis: "12345",
      nisn: null,
      birthPlace: "Bekasi",
      nik: null,
      kkNumber: null,
      livingWith: null,
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire(form.data);
    expect(updateStudentSchema.safeParse(body).success).toBe(true);
    // No `status` key at all — the inline edit never shows that field.
    expect("status" in (body as Record<string, unknown>)).toBe(false);
  });
});

// ── Withdrawal reason inline edit — components/admin/students/detail/
//    riwayat-status-section.tsx ────────────────────────────────────────────
describe("Withdrawal reason edit: withdrawalReasonFormSchema (form) -> updateStudentSchema (PUT .../students/[id])", () => {
  it("round-trips a trimmed reason", async () => {
    const { withdrawalReasonFormSchema } = await import("../student");
    const { updateStudentSchema } = await import("../student");
    const form = withdrawalReasonFormSchema.safeParse({ withdrawalReason: "  Pindah domisili  " });
    expect(form.success).toBe(true);
    if (!form.success) return;
    expect(form.data.withdrawalReason).toBe("Pindah domisili");
    const body = wire(form.data); // riwayat-status-section.tsx sends `values` directly
    expect(updateStudentSchema.safeParse(body).success).toBe(true);
  });
});

// ── Promote (Naik Kelas) — components/admin/students/detail/
//    lifecycle-dialogs.tsx handlePromote posts `values` from
//    `promoteStudentSchema` directly; form and wire schema are the same
//    object (no divergence to round-trip), so this pins that the dialog's
//    own default values (an empty, not-yet-picked class + blank notes) are
//    rejected the way the API route requires. ──────────────────────────────
describe("Promote: promoteStudentSchema used directly as both form and POST .../promote schema", () => {
  it("accepts a picked class with optional notes", async () => {
    const { promoteStudentSchema } = await import("../student");
    const parsed = promoteStudentSchema.safeParse({ targetClassSectionId: "sec-1", notes: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects the dialog's own not-yet-picked default", async () => {
    const { promoteStudentSchema } = await import("../student");
    const parsed = promoteStudentSchema.safeParse({ targetClassSectionId: "", notes: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("Kelas tujuan wajib dipilih");
  });
});

// ── Withdraw (Keluarkan) — components/admin/students/detail/
//    lifecycle-dialogs.tsx handleWithdraw posts `{ reason: values.reason }`
//    from `withdrawStudentSchema` used directly. ────────────────────────────
describe("Withdraw: withdrawStudentSchema used directly as both form and POST .../withdraw schema", () => {
  it("round-trips a filled reason, dropping the unset optional effectiveDate", async () => {
    const { withdrawStudentSchema } = await import("../student");
    const form = withdrawStudentSchema.safeParse({ reason: "Pindah ke luar kota" });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const body = wire({ reason: form.data.reason }); // lifecycle-dialogs.tsx sends only `reason`
    expect(withdrawStudentSchema.safeParse(body).success).toBe(true);
    expect("effectiveDate" in (body as Record<string, unknown>)).toBe(false);
  });

  it("rejects a blank reason with the Indonesian inline message", async () => {
    const { withdrawStudentSchema } = await import("../student");
    const parsed = withdrawStudentSchema.safeParse({ reason: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe("Alasan pengunduran diri wajib diisi");
  });
});

// ── Informasi Tambahan rows — components/admin/students/detail/
//    informasi-tambahan-section.tsx. No wire schema counterpart: `PUT
//    .../students/[id]` accepts `metadata` as an open `z.record(...)`
//    (`createStudentSchema`); this pins the client-side shape that
//    `buildStudentMetadata` (lib/student/metadata.ts) folds into that blob. ──
describe("Informasi Tambahan: studentExtraMetadataFormSchema (form) -> buildStudentMetadata -> PUT { metadata }", () => {
  it("round-trips distinct rows into the metadata object the PUT body carries", async () => {
    const { studentExtraMetadataFormSchema } = await import("../student");
    const { buildStudentMetadata } = await import("../../student/metadata");
    const form = studentExtraMetadataFormSchema.safeParse({
      rows: [{ key: "hobi", value: "Menggambar" }],
    });
    expect(form.success).toBe(true);
    if (!form.success) return;
    const metadata = buildStudentMetadata({
      known: {},
      extra: form.data.rows,
      system: { fromEnrollmentApplication: null, dcareAddon: false, priorFamilyAttendees: [] },
    });
    const body = wire({ metadata }); // informasi-tambahan-section.tsx's persistMetadata call
    expect(body).toEqual({ metadata: { hobi: "Menggambar" } });
  });
});
