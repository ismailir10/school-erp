"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import { RELATIONSHIP_OPTIONS } from "@/lib/constants/parent-options";
import { linkChildFormSchema } from "@/lib/validations/guardian";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { readApiError } from "@/lib/api/client-errors";

const DUPLICATE_LINK_MESSAGE = "Wali ini sudah tertaut ke siswa tersebut.";
const FALLBACK = "Gagal menautkan anak";

// The wire schema accepts only these four; "PARENT" is a legacy display value.
const LINKABLE_RELATIONSHIPS = RELATIONSHIP_OPTIONS.filter((o) => o.value !== "PARENT");

const EMPTY = { studentId: "", relationship: "WALI" as const };

/**
 * "Tautkan anak" — link an existing student to this wali from the wali page.
 * Mirrors the student page's "Tambah Wali → link existing" flow from the other
 * side, through the same route (`POST /api/students/[id]/guardians` with a
 * `parentId`). No new endpoint.
 */
export function LinkStudentDialog({
  parentId,
  open,
  onOpenChange,
  onLinked,
}: {
  parentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful link so the page can refetch. */
  onLinked: () => void;
}) {
  const formId = useId();
  const form = useZodForm(linkChildFormSchema, { defaultValues: EMPTY });
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  // Every open path starts from a clean form.
  useEffect(() => {
    if (!open) return;
    form.reset(EMPTY);
    setSelectedStudent(null);
    // `form` is referentially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const res = await fetch(`/api/students/${values.studentId}/guardians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, relationship: values.relationship }),
      });
      if (res.ok) {
        toast.success("Anak ditautkan");
        onOpenChange(false);
        onLinked();
        return;
      }
      const body = await res.clone().json().catch(() => null);
      if (res.status === 409 && body?.code === "GUARDIAN_LINK_EXISTS") {
        // The problem is the picked student, so say so on the picker.
        form.setError(
          "studentId",
          { type: "server", message: typeof body.error === "string" ? body.error : DUPLICATE_LINK_MESSAGE },
          { shouldFocus: true },
        );
        return;
      }
      applyServerErrors(form, await readApiError(res, FALLBACK), FALLBACK);
    } catch (err) {
      applyServerErrors(form, err, FALLBACK);
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tautkan anak"
      description="Pilih siswa aktif yang menjadi anak wali ini."
      size="md"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={() => onOpenChange(false)}
          submitLabel="Tautkan anak"
          pendingLabel="Menautkan..."
        />
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />

        <FormField
          control={form.control}
          name="studentId"
          label="Siswa"
          required
          id="link-child-student"
          description="Hanya siswa aktif yang ditampilkan."
          render={({ field, controlProps }) => (
            <StudentPicker
              id="link-child-student"
              aria-invalid={controlProps["aria-invalid"]}
              selected={selectedStudent}
              onSelect={(s) => {
                setSelectedStudent(s);
                // Clears a stale "sudah tertaut" message when another student is picked.
                field.onChange(s?.id ?? "");
              }}
            />
          )}
        />

        <FormField
          control={form.control}
          name="relationship"
          label="Hubungan"
          required
          id="link-child-relationship"
          render={({ field, controlProps }) => (
            <Select value={field.value} onValueChange={(v) => field.onChange(v ?? "")}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                <SelectValue placeholder="Pilih hubungan" />
              </SelectTrigger>
              <SelectContent>
                {LINKABLE_RELATIONSHIPS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </form>
    </ResponsiveFormDialog>
  );
}
