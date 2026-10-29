"use client";

import { MESSAGES } from "@/lib/feedback";
import { useEffect, useId } from "react";
import { toast } from "sonner";

import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendJson } from "@/lib/api/send-json";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { classEditFormSchema } from "@/lib/validations/class";

import type { ClassDetail } from "./types";

/**
 * "Ubah Kelas" dialog (class-detail page) — split out of
 * `app/admin/classes/[id]/client.tsx` (T2, 2026-09-27 admin-finish-standard
 * cycle) and migrated onto `useZodForm(classEditFormSchema)` +
 * `FormField`/`FormDialogFooter`. Only name/capacity/slotTemplate are
 * editable here (no campus/program/ageGroup, unlike the classes-list
 * dialog) — same three fields the pre-migration `useState` form held, and
 * the PATCH body still sends exactly those three keys.
 *
 * Submit label stays "Simpan" (not "Simpan Perubahan"): that was the
 * original copy on this specific dialog and no test/e2e selector depends on
 * it changing, so it is preserved rather than "fixed" to match the
 * classes-list dialog's wording.
 */
export function EditClassDialog({
  open,
  onOpenChange,
  classId,
  data,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  data: Pick<ClassDetail, "name" | "capacity" | "slotTemplate"> | null;
  onSaved: () => void;
}) {
  const formId = useId();
  const form = useZodForm(classEditFormSchema, {
    defaultValues: { name: "", capacity: 20, slotTemplate: "FULL_DAY" },
  });

  useEffect(() => {
    if (!open || !data) return;
    form.reset({ name: data.name, capacity: data.capacity, slotTemplate: data.slotTemplate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  const save = form.handleSubmit(async (values) => {
    try {
      await sendJson(
        `/api/admin/classes/${classId}`,
        {
          method: "PATCH",
          body: {
            name: values.name,
            capacity: values.capacity,
            slotTemplate: values.slotTemplate,
          },
        },
        MESSAGES.saveFailed,
      );
      toast.success("Kelas diperbarui");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      applyServerErrors(form, err, MESSAGES.saveFailed);
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ubah Kelas"
      description="Perbarui nama, kapasitas, atau pola slot."
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Simpan"
        />
      }
    >
      <form id={formId} onSubmit={save} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField
          control={form.control}
          name="name"
          label="Nama kelas"
          required
          id="class-detail-name"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} placeholder="mis. TKIT A" />
          )}
        />
        <FormField
          control={form.control}
          name="capacity"
          label="Kapasitas"
          required
          id="class-detail-capacity"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} type="number" min={1} max={200} />
          )}
        />
        <FormField
          control={form.control}
          name="slotTemplate"
          label="Pola Waktu Kelas"
          required
          id="class-detail-slot-template"
          render={({ field, controlProps }) => (
            <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FULL_DAY">Sehari penuh</SelectItem>
                <SelectItem value="MORNING_AND_AFTERNOON">Pagi & sore</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}
