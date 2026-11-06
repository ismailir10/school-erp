"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormDialogFooter } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendJson } from "@/lib/api/send-json";

import { CheckList } from "./check-list";
import { toFieldErrors, type FieldErrors } from "./form-errors";
import { toYmd } from "./grid-utils";
import type { RotationDetail, SentraOptions } from "./types";

type Initial = Pick<RotationDetail, "id" | "name" | "startDate" | "cycleDays" | "status" | "classes"> & {
  academicYear: { id: string; name: string };
};

/**
 * Create (rotation = null, needs campusId + options) or edit a putaran.
 * Editing keeps the tahun ajaran fixed; its class choices come from the
 * same year.
 */
export function RotationDialog({
  open,
  onOpenChange,
  campusId,
  options,
  rotation,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusId: string;
  options: SentraOptions;
  rotation: Initial | null;
  onSaved: (id: string) => void;
}) {
  const formId = useId();
  const editing = rotation !== null;
  const [name, setName] = useState("");
  const [yearId, setYearId] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("");
  const [cycleDays, setCycleDays] = useState("10");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (rotation) {
      setName(rotation.name);
      setYearId(rotation.academicYear.id);
      setClassIds(rotation.classes.map((c) => c.classSectionId));
      setStartDate(toYmd(rotation.startDate));
      setCycleDays(String(rotation.cycleDays));
      setStatus(rotation.status);
    } else {
      const active = options.academicYears.find((y) => y.status === "ACTIVE") ?? options.academicYears[0];
      setName("");
      setYearId(active?.id ?? "");
      setClassIds([]);
      setStartDate("");
      setCycleDays("10");
      setStatus("ACTIVE");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rotation]);

  const classOptions = useMemo(
    () => options.classes.filter((c) => c.academicYearId === yearId).map((c) => ({ id: c.id, label: c.name })),
    [options.classes, yearId],
  );

  function changeYear(id: string) {
    setYearId(id);
    setClassIds([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    const days = Number(cycleDays);
    try {
      if (editing) {
        await sendJson(
          `/api/admin/sentra/rotations/${rotation.id}`,
          {
            method: "PATCH",
            body: { name, startDate, cycleDays: days, status, classSectionIds: classIds },
          },
          "Gagal menyimpan putaran",
        );
        toast.success("Putaran diperbarui");
        onOpenChange(false);
        onSaved(rotation.id);
      } else {
        const created = await sendJson<{ id: string }>(
          "/api/admin/sentra/rotations",
          {
            method: "POST",
            body: { campusId, academicYearId: yearId, name, startDate, cycleDays: days, classSectionIds: classIds },
          },
          "Gagal membuat putaran",
        );
        toast.success("Putaran dibuat");
        onOpenChange(false);
        onSaved(created.id);
      }
    } catch (err) {
      setErrors(toFieldErrors(err, editing ? "Gagal menyimpan putaran" : "Gagal membuat putaran"));
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string, id: string) =>
    errors[key] ? (
      <p id={id} role="alert" className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Ubah Putaran" : "Buat Putaran"}
      description="Putaran mengatur sentra tiap kelas dari hari ke hari."
      footer={
        <FormDialogFooter
          formId={formId}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          submitLabel={editing ? "Simpan Perubahan" : "Buat Putaran"}
        />
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-field">
        {errors.root && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{errors.root}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="rot-name">Nama putaran</Label>
          <Input
            id="rot-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Contoh: Putaran TK"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "rot-name-error" : undefined}
          />
          {fieldError("name", "rot-name-error")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rot-year">Tahun ajaran</Label>
          <Select value={yearId} onValueChange={(v) => v && changeYear(v)} disabled={editing}>
            <SelectTrigger id="rot-year" aria-invalid={errors.academicYearId ? true : undefined}>
              <SelectValue placeholder="Pilih tahun ajaran" />
            </SelectTrigger>
            <SelectContent>
              {options.academicYears.map((y) => (
                <SelectItem key={y.id} value={y.id}>
                  {y.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldError("academicYearId", "rot-year-error")}
        </div>
        <CheckList
          legend="Kelas yang ikut berputar"
          options={classOptions}
          value={classIds}
          onChange={setClassIds}
          emptyText="Belum ada kelas aktif di tahun ajaran ini."
          error={errors.classSectionIds}
          describedBy="rot-classes-error"
        />
        <div className="grid grid-cols-1 gap-field sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rot-start">Mulai</Label>
            <Input
              id="rot-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-invalid={errors.startDate ? true : undefined}
              aria-describedby={errors.startDate ? "rot-start-error" : "rot-start-hint"}
            />
            {fieldError("startDate", "rot-start-error")}
            <p id="rot-start-hint" className="text-xs text-muted-foreground">
              Akhir pekan dipindah ke Senin berikutnya.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rot-days">Jumlah hari</Label>
            <Input
              id="rot-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              value={cycleDays}
              onChange={(e) => setCycleDays(e.target.value)}
              aria-invalid={errors.cycleDays ? true : undefined}
              aria-describedby={errors.cycleDays ? "rot-days-error" : undefined}
            />
            {fieldError("cycleDays", "rot-days-error")}
          </div>
        </div>
        {editing && (
          <div className="space-y-1.5">
            <Label htmlFor="rot-status">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v as "ACTIVE" | "INACTIVE")}>
              <SelectTrigger id="rot-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Aktif</SelectItem>
                <SelectItem value="INACTIVE">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Putaran nonaktif tidak memberi akses ke guru sentra.</p>
          </div>
        )}
      </form>
    </ResponsiveFormDialog>
  );
}
