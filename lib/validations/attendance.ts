import { z } from "zod";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// AttendanceRecord.date is stored as text (YYYY-MM-DD) per prisma schema.
// Validate the shape AND that the value is a real calendar date — `2024-02-31`
// would pass a regex check but is not a real day. Two-step validation: shape
// via regex, then round-trip through Date and confirm the parsed parts match.
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD")
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return false;
      // Round-trip rejects non-existent dates like 2024-02-31 (rolls to 2024-03-02)
      return d.toISOString().slice(0, 10) === s;
    },
    { message: "Tanggal tidak valid" }
  );

export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "LATE",
  "PRESENT_NO_CHECKOUT",
  "HALF_DAY",
  "ABSENT",
  "LEAVE",
  "SICK",
  "PERMISSION",
] as const;

const reasonField = z
  .string()
  .trim()
  .min(1, "Alasan wajib diisi")
  .max(500, "Alasan maksimal 500 karakter");

// Admin-typed check-in time, 24h `HH:MM`, read as school-local wall-clock time
// on the record's date (the route converts it with the tenant timezone). A
// blank string means "no time" and normalises to undefined.
const hhmmTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format waktu harus HH:MM");
const blankToUndefined = z.literal("").transform(() => undefined);
const checkInTimeField = z.union([blankToUndefined, hhmmTime]).optional();

export const attendanceOverrideSchema = z
  .object({
    date: isoDateString,
    status: z.enum(ATTENDANCE_STATUSES),
    checkInTime: checkInTimeField,
    reason: reasonField,
  })
  .refine(
    (v) => {
      // Reject far-future PRESENT/LATE/HALF_DAY/ABSENT — those describe
      // observed work-day state and cannot be predicted. LEAVE/SICK/PERMISSION
      // are routinely pre-recorded for upcoming days (annual leave planning,
      // school calendar) and bypass the cap.
      if (v.status === "LEAVE" || v.status === "SICK" || v.status === "PERMISSION") {
        return true;
      }
      // The school's calendar day, not the server's: Vercel runs in UTC, so
      // between 00:00 and 06:59 WIB the UTC date is still yesterday.
      const today = new Date(`${getTodayInTimezone("Asia/Jakarta")}T00:00:00Z`);
      const target = new Date(`${v.date}T00:00:00Z`);
      const diffDays = (target.getTime() - today.getTime()) / 86_400_000;
      return diffDays <= 30;
    },
    {
      message:
        "Tanggal tidak boleh lebih dari 30 hari ke depan untuk status kehadiran (gunakan LEAVE/SICK/PERMISSION untuk pra-pencatatan)",
      path: ["date"],
    }
  );

export type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;

// PUT /api/attendance/[id]/override — date is immutable (taken from the record).
// `checkInTime` takes the modal's `HH:MM`; legacy callers sent a full datetime
// with or without offset (`2026-04-15T07:00:00`, `...000Z`), still accepted.
export const attendanceOverrideUpdateSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  checkInTime: z
    .union([blankToUndefined, hhmmTime, z.string().datetime({ local: true })])
    .optional(),
  checkOutTime: z.string().datetime({ local: true }).optional(),
  reason: reasonField,
});

/**
 * Body schema for self-service check-in / check-out.
 *
 * `lat` / `lng` are optional GPS coordinates captured by the teacher portal —
 * a phone GPS may be unavailable (indoor, denied permission), in which case
 * the field is omitted entirely. When present, both must be finite numbers
 * inside the legal earth-coordinate ranges. String types are rejected: the
 * old route silently destructured `body.lat` / `body.lng`, accepting whatever
 * shape the caller sent and forwarding it to `prisma.create`.
 */
export const attendanceCheckInSchema = z
  .object({
    lat: z
      .number()
      .finite()
      .min(-90, "Latitude di luar rentang valid")
      .max(90, "Latitude di luar rentang valid")
      .optional(),
    lng: z
      .number()
      .finite()
      .min(-180, "Longitude di luar rentang valid")
      .max(180, "Longitude di luar rentang valid")
      .optional(),
  })
  // Strip unknown keys silently — clients may send extra debug fields and we
  // don't want to 400 on harmless additions, but we do want to ignore them.
  .strip();

export type AttendanceCheckInInput = z.infer<typeof attendanceCheckInSchema>;
