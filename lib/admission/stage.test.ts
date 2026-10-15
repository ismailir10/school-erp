import { describe, it, expect } from "vitest";
import { deriveStage, stageWhere, UNPAID_WHERE, FORMULIR_STAGE, STAGES, type Stage } from "./stage";

type Fixture = {
  name: string;
  admission: { status: string; studentId: string | null };
  application: { status: string; studentId: string | null; fee: { status: string } | null } | null;
  stage: Stage;
};

const app = (status: string, over: Partial<NonNullable<Fixture["application"]>> = {}) => ({
  status,
  studentId: null,
  fee: null,
  ...over,
});
const lead = (status: string, studentId: string | null = null) => ({ status, studentId });

/** The matrix the spec describes, including every legacy value. */
const FIXTURES: Fixture[] = [
  { name: "fresh inquiry", admission: lead("INQUIRY"), application: null, stage: "BARU" },
  { name: "legacy VISIT_SCHEDULED reads as Baru", admission: lead("VISIT_SCHEDULED"), application: null, stage: "BARU" },
  { name: "legacy VISITED reads as Baru", admission: lead("VISITED"), application: null, stage: "BARU" },
  { name: "legacy ADMITTED without application or student reads as Baru", admission: lead("ADMITTED"), application: null, stage: "BARU" },
  { name: "legacy VISITED with a formulir sent follows the formulir", admission: lead("VISITED"), application: app("INVITED"), stage: "FORMULIR_DIKIRIM" },
  { name: "formulir sent", admission: lead("INQUIRY"), application: app("INVITED"), stage: "FORMULIR_DIKIRIM" },
  { name: "formulir sent, fee unpaid", admission: lead("INQUIRY"), application: app("INVITED", { fee: { status: "UNPAID" } }), stage: "FORMULIR_DIKIRIM" },
  { name: "formulir submitted", admission: lead("INQUIRY"), application: app("SUBMITTED"), stage: "FORMULIR_MASUK" },
  { name: "legacy UNDER_REVIEW reads as Formulir masuk", admission: lead("INQUIRY"), application: app("UNDER_REVIEW"), stage: "FORMULIR_MASUK" },
  { name: "accepted, not yet a student", admission: lead("INQUIRY"), application: app("ACCEPTED"), stage: "DITERIMA" },
  { name: "rejected", admission: lead("INQUIRY"), application: app("REJECTED"), stage: "DITOLAK" },
  { name: "cancelled lead", admission: lead("CANCELLED"), application: null, stage: "BATAL" },
  { name: "cancelled lead with an invited formulir", admission: lead("CANCELLED"), application: app("INVITED"), stage: "BATAL" },
  { name: "cancelled lead with a rejected formulir", admission: lead("CANCELLED"), application: app("REJECTED"), stage: "BATAL" },
  { name: "lead linked to a student", admission: lead("ADMITTED", "s1"), application: null, stage: "SISWA" },
  { name: "application linked to a student", admission: lead("ADMITTED"), application: app("ACCEPTED", { studentId: "s1" }), stage: "SISWA" },
  { name: "converted then cancelled stays Siswa", admission: lead("CANCELLED", "s1"), application: app("ACCEPTED", { studentId: "s1" }), stage: "SISWA" },
  { name: "student link on the lead beats a rejected formulir", admission: lead("INQUIRY", "s1"), application: app("REJECTED"), stage: "SISWA" },
  { name: "unknown application status falls back to Baru", admission: lead("INQUIRY"), application: app("SOMETHING_NEW"), stage: "BARU" },
];

describe("deriveStage", () => {
  it.each(FIXTURES)("$name -> $stage", ({ admission, application, stage }) => {
    expect(deriveStage(admission, application)).toBe(stage);
  });

  it("treats a missing studentId key like null", () => {
    expect(deriveStage({ status: "INQUIRY" }, { status: "SUBMITTED" })).toBe("FORMULIR_MASUK");
  });
});

// ── A tiny evaluator for the Prisma `where` operators stageWhere uses ────────
// Mocking Prisma proves nothing about the filter, so the where clause is run over
// the same fixtures the derivation uses. It understands only what stageWhere emits
// and throws on anything else, so a new operator cannot slip in untested.
//
// It is a faithful subset of Prisma ONLY because every column involved is NOT NULL
// (status) or compared against null explicitly (studentId): SQL's three-valued logic
// (`status != 'X'` is unknown for NULL) never comes into play, so plain JS equality
// gives the same answers. Do not reuse it for a nullable column.
type Row = Record<string, unknown>;

function matches(row: Row | null, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    const value = row ? (row[key] ?? null) : null;
    if (cond === null) return value === null;
    if (typeof cond !== "object") return value === cond;
    const c = cond as Record<string, unknown>;
    if ("is" in c) {
      if (c.is === null) return value === null;
      return value !== null && matches(value as Row, c.is as Row);
    }
    if ("not" in c) {
      if (c.not === null) return value !== null;
      return value !== c.not;
    }
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
    throw new Error(`unsupported where operator for ${key}: ${JSON.stringify(cond)}`);
  });
}

const toRow = (f: Fixture): Row => ({
  status: f.admission.status,
  studentId: f.admission.studentId,
  enrollmentApplication: f.application,
});

describe("stageWhere agrees with deriveStage", () => {
  for (const stage of STAGES) {
    it(`${stage}: matches exactly the fixtures that derive to it`, () => {
      const where = stageWhere(stage) as Record<string, unknown>;
      for (const f of FIXTURES) {
        expect(matches(toRow(f), where), `${f.name} against ${stage}`).toBe(deriveStage(f.admission, f.application) === stage);
      }
    });
  }

  it("every fixture falls into exactly one stage", () => {
    for (const f of FIXTURES) {
      const hits = STAGES.filter((s) => matches(toRow(f), stageWhere(s) as Record<string, unknown>));
      expect(hits, f.name).toHaveLength(1);
    }
  });

  it("every stage is exercised by at least one fixture", () => {
    for (const stage of STAGES) expect(FIXTURES.some((f) => f.stage === stage), stage).toBe(true);
  });
});

describe("FORMULIR_STAGE (the single status -> stage map)", () => {
  it.each(Object.keys(FORMULIR_STAGE))("%s lands in exactly one stage, via deriveStage and via stageWhere", (status) => {
    const f: Fixture = { name: status, admission: lead("INQUIRY"), application: app(status), stage: FORMULIR_STAGE[status] };
    expect(deriveStage(f.admission, f.application)).toBe(FORMULIR_STAGE[status]);
    const hits = STAGES.filter((s) => matches(toRow(f), stageWhere(s) as Record<string, unknown>));
    expect(hits).toEqual([FORMULIR_STAGE[status]]);
  });

  it("an inherited property name is not a status", () => {
    expect(deriveStage(lead("INQUIRY"), app("constructor"))).toBe("BARU");
    expect(deriveStage(lead("INQUIRY"), app("toString"))).toBe("BARU");
  });
});

describe("UNPAID_WHERE (Belum bayar)", () => {
  const unpaid = (f: Fixture) => matches(toRow(f), UNPAID_WHERE as Record<string, unknown>);
  const withFee = (status: string, admissionStatus = "INQUIRY", appStatus = "INVITED"): Fixture => ({
    name: `${appStatus}/${status}`,
    admission: lead(admissionStatus),
    application: app(appStatus, { fee: { status } }),
    stage: "BARU",
  });

  it("keeps an unpaid fee, sent or submitted", () => {
    expect(unpaid(withFee("UNPAID", "INQUIRY", "INVITED"))).toBe(true);
    expect(unpaid(withFee("UNPAID", "INQUIRY", "SUBMITTED"))).toBe(true);
  });

  it("drops paid and waived fees and applications without a fee", () => {
    expect(unpaid(withFee("PAID"))).toBe(false);
    expect(unpaid(withFee("WAIVED"))).toBe(false);
    expect(unpaid({ name: "no app", admission: lead("INQUIRY"), application: null, stage: "BARU" })).toBe(false);
    expect(unpaid({ name: "no fee", admission: lead("INQUIRY"), application: app("INVITED"), stage: "BARU" })).toBe(false);
  });

  it("drops a rejected application and a cancelled lead: their link is closed, there is nothing to chase", () => {
    expect(unpaid(withFee("UNPAID", "INQUIRY", "REJECTED"))).toBe(false);
    expect(unpaid(withFee("UNPAID", "CANCELLED", "INVITED"))).toBe(false);
  });
});
