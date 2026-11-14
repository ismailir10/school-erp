"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/client-errors";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { teachingAssignmentAddSchema } from "@/lib/validations/class";

import {
  TeacherOptionItems,
  TeacherOptionsError,
  type TeacherOptionsStatus,
} from "./teacher-option-items";
import type { Employee } from "./types";

/**
 * "Tambah Guru Pengajar" dialog — split out of
 * `app/admin/classes/[id]/client.tsx` (T2, 2026-09-27 admin-finish-standard
 * cycle). The picker is a real `<form>`/`handleSubmit` (T2 item 3); the
 * HOMEROOM_EXISTS 409 advisory (replace-homeroom confirm) stays a plain
 * `ConfirmDialog` layered on top, unchanged from before the split.
 */
export function AddTeacherDialog({
  open,
  onOpenChange,
  classId,
  employeeOptions,
  employeesTruncated,
  employeesStatus,
  onRetryEmployees,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  employeeOptions: Employee[];
  employeesTruncated: boolean;
  employeesStatus: TeacherOptionsStatus;
  onRetryEmployees: () => void;
  onAdded: () => void;
}) {
  const formId = useId();
  const teacherForm = useZodForm(teachingAssignmentAddSchema, {
    defaultValues: { employeeId: "", role: "HOMEROOM" },
  });
  const [addingTeacher, setAddingTeacher] = useState(false);

  // Homeroom-replace confirm — appears on top of this dialog after the API
  // returns 409 HOMEROOM_EXISTS.
  const [replaceHomeroom, setReplaceHomeroom] = useState<{
    existingAssignmentId: string;
    existingEmployeeId: string;
    existingEmployeeName: string;
    newEmployeeId: string;
    newEmployeeName: string;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    teacherForm.reset({ employeeId: "", role: "HOMEROOM" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitAddTeacher = teacherForm.handleSubmit(async (values) => {
    setAddingTeacher(true);
    try {
      const res = await fetch(`/api/admin/classes/${classId}/teaching-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: values.employeeId,
          role: values.role,
        }),
      });
      if (res.ok) {
        toast.success("Guru ditambahkan");
        onOpenChange(false);
        onAdded();
        return;
      }
      const body: { error?: string; code?: string; existingAssignmentId?: string; existingEmployeeId?: string; existingEmployeeName?: string } =
        await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === "HOMEROOM_EXISTS" && body.existingEmployeeId) {
        const newEmployeeName =
          employeeOptions.find((e) => e.id === values.employeeId)?.nama ?? "guru ini";
        setReplaceHomeroom({
          existingAssignmentId: body.existingAssignmentId ?? "",
          existingEmployeeId: body.existingEmployeeId,
          existingEmployeeName: body.existingEmployeeName ?? "",
          newEmployeeId: values.employeeId,
          newEmployeeName,
        });
        return;
      }
      applyServerErrors(
        teacherForm,
        new ApiError(body.error ?? "Gagal menambahkan guru", { status: res.status }),
        "Gagal menambahkan guru",
      );
    } catch {
      toast.error("Gagal menyimpan guru. Coba lagi.");
    } finally {
      setAddingTeacher(false);
    }
  });

  async function confirmReplaceHomeroom() {
    if (!replaceHomeroom) return;
    setAddingTeacher(true);
    try {
      const postRes = await fetch(`/api/admin/classes/${classId}/teaching-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: replaceHomeroom.newEmployeeId,
          replaceAssignmentId: replaceHomeroom.existingAssignmentId,
          role: "HOMEROOM",
        }),
      });
      if (postRes.ok) {
        toast.success("Wali kelas diganti");
        setReplaceHomeroom(null);
        onOpenChange(false);
        onAdded();
      } else {
        const d = await postRes.json().catch(() => ({}));
        toast.error(d.error ?? "Gagal menambahkan wali kelas baru");
      }
    } catch {
      toast.error("Gagal menyimpan guru. Coba lagi.");
    } finally {
      setAddingTeacher(false);
    }
  }

  return (
    <>
      <ResponsiveFormDialog
        open={open}
        onOpenChange={(v) => {
          onOpenChange(v);
          if (!v) setReplaceHomeroom(null);
        }}
        title="Tambah Guru Pengajar"
        description="Pilih guru aktif dan peran penugasan."
        footer={
          <FormDialogFooter
            formId={formId}
            pending={addingTeacher}
            onCancel={() => onOpenChange(false)}
            submitLabel="Tambahkan"
            pendingLabel="Menambahkan..."
          />
        }
      >
        <form id={formId} onSubmit={submitAddTeacher} noValidate className="space-y-field">
          <FormRootError formState={teacherForm.formState} />
          <FormField
            control={teacherForm.control}
            name="employeeId"
            label="Guru"
            required
            id="class-teacher"
            render={({ field, controlProps }) => (
              <Select items={employeeOptions.map((e) => ({ value: e.id, label: e.nama }))} value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih guru..." />
                </SelectTrigger>
                <SelectContent>
                  <TeacherOptionItems status={employeesStatus} options={employeeOptions} />
                </SelectContent>
              </Select>
            )}
          />
          <TeacherOptionsError status={employeesStatus} onRetry={onRetryEmployees} />
          {employeesTruncated && (
            <p className="text-xs text-muted-foreground">
              Daftar guru dipotong pada 100 nama — jika guru yang dicari
              tidak muncul, hubungi admin.
            </p>
          )}
          <FormField
            control={teacherForm.control}
            name="role"
            label="Peran"
            required
            id="class-teaching-role"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOMEROOM">Wali Kelas</SelectItem>
                  <SelectItem value="ASSISTANT">Asisten</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </form>
      </ResponsiveFormDialog>

      <ConfirmDialog
        open={!!replaceHomeroom}
        onOpenChange={(v) => !v && setReplaceHomeroom(null)}
        title="Ganti wali kelas?"
        description={
          replaceHomeroom
            ? `Kelas sudah memiliki wali kelas ${replaceHomeroom.existingEmployeeName}. Ganti dengan ${replaceHomeroom.newEmployeeName}?`
            : ""
        }
        confirmLabel="Ganti"
        onConfirm={confirmReplaceHomeroom}
      />
    </>
  );
}
