import { z } from "zod";
import { getYmdInTimezone } from "@/lib/attendance/timezone";
import { partialWithoutDefaults } from "./zod-helpers";
import { INVALID_TEXT_MESSAGE, CONTROL_CHARS, labelText } from "./text";

export const scopeSchema = z.enum(["SCHOOL", "HOME"]);

/**
 * Shape check plus a real-calendar check — the regex alone accepts impossible
 * dates like `2026-07-99` or `2026-02-31`. That used to be harmless here: the
 * home-entry route compared `date` against today for exact equality, so a
 * nonsense string could never match. Now that the route accepts a *range*
 * (see `lib/student-journal/backfill.ts`), `"2026-07-99"` sorts between the
 * window floor and today whenever the window straddles a month boundary and
 * would be persisted verbatim into `StudentJournalEntry.date`, a plain String
 * column with no DB-level constraint. Round-tripping through `Date` is the
 * same guard `lib/validations/curriculum.ts` already uses.
 */
const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && getYmdInTimezone(d, "UTC") === s;
  }, "Tanggal tidak valid");

export const createCategorySchema = z.object({
  name: labelText({ required: "Nama kategori wajib diisi" }),
  scope: scopeSchema,
  order: z.number().int().nonnegative().default(0),
});
export const updateCategorySchema = // partialWithoutDefaults: a status-only toggle must not reset `order` to 0 (DRV-1).
partialWithoutDefaults(createCategorySchema).extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const createIndicatorSchema = z.object({
  categoryId: z.string().min(1),
  label: labelText({ required: "Label indikator wajib diisi" }),
  order: z.number().int().nonnegative().default(0),
});
export const updateIndicatorSchema = partialWithoutDefaults(createIndicatorSchema).extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// Client form schemas (T3, 2026-09-27 admin-forms-rhf cycle). `order` is
// never a user-editable field in either dialog — the admin page computes it
// itself (`categories.length` / the parent category's current indicator
// count) and splices it into the request body at submit time — so both
// forms omit it. The indicator dialog also never shows `categoryId` as a
// field: it is fixed by which category's "+" button opened the dialog and
// carried in component state, not RHF.
export const categoryFormSchema = createCategorySchema.omit({ order: true });
export const indicatorFormSchema = createIndicatorSchema.pick({ label: true });

export type CategoryFormInput = z.infer<typeof categoryFormSchema>;
export type IndicatorFormInput = z.infer<typeof indicatorFormSchema>;

/**
 * Hard bound on one batch write. A class-level bulk fill (roster x indicators)
 * is chunked by the client well below this; the cap exists so a single request
 * cannot hold an interactive transaction (upsert + audit per entry) open long
 * enough to time out, whoever sends it.
 */
export const JOURNAL_BATCH_MAX_ENTRIES = 500;

export const entryBatchSchema = z.object({
  classSectionId: z.string().min(1),
  date: ymd,
  entries: z
    .array(z.object({
      studentId: z.string().min(1),
      indicatorId: z.string().min(1),
      checked: z.boolean(),
    }))
    .max(JOURNAL_BATCH_MAX_ENTRIES, `Maksimal ${JOURNAL_BATCH_MAX_ENTRIES} entri per permintaan`),
});

export const homeEntryBatchSchema = z.object({
  studentId: z.string().min(1),
  date: ymd,
  entries: z.array(z.object({
    indicatorId: z.string().min(1),
    checked: z.boolean(),
  })),
});

// Trim first: a whitespace-only note used to pass `.min(1)` and land as a blank
// row (STR-17). Control characters (NUL → Postgres 500) are rejected too.
const noteBody = z
  .string()
  .trim()
  .min(1, "Catatan tidak boleh kosong.")
  .refine((v) => !CONTROL_CHARS.test(v), INVALID_TEXT_MESSAGE)
  .max(2000, "Catatan maksimal 2000 karakter");

export const noteBodySchema = z.object({
  studentId: z.string().min(1),
  date: ymd,
  body: noteBody,
});
export const noteUpdateSchema = z.object({
  body: noteBody,
});

export const adminEntryUpdateSchema = z.object({
  checked: z.boolean(),
});
