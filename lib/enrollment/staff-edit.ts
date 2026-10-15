/**
 * Staff edit of an enrollment form ("Ubah data"): pure helpers, no DB.
 *
 * The parent form saves whole blobs; staff send PARTIAL ones. Two things the
 * zod schemas alone cannot express are done here:
 *
 *  - CLEARING. A blank string, `null` or an empty list for a known field means
 *    "remove this value". The schemas turn a blank into `undefined`, which is
 *    indistinguishable from "not sent", so blanks are split off BEFORE
 *    validation (`splitClears`) and applied as deletes AFTER (`mergeSection`).
 *  - MERGING. A partial patch is laid over the stored blob key by key
 *    (`address` one level deeper), so a half-filled save never drops what the
 *    parent already typed.
 */
import { STAFF_EDITABLE_KEYS } from "./submit-validation";

type Json = Record<string, unknown>;

export type EditSection = "studentData" | "ayahData" | "ibuData" | "consentData";

export const isPlainObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Blank = what an emptied form field sends: "", whitespace, null, or an empty list. */
function isBlank(v: unknown): boolean {
  return v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

/**
 * Split a section's raw input into the part to validate and the keys to clear.
 * Only KNOWN keys can be cleared (`address.kodePos` for the nested ones), so a
 * smuggled `{ signatureToken: "" }` cannot delete anything. Non-objects pass
 * through untouched for the schema to reject.
 */
export function splitClears(section: EditSection, input: unknown): { value: unknown; clears: string[] } {
  if (!isPlainObject(input)) return { value: input, clears: [] };
  const known = new Set<string>(STAFF_EDITABLE_KEYS[section]);
  const value: Json = {};
  const clears: string[] = [];
  for (const [key, v] of Object.entries(input)) {
    if (!known.has(key)) continue; // strip here too: nothing unknown reaches validation
    if (isBlank(v)) {
      clears.push(key);
    } else if (key === "address" && isPlainObject(v)) {
      const addressKnown = new Set<string>(STAFF_EDITABLE_KEYS.address);
      const address: Json = {};
      for (const [k, av] of Object.entries(v)) {
        if (!addressKnown.has(k)) continue;
        if (isBlank(av)) clears.push(`address.${k}`);
        else address[k] = av;
      }
      value.address = address;
    } else {
      value[key] = v;
    }
  }
  return { value, clears };
}

/** Stored blob + validated patch + clears → the new blob. Never mutates its inputs. */
export function mergeSection(stored: unknown, patch: unknown, clears: string[]): Json {
  const out: Json = { ...(isPlainObject(stored) ? stored : {}) };
  for (const [key, v] of Object.entries(isPlainObject(patch) ? patch : {})) {
    if (v === undefined) continue;
    if (key === "address" && isPlainObject(v)) {
      const address: Json = { ...(isPlainObject(out.address) ? out.address : {}) };
      for (const [k, av] of Object.entries(v)) if (av !== undefined) address[k] = av;
      out.address = address;
    } else {
      out[key] = v;
    }
  }
  for (const path of clears) {
    if (path.startsWith("address.")) {
      if (!isPlainObject(out.address)) continue;
      const address = { ...out.address };
      delete address[path.slice("address.".length)];
      if (Object.keys(address).length === 0) delete out.address;
      else out.address = address;
    } else {
      delete out[path];
    }
  }
  // A JSON column: drop `undefined` and detach from the caller's objects.
  return JSON.parse(JSON.stringify(out)) as Json;
}

/** JSON with object keys sorted at every depth: jsonb hands keys back in its own order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Top-level keys whose value differs between two blobs (key order ignored): names only, never values. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canonical(a[k] ?? null) !== canonical(b[k] ?? null)).sort();
}
