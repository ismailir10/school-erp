/**
 * Atomic single-key writes into `EnrollmentApplication`'s JSON columns.
 *
 * Why raw SQL: two parents can hold the same tokenized form open from two
 * places, and the public routes (signature upload, document upload, draft
 * autosave) all write the same row. A read-modify-write through Prisma would
 * let one request clobber the other's key. Each helper here is ONE `UPDATE`
 * that touches only the key it owns, so concurrent writers never lose data.
 *
 * `requireInvited` adds `AND status = 'INVITED'` to the WHERE, so a form that
 * was submitted between the access check and the write is a no-op (returns
 * false) instead of mutating a submitted application.
 *
 * Server-only (imports the Prisma client). Column names come from a closed
 * whitelist and are the only thing ever spliced in as an identifier — every
 * caller-supplied value is a bound parameter.
 */

import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";

export type JsonColumn = "consentData" | "documents";

const COLUMNS: Record<JsonColumn, Prisma.Sql> = {
  consentData: Prisma.raw('"consentData"'),
  documents: Prisma.raw('"documents"'),
};

function column(name: JsonColumn): Prisma.Sql {
  const col = COLUMNS[name];
  // Defence in depth: a JS caller bypassing the type can't reach raw SQL.
  if (!col) throw new Error(`Unsupported JSON column ${JSON.stringify(name)}`);
  return col;
}

function statusGuard(opts: { requireInvited: boolean }): Prisma.Sql {
  return opts.requireInvited ? Prisma.sql` AND status = 'INVITED'` : Prisma.empty;
}

/**
 * Shallow-merge `patch` into `<column>[key]`, creating the column and the key
 * as needed. A non-object column or a non-object value at `key` is treated as
 * `{}`. Returns false when no row matched (missing id, or not INVITED when
 * `requireInvited`).
 */
export async function mergeJsonKey(
  id: string,
  col: JsonColumn,
  key: string,
  patch: Record<string, unknown>,
  opts: { requireInvited: boolean },
): Promise<boolean> {
  const c = column(col);
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EnrollmentApplication"
    SET ${c} = (CASE WHEN jsonb_typeof(${c}) = 'object' THEN ${c} ELSE '{}'::jsonb END)
      || jsonb_build_object(
        ${key}::text,
        (CASE WHEN jsonb_typeof(${c} -> ${key}::text) = 'object' THEN ${c} -> ${key}::text ELSE '{}'::jsonb END)
          || ${JSON.stringify(patch)}::jsonb
      ),
      "updatedAt" = now()
    WHERE id = ${id}${statusGuard(opts)}
  `);
  return count > 0;
}

/**
 * Remove `fields` from the object at `<column>[key]`. No-op on the row's data
 * when that key isn't an object, but still returns true when the row matched
 * (so "nothing to remove" is success, and only a status/id miss is false).
 */
export async function removeJsonFields(
  id: string,
  col: JsonColumn,
  key: string,
  fields: string[],
  opts: { requireInvited: boolean },
): Promise<boolean> {
  const c = column(col);
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EnrollmentApplication"
    SET ${c} = CASE
      WHEN jsonb_typeof(${c} -> ${key}::text) = 'object'
        THEN jsonb_set(${c}, ARRAY[${key}::text], (${c} -> ${key}::text) - ${fields}::text[])
      ELSE ${c}
    END,
    "updatedAt" = now()
    WHERE id = ${id}${statusGuard({ requireInvited: opts.requireInvited })}
  `);
  return count > 0;
}

/**
 * Draft-save write for `consentData`: replaces the blob with `incoming` but
 * carries the STORED `ayah.signatureToken` / `ibu.signatureToken` over in the
 * same UPDATE, so an autosave can never clear or swap a signature. `incoming`
 * must already have object-valued `ayah` and `ibu` (the route normalizes) —
 * `jsonb_set` does not create missing parents. Always guarded on INVITED.
 */
export async function writeConsentPreservingSignatures(
  id: string,
  incoming: Record<string, unknown>,
): Promise<boolean> {
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "EnrollmentApplication"
    SET "consentData" = jsonb_set(
      jsonb_set(
        ${JSON.stringify(incoming)}::jsonb,
        '{ayah,signatureToken}',
        COALESCE("consentData" -> 'ayah' -> 'signatureToken', '""'::jsonb),
        true
      ),
      '{ibu,signatureToken}',
      COALESCE("consentData" -> 'ibu' -> 'signatureToken', '""'::jsonb),
      true
    ),
    "updatedAt" = now()
    WHERE id = ${id} AND status = 'INVITED'
  `);
  return count > 0;
}
