"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError } from "@/lib/api/client-errors";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { createEnrollmentLeaveSchema } from "@/lib/validations/enrollment-leave";
import { clampMonth, monthRangeOptions } from "./cuti-months";
import type { CreateLeaveResponse, LeaveEnrollmentOption } from "./cuti-types";

/** Current Jakarta month as `YYYY-MM`. */
function currentMonth(): string {
  return getTodayInTimezone("Asia/Jakarta").slice(0, 7);
}

const NO_ACCESS = "Anda tidak punya akses untuk mencatat cuti.";

type EnrollmentWithWindow = LeaveEnrollmentOption & { window: { from: string; to: string } };

const enrollmentLabel = (e: LeaveEnrollmentOption) => `${e.programName} · ${e.className} (${e.academicYearName})`;

/**
 * "Catat cuti": record a billing pause on one of the student's enrollments.
 *
 * The enrollment field exists only when there is a real choice (more than one
 * eligible placement); with one, the dialog says which placement it is for. Month
 * pickers are bounded to the chosen enrollment's academic-year window, because the
 * server refuses anything billing could never see. The caller closes the dialog
 * and runs the follow-up (drafts notice, open invoices) from `onCreated`.
 */
export function CutiCreateDialog({
  open,
  onOpenChange,
  studentId,
  enrollments,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  /** Only the enrollments a leave may be recorded on. */
  enrollments: LeaveEnrollmentOption[];
  onCreated: (result: CreateLeaveResponse) => void;
}) {
  const formId = useId();
  const options = enrollments.filter((e): e is EnrollmentWithWindow => e.eligible && e.window !== null);
  const form = useZodForm(createEnrollmentLeaveSchema, {
    defaultValues: { enrollmentId: "", startMonth: "", endMonth: "", reason: "" },
  });

  // Every open starts fresh: first eligible placement, this month (clamped into
  // its window) for both ends, no reason.
  useEffect(() => {
    if (!open) return;
    const first = options[0];
    const start = first ? clampMonth(currentMonth(), first.window) : "";
    form.reset({ enrollmentId: first?.id ?? "", startMonth: start, endMonth: start, reason: "" });
    // `options` is derived from props each render; opening is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const enrollmentId = form.watch("enrollmentId");
  const startMonth = form.watch("startMonth");
  const selected = options.find((e) => e.id === enrollmentId) ?? null;
  const months = selected ? monthRangeOptions(selected.window.from, selected.window.to) : [];
  const endMonths = months.filter((m) => !startMonth || m.value >= startMonth);

  const submitting = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    try {
      const result = await sendJson<CreateLeaveResponse>(
        `/api/students/${studentId}/leaves`,
        { method: "POST", body: values },
        "Gagal mencatat cuti",
      );
      onCreated(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        form.setError("root.server", { type: "server", message: NO_ACCESS });
        toast.error(NO_ACCESS);
        return;
      }
      applyServerErrors(form, err, "Gagal mencatat cuti");
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => !submitting && onOpenChange(o)}
      title="Catat cuti"
      description="Siswa tidak ditagih untuk bulan yang dicatat cuti."
      size="lg"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={submitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Catat cuti"
          disabled={options.length === 0}
        />
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />

        {options.length > 1 ? (
          <FormField
            control={form.control}
            name="enrollmentId"
            label="Pendaftaran kelas"
            required
            id="cuti-enrollment"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  if (v == null) return;
                  field.onChange(v);
                  // The window changes with the placement: pull both ends back inside it.
                  const next = options.find((e) => e.id === v);
                  if (next) {
                    const start = clampMonth(form.getValues("startMonth") || currentMonth(), next.window);
                    const end = clampMonth(form.getValues("endMonth") || start, next.window);
                    form.setValue("startMonth", start);
                    form.setValue("endMonth", end < start ? start : end);
                  }
                }}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                  <SelectValue className="min-w-0 truncate" placeholder="Pilih pendaftaran kelas" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {enrollmentLabel(e)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        ) : selected ? (
          <p className="text-sm text-muted-foreground">
            Untuk <span className="font-medium text-foreground">{enrollmentLabel(selected)}</span>
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startMonth"
            label="Mulai bulan"
            required
            id="cuti-start"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => {
                  if (v == null) return;
                  field.onChange(v);
                  // Keep the range valid: an end before the new start moves up with it.
                  const end = form.getValues("endMonth");
                  if (!end || end < v) form.setValue("endMonth", v, { shouldValidate: form.formState.isSubmitted });
                }}
                disabled={months.length === 0}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                  <SelectValue className="min-w-0 truncate" placeholder="Pilih bulan" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FormField
            control={form.control}
            name="endMonth"
            label="Sampai bulan"
            required
            id="cuti-end"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                disabled={months.length === 0}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur} className="w-full min-w-0 bg-background">
                  <SelectValue className="min-w-0 truncate" placeholder="Pilih bulan" />
                </SelectTrigger>
                <SelectContent>
                  {endMonths.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="reason"
          label="Alasan"
          required
          id="cuti-reason"
          description="3 sampai 200 karakter."
          render={({ field, controlProps }) => (
            <Textarea
              {...field}
              {...controlProps}
              value={field.value ?? ""}
              rows={2}
              maxLength={200}
              placeholder="Mis. pulang kampung"
            />
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}
