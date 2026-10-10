"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { DossierSection } from "@/components/admin/dossier-section";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormRootError } from "@/components/ui/form";
import { Pencil } from "lucide-react";
import { formatDateShort } from "@/lib/format";
import { withdrawalReasonFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import type { Student } from "./types";

/**
 * "Riwayat Status" — read-only lifecycle context for WITHDRAWN/GRADUATED,
 * except the withdrawal reason, which is editable inline (RHF). Dates stay
 * read-only: they're owned by the `/promote`/`/graduate`/`/withdraw`
 * lifecycle APIs, not this PUT.
 */
export function RiwayatStatusSection({
  student,
  open,
  onOpenChange,
  onSaved,
}: {
  student: Student;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const form = useZodForm(withdrawalReasonFormSchema, {
    defaultValues: { withdrawalReason: student.withdrawalReason ?? "" },
  });

  // Keep the draft in step with the student record while not mid-edit — a
  // refetch after some other change (e.g. Simpan on Data Anak) must not
  // clobber an in-progress edit here.
  useEffect(() => {
    if (!editing) form.reset({ withdrawalReason: student.withdrawalReason ?? "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student.withdrawalReason, editing]);

  function startEditing() {
    form.reset({ withdrawalReason: student.withdrawalReason ?? "" });
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    form.reset({ withdrawalReason: student.withdrawalReason ?? "" });
  }

  const handleSave = form.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/students/${student.id}`, { method: "PUT", body: values }, "Gagal menyimpan");
      toast.success("Alasan diperbarui");
      setEditing(false);
      onSaved();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan");
    }
  });

  const saving = form.formState.isSubmitting;

  return (
    <DossierSection id="riwayat-status" label="Riwayat Status" open={open} onOpenChange={onOpenChange}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {student.status === "WITHDRAWN" && (
          <>
            {student.withdrawalDate && (
              <div>
                <p className="text-xs text-muted-foreground">Tanggal Keluar</p>
                <p className="text-sm font-medium">{formatDateShort(student.withdrawalDate)}</p>
              </div>
            )}
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Alasan Keluar</p>
                {student.canEdit === true && !editing && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={startEditing}>
                    <Pencil size={11} className="mr-1" aria-hidden="true" /> Ubah
                  </Button>
                )}
              </div>
              {editing ? (
                <form id={formId} onSubmit={handleSave} noValidate className="space-y-field">
                  <FormRootError formState={form.formState} />
                  <FormField
                    control={form.control}
                    name="withdrawalReason"
                    id="withdraw-reason-edit"
                    render={({ field, controlProps }) => (
                      <Textarea {...field} {...controlProps} rows={2} aria-label="Alasan keluar" />
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={cancelEditing} disabled={saving}>
                      Batal
                    </Button>
                    <Button type="submit" form={formId} size="sm" disabled={saving}>
                      {saving ? "Menyimpan..." : "Simpan"}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm">{student.withdrawalReason || <span className="text-muted-foreground">—</span>}</p>
              )}
            </div>
          </>
        )}
        {student.status === "GRADUATED" && student.graduationDate && (
          <div>
            <p className="text-xs text-muted-foreground">Tanggal Lulus</p>
            <p className="text-sm font-medium">{formatDateShort(student.graduationDate)}</p>
          </div>
        )}
      </div>
    </DossierSection>
  );
}
