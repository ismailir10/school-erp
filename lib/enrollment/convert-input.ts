/**
 * Pure mapping from an EnrollmentApplication's JSON blobs to the rows
 * `POST /api/enrollments/[id]/convert` creates. No DB, no session: the route
 * calls this once before the transaction (to fail fast and to look for a
 * duplicate student) and once on the row-locked copy inside it, so both agree
 * on what "enough data" means.
 *
 * Minimum data = exactly what the Student and Parent tables REQUIRE: a child
 * name (`Student.name`) and a name for at least one of Ayah / Ibu
 * (`Parent.name`). Everything else (date of birth, gender, contacts…) is
 * nullable in the schema, so staff can convert straight from a half-filled form.
 */

import { z } from "zod";
import { normaliseName } from "@/lib/parent/match";
import { formatAddress } from "@/lib/enrollment/address";
import {
  AGAMA_OPTIONS, KEWARGANEGARAAN_OPTIONS, LIVING_WITH_OPTIONS, BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS, BLOOD_TYPE_OPTIONS, EDUCATION_OPTIONS, OCCUPATION_OPTIONS, INCOME_OPTIONS,
  type Option,
} from "@/lib/enrollment/constants";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const label = (opts: Option[], v: unknown): string | null => {
  const val = s(v);
  return val ? (opts.find((o) => o.value === val)?.label ?? val) : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
};


const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const emailCheck = z.string().email();

/** A real calendar date as YYYY-MM-DD, else null (a draft value the parent route never validated). */
function realDate(v: unknown): string | null {
  const val = s(v);
  if (!val || !ISO_DATE.test(val)) return null;
  const d = new Date(`${val}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== val ? null : val;
}

/** A well-formed email, else null: an invalid draft email must never become Parent.email or a match key. */
function validEmail(v: unknown): string | null {
  const val = s(v);
  return val && emailCheck.safeParse(val).success ? val : null;
}

const HONORIFICS = new Set(["pak", "bapak", "ibu", "bu", "h", "hj", "haji", "hajjah"]);

function nameTokens(name: string): Set<string> {
  return new Set(
    normaliseName(name)
      .split(/[^\p{L}]+/u)
      .filter((t) => t.length >= 3 && !HONORIFICS.has(t)),
  );
}

/**
 * Could these two names be the same person? Equal after case/whitespace
 * folding, or sharing at least one name token of 3+ letters (honorifics like
 * "Pak" / "Bu" / "H." ignored). Deliberately loose: it only guards against a
 * mistyped email or a shared family phone pulling in a stranger.
 */
export function namesCompatible(a: string, b: string): boolean {
  if (normaliseName(a) === normaliseName(b)) return true;
  const ta = nameTokens(a);
  for (const t of nameTokens(b)) if (ta.has(t)) return true;
  return false;
}

export type ParentInput = {
  name: string;
  email: string | null;
  phone: string | null;
  education: string | null;
  occupation: string | null;
  incomeRange: string | null;
  address: string | null;
  employer: string | null;
  employerAddress: string | null;
};

/** The blob-backed columns of an application, as read from the DB (or a locked raw row). */
export type ConvertSource = {
  childName: string | null;
  studentData: unknown;
  ayahData: unknown;
  ibuData: unknown;
};

export type ConvertInput = {
  childName: string | null;
  dateOfBirth: string | null;
  sd: Json;
  ayah: ParentInput | null;
  ibu: ParentInput | null;
};

export type ConvertMissing = { field: string; message: string };

/** All eight address keys in reading order (`formatAddress`); an old blob without the region keys reads as before. */
const joinAddress = (a: Json): string | null => formatAddress(a);

function parentFrom(block: unknown): ParentInput | null {
  const b = j(block);
  const name = s(b.name);
  if (!name) return null;
  return {
    name,
    email: validEmail(b.email),
    phone: s(b.phone),
    education: label(EDUCATION_OPTIONS, b.education),
    occupation: label(OCCUPATION_OPTIONS, b.occupation),
    incomeRange: label(INCOME_OPTIONS, b.income),
    address: joinAddress(j(b.address)),
    employer: s(b.employerName),
    employerAddress: s(b.employerAddress),
  };
}

function parseConvertSource(src: ConvertSource): ConvertInput {
  const sd = j(src.studentData);
  return {
    // The thin column wins; the blob is the fallback for a row staff edited only there.
    childName: s(src.childName) ?? s(sd.childName),
    dateOfBirth: realDate(sd.dateOfBirth),
    sd,
    ayah: parentFrom(src.ayahData),
    ibu: parentFrom(src.ibuData),
  };
}

/** What stops this application from becoming a Student. Empty = convertible. */
function convertMissing(input: ConvertInput): ConvertMissing[] {
  const missing: ConvertMissing[] = [];
  if (!input.childName) {
    missing.push({
      field: "studentData.childName",
      message: "Nama anak belum diisi. Lengkapi lewat Ubah data.",
    });
  }
  if (!input.ayah && !input.ibu) {
    missing.push({
      field: "ayahData.name",
      message: "Nama Ayah atau Ibu belum diisi (minimal salah satu). Lengkapi lewat Ubah data.",
    });
  }
  return missing;
}

export type ValidConvertInput = ConvertInput & { childName: string };

/** Parse a source and check the minimum data; on success the child name is narrowed to a string. */
export function validateConvertInput(
  src: ConvertSource,
): { ok: true; input: ValidConvertInput } | { ok: false; errors: ConvertMissing[] } {
  const input = parseConvertSource(src);
  const errors = convertMissing(input);
  if (errors.length > 0 || input.childName === null) return { ok: false, errors };
  return { ok: true, input: { ...input, childName: input.childName } };
}

/** Student columns that have a home in the schema, plus the free-form metadata JSON for the rest. */
export function studentFields(input: ValidConvertInput, ctx: { dcareAddon: boolean; applicationId: string }) {
  const { sd } = input;
  const metadata: Json = {
    religion: label(AGAMA_OPTIONS, sd.agama),
    citizenship: label(KEWARGANEGARAAN_OPTIONS, sd.kewarganegaraan),
    bloodType: label(BLOOD_TYPE_OPTIONS, sd.bloodType),
    birthDelivery: label(BIRTH_DELIVERY_OPTIONS, sd.birthDelivery),
    birthTerm: label(BIRTH_TERM_OPTIONS, sd.birthTerm),
    homeLanguage: s(sd.homeLanguage),
    foodAllergy: s(sd.foodAllergy),
    seriousIllness: s(sd.seriousIllness),
    weightKg: num(sd.weightKg),
    heightCm: num(sd.heightCm),
    headCircumferenceCm: num(sd.headCircumferenceCm),
    siblingsKandung: num(sd.siblingsKandung),
    siblingsTiri: num(sd.siblingsTiri),
    siblingsAngkat: num(sd.siblingsAngkat),
    dcareAddon: ctx.dcareAddon,
    priorFamilyAttendees: Array.isArray(sd.priorFamilyAttendees) ? sd.priorFamilyAttendees : [],
    fromEnrollmentApplication: ctx.applicationId,
  };
  return {
    nickname: s(sd.nickname),
    dateOfBirth: input.dateOfBirth,
    gender: s(sd.childGender),
    birthPlace: s(sd.birthPlace),
    address: joinAddress(j(sd.address)),
    livingWith: label(LIVING_WITH_OPTIONS, sd.livingWith),
    metadata: JSON.stringify(metadata),
    childOrder: num(sd.childOrder),
  };
}
