"use client";

import { MESSAGES } from "@/lib/feedback";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ProgramChangeImpact } from "@/components/admin/classes/program-change-impact";
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

/** Detail and list edit the same class fields and share the billing-impact guard. */
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
  data: Pick<ClassDetail, "name" | "capacity" | "slotTemplate" | "programId" | "program" | "ageGroup"> | null;
  onSaved: () => void;
}) {
  const formId = useId();
  const form = useZodForm(classEditFormSchema, {
    defaultValues: { name: "", capacity: 20, slotTemplate: "FULL_DAY", programId: "", ageGroup: "A" },
  });

  const [programs, setPrograms] = useState<Array<{ id: string; name: string; code: string; status?: string }>>([]);
  const [programsError, setProgramsError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [programBlocked, setProgramBlocked] = useState(false);
  const nextProgramId = form.watch("programId");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setProgramsError(false);
    fetch("/api/programs", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error();
      if (!controller.signal.aborted) setPrograms(rows);
    }).catch(() => { if (!controller.signal.aborted) setProgramsError(true); });
    return () => controller.abort();
  }, [open, retryKey]);

  useEffect(() => {
    if (!open || !data) return;
    setProgramBlocked(false);
    form.reset({ name: data.name, capacity: data.capacity, slotTemplate: data.slotTemplate, programId: data.programId, ageGroup: data.ageGroup });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

  const save = form.handleSubmit(async (values) => {
    if (programBlocked) return;
    try {
      await sendJson(
        `/api/admin/classes/${classId}`,
        {
          method: "PATCH",
          body: {
            name: values.name,
            capacity: values.capacity,
            slotTemplate: values.slotTemplate,
            ageGroup: values.ageGroup,
            ...(values.programId !== data?.programId ? { programId: values.programId } : {}),
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
      description="Perbarui program, kelompok usia, nama, kapasitas, atau pola slot."
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          disabled={programBlocked}
          onCancel={() => onOpenChange(false)}
          submitLabel="Simpan"
        />
      }
    >
      <form id={formId} onSubmit={save} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField control={form.control} name="programId" label="Program" required id="class-detail-program" render={({ field, controlProps }) => {
          const options = [...programs.filter((p) => p.status === "ACTIVE" || p.id === data?.programId)];
          if (data && !options.some((p) => p.id === data.programId)) options.push(data.program);
          return <Select items={options.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))} value={field.value} onValueChange={(value) => value != null && field.onChange(value)}>
            <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih program" /></SelectTrigger>
            <SelectContent>{options.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}</SelectContent>
          </Select>;
        }} />
        {programsError && <div role="alert" className="text-sm"><p>Gagal memuat pilihan program.</p><Button type="button" variant="link" onClick={() => setRetryKey((key) => key + 1)}>Coba lagi</Button></div>}
        {data && <ProgramChangeImpact classId={classId} currentProgramId={data.programId} nextProgramId={nextProgramId} onBlockedChange={setProgramBlocked} />}
        <FormField control={form.control} name="ageGroup" label="Kelompok usia" required id="class-detail-age-group" render={({ field, controlProps }) => (
          <Select items={[{ value: "A", label: "A · 4–5 tahun (TK A)" }, { value: "B", label: "B · 5–6 tahun (TK B)" }]} value={field.value} onValueChange={(value) => value != null && field.onChange(value)}>
            <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih kelompok usia" /></SelectTrigger>
            <SelectContent><SelectItem value="A">A · 4–5 tahun (TK A)</SelectItem><SelectItem value="B">B · 5–6 tahun (TK B)</SelectItem></SelectContent>
          </Select>
        )} />
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
