import { z } from "zod";
import { calendarDate } from "./bounds";
import { longText } from "./text";

export const createLeaveRequestSchema = z.object({
  leaveType: z.enum(["ANNUAL", "SICK", "PERMISSION", "OTHER"], {
    message: "Jenis cuti tidak valid",
  }),
  startDate: calendarDate({
    format: "Format tanggal mulai tidak valid (YYYY-MM-DD)",
    invalid: "Tanggal mulai tidak valid",
    range: "Tanggal mulai di luar rentang yang wajar",
  }),
  endDate: calendarDate({
    format: "Format tanggal selesai tidak valid (YYYY-MM-DD)",
    invalid: "Tanggal selesai tidak valid",
    range: "Tanggal selesai di luar rentang yang wajar",
  }),
  reason: longText({ required: "Alasan wajib diisi" }),
});

// POST /api/leave/requests/[id]/reject — admin review. Mirrors the route's
// previous inline `if (!body.note?.trim())` check (rejection reason
// required); POST .../approve keeps `note` optional and stays untouched.
export const REJECT_REASON_MIN_MESSAGE = "Alasan penolakan minimal 5 karakter";
const REJECT_REASON_MIN = 5;

export const rejectLeaveRequestSchema = z.object({
  note: longText({ required: "Alasan penolakan wajib diisi" }).pipe(
    z.string().min(REJECT_REASON_MIN, REJECT_REASON_MIN_MESSAGE),
  ),
});

/**
 * Admin review dialog (app/admin/(hr)/leave-requests/page.tsx) — one
 * Textarea shared by both actions, required only when rejecting. `action`
 * mirrors the dialog's local reviewAction state so a single static schema
 * (superRefine) can express the conditional requirement without swapping
 * the resolver at runtime.
 */
export const leaveReviewFormSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    note: longText().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action !== "reject") return;
    const note = data.note?.trim() ?? "";
    if (!note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Alasan penolakan wajib diisi",
      });
    } else if (note.length < REJECT_REASON_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: REJECT_REASON_MIN_MESSAGE,
      });
    }
  });
