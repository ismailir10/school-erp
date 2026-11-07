import { z } from "zod";

import { optionalTrimmed } from "@/lib/validations/zod-helpers";

// Mirrors lib/validations/program.ts. Status values are the canonical Cat A
// soft-delete pair (ACTIVE | INACTIVE) — see prisma/schema.prisma Campus.status.
// Restore = PUT { status: "ACTIVE" }; deactivate goes through DELETE.
//
// lat/lng accept string OR number — the admin form submits them as strings
// from <Input type="number">, while programmatic callers may send numbers.
// Both pass through z.coerce.number() so the route handler can rely on
// numeric values without a separate parseFloat() ternary.
//
// Coordinates are bounded (HR-9, cycle 2026-09-29 data-integrity): the columns
// are numeric(10,8) / numeric(11,8), so lat=999 or lng=-500 overflowed
// Postgres and answered a bare 500. Real-world bounds are tighter than the
// column and give a field error instead.
const latitude = z.coerce
  .number({ message: "Harus berupa angka" })
  .min(-90, "Latitude harus antara -90 dan 90")
  .max(90, "Latitude harus antara -90 dan 90");
const longitude = z.coerce
  .number({ message: "Harus berupa angka" })
  .min(-180, "Longitude harus antara -180 dan 180")
  .max(180, "Longitude harus antara -180 dan 180");

// Geofence radius for staff check-in, in metres. The admin form submits it as a
// string from <Input type="number">; a blank field means "leave as is" (PUT) or
// "use the default 50" (POST).
const radiusMeters = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.coerce
    .number({ message: "Harus berupa angka" })
    .int("Radius harus bilangan bulat")
    .min(10, "Radius minimal 10 meter")
    .max(1000, "Radius maksimal 1000 meter")
    .optional(),
);

// PUT semantics: an omitted key is left alone, an explicit `null` (or blank
// string) clears the column.
const nullableCoordinate = (inner: z.ZodType<number>) =>
  z.preprocess((v) => (v === "" ? null : v), inner.optional().nullable());

export const updateCampusSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi").max(120).optional(),
  address: z.string().max(500).optional().nullable(),
  lat: nullableCoordinate(latitude),
  lng: nullableCoordinate(longitude),
  radiusMeters,
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

// POST /api/config/campuses. `name` is required (create), unlike the PUT
// partial-update schema above. `lat`/`lng` arrive as `""` from the empty
// <Input type="number"> — z.coerce.number() alone would coerce that to `0`
// (`Number("")` is `0`), so an empty coordinate first collapses to
// `undefined` and only then goes through z.coerce.number(), matching the
// route's previous `lat ? parseFloat(lat) : null` (falsy string → null).
const optionalCoordinate = (inner: z.ZodType<number>) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), inner.optional());

export const createCampusSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120, "Nama maksimal 120 karakter"),
  address: optionalTrimmed(z.string().max(500, "Alamat maksimal 500 karakter")),
  lat: optionalCoordinate(latitude),
  lng: optionalCoordinate(longitude),
  radiusMeters,
});

export type CreateCampusInput = z.infer<typeof createCampusSchema>;
