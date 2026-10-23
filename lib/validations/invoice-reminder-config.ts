import { z } from "zod";
import { validateReminderTemplate } from "@/lib/finance/reminder-template";

/**
 * PUT /api/config/invoice-reminder — the school's WhatsApp reminder wording.
 * A blank text means "back to the built-in message" (the route stores null), so only
 * non-blank text is checked: known placeholders, `{tautan}` present, within the length cap.
 */
export const invoiceReminderConfigSchema = z.object({
  template: z.string({ error: "Pesan harus berupa teks" }).superRefine((value, ctx) => {
    if (!value.trim()) return;
    const problem = validateReminderTemplate(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  }),
});

export type InvoiceReminderConfigInput = z.infer<typeof invoiceReminderConfigSchema>;
