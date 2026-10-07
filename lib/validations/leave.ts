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
export const rejectLeaveRequestSchema = z.object({
  note: longText({ required: "Alasan penolakan wajib diisi" }),
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
    if (data.action === "reject" && !data.note?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Alasan penolakan wajib diisi",
      });
    }
  });
