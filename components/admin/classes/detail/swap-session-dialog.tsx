"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormField, FormRootError } from "@/components/ui/form";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sendJson } from "@/lib/api/send-json";
import { userMessage } from "@/lib/api/client-errors";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { formatDate as formatDateLong } from "@/lib/format";
import { swapClassSessionTeacherFormSchema } from "@/lib/validations/class-session";

import { SLOT_LABELS, type SessionRow } from "@/components/admin/class-sessions-calendar";
import {
  TeacherOptionItems,
  TeacherOptionsError,
  type TeacherOptionsStatus,
} from "./teacher-option-items";
import type { Employee } from "./types";

/**
 * "Ubah Guru Sesi" dialog — split out of `app/admin/classes/[id]/client.tsx`
 * (T2, 2026-09-27 admin-finish-standard cycle).
 *
 * Simpan now submits through `swapForm.handleSubmit` instead of calling the
 * PATCH directly off `swapForm.watch(...)`, so
 * `swapClassSessionTeacherFormSchema`'s reason-required rule actually runs
 * before anything hits the wire. "Kembalikan ke wali kelas" deliberately
 * bypasses the form (no reason applies to a revert), unchanged from before
 * the split — same for the no-write-access body.
 */
export function SwapSessionDialog({
  selectedSession,
  writeAllowed,
  employeeOptions,
  employeesTruncated,
  employeesStatus,
  onRetryEmployees,
  onClose,
  onSaved,
}: {
  selectedSession: SessionRow | null;
  writeAllowed: boolean;
  employeeOptions: Employee[];
  employeesTruncated: boolean;
  employeesStatus: TeacherOptionsStatus;
  onRetryEmployees: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const swapForm = useZodForm(swapClassSessionTeacherFormSchema, {
    defaultValues: { teacherId: "", substituteReason: "", defaultTeacherId: null },
  });
  const [reverting, setReverting] = useState(false);

  // Re-seed the form every time the dialog opens onto a (possibly different)
  // session, and blank it again once it closes — mirrors the pre-split
  // `openSession`/`closeSwap` pair, which called `swapForm.reset(...)` at
  // both of those exact points rather than reactively.
  useEffect(() => {
    if (selectedSession) {
      swapForm.reset({
        teacherId: selectedSession.teacherId ?? "",
        substituteReason: selectedSession.substituteReason ?? "",
        defaultTeacherId: selectedSession.defaultTeacherId,
      });
    } else {
      swapForm.reset({ teacherId: "", substituteReason: "", defaultTeacherId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession]);

  const submitSwap = swapForm.handleSubmit(async (values) => {
    if (!selectedSession) return;
    try {
      await sendJson(
        `/api/admin/class-sessions/${selectedSession.id}`,
        {
          method: "PATCH",
          body: {
            teacherId: values.teacherId || null,
            substituteReason: values.substituteReason || undefined,
          },
        },
        "Gagal menyimpan perubahan guru",
      );
      toast.success("Guru sesi diperbarui");
      onClose();
      onSaved();
    } catch (err) {
      applyServerErrors(swapForm, err, "Gagal menyimpan perubahan guru");
    }
  });

  // Deliberately bypasses the form: reverting to the homeroom teacher never
  // needs a reason (it clears any stale one), so there is nothing for
  // `swapClassSessionTeacherFormSchema` to validate here.
  async function revertToHomeroom() {
    if (!selectedSession?.defaultTeacherId) return;
    setReverting(true);
    try {
      await sendJson(
        `/api/admin/class-sessions/${selectedSession.id}`,
        {
          method: "PATCH",
          body: { teacherId: selectedSession.defaultTeacherId, substituteReason: undefined },
        },
        "Gagal menyimpan perubahan guru",
      );
      toast.success("Guru sesi diperbarui");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(userMessage(err, "Gagal menyimpan perubahan guru"));
    } finally {
      setReverting(false);
    }
  }

  const pending = swapForm.formState.isSubmitting || reverting;

  return (
    <ResponsiveFormDialog
      open={selectedSession !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Ubah Guru Sesi"
      description={
        selectedSession
          ? `${formatDateLong(selectedSession.date, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })} · ${SLOT_LABELS[selectedSession.slot] ?? selectedSession.slot}`
          : undefined
      }
      footer={
        writeAllowed && selectedSession ? (
          <>
            <Button type="submit" form={formId} disabled={pending}>
              {swapForm.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
            {selectedSession.defaultTeacherId && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={revertToHomeroom}
              >
                Kembalikan ke wali kelas
              </Button>
            )}
          </>
        ) : null
      }
    >
      {selectedSession && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Wali kelas</span>
            <span className="font-medium">
              {selectedSession.defaultTeacher?.nama ?? "Tidak ada"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Guru saat ini</span>
            <span className="font-medium">
              {selectedSession.teacher?.nama ?? "Belum ada guru"}
            </span>
          </div>

          {writeAllowed ? (
            <form id={formId} onSubmit={submitSwap} noValidate className="flex flex-col gap-4">
              <FormRootError formState={swapForm.formState} />
              <FormField
                control={swapForm.control}
                name="teacherId"
                label="Guru pengganti"
                id="session-substitute-teacher"
                render={({ field, controlProps }) => (
                  <Select
                    items={employeeOptions.map((e) => ({ value: e.id, label: e.nama }))}
                    value={field.value}
                    onValueChange={(v) => v != null && field.onChange(v)}
                  >
                    <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                      <SelectValue placeholder="Pilih guru" />
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
                  Daftar guru dipotong pada 100 nama — jika guru yang
                  dicari tidak muncul, hubungi admin.
                </p>
              )}

              <FormField
                control={swapForm.control}
                name="substituteReason"
                label="Alasan pengganti"
                id="session-substitute-reason"
                render={({ field, controlProps }) => (
                  <Textarea
                    {...field}
                    {...controlProps}
                    value={field.value ?? ""}
                    placeholder="Contoh: wali kelas sedang cuti"
                    maxLength={300}
                    rows={3}
                  />
                )}
              />
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Anda tidak memiliki akses untuk mengubah guru sesi.
            </p>
          )}
        </div>
      )}
    </ResponsiveFormDialog>
  );
}
