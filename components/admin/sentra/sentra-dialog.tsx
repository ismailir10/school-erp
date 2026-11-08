"use client";

import { useEffect, useId, useState } from "react";
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
import type { SentraOptions, SentraRow } from "./types";

/** Create (sentra = null) or edit a sentra. Deactivation replaces deletion. */
export function SentraDialog({
  open,
  onOpenChange,
  campusId,
  sentra,
  employees,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusId: string;
  sentra: SentraRow | null;
  employees: SentraOptions["employees"];
  onSaved: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState("");
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const editing = sentra !== null;

  useEffect(() => {
    if (!open) return;
    setName(sentra?.name ?? "");
    setTeacherIds(sentra?.teachers.map((t) => t.employeeId) ?? []);
    setSortOrder(sentra ? String(sentra.sortOrder) : "");
    setStatus(sentra?.status ?? "ACTIVE");
    setErrors({});
  }, [open, sentra]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    const order = sortOrder.trim() === "" ? undefined : Number(sortOrder);
    try {
      if (editing) {
        await sendJson(
          `/api/admin/sentra/${sentra.id}`,
          { method: "PATCH", body: { name, status, teacherIds, sortOrder: order } },
          "Gagal menyimpan sentra",
        );
        toast.success("Sentra diperbarui");
      } else {
        await sendJson(
          "/api/admin/sentra",
          { method: "POST", body: { campusId, name, teacherIds, sortOrder: order } },
          "Gagal menambahkan sentra",
        );
        toast.success("Sentra ditambahkan");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setErrors(toFieldErrors(err, editing ? "Gagal menyimpan sentra" : "Gagal menambahkan sentra"));
    } finally {
      setPending(false);
    }
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Ubah Sentra" : "Tambah Sentra"}
      description="Nama sentra dan guru yang memegangnya."
      footer={
        <FormDialogFooter
          formId={formId}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          submitLabel={editing ? "Simpan Perubahan" : "Tambah Sentra"}
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
          <Label htmlFor="sentra-name">Nama sentra</Label>
          <Input
            id="sentra-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Contoh: Balok"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "sentra-name-error" : undefined}
          />
          {errors.name && (
            <p id="sentra-name-error" role="alert" className="text-sm text-destructive">
              {errors.name}
            </p>
          )}
        </div>
        <CheckList
          legend="Guru sentra"
          options={employees.map((e) => ({ id: e.id, label: e.name }))}
          value={teacherIds}
          onChange={setTeacherIds}
          emptyText="Belum ada guru aktif di kampus ini."
          error={errors.teacherIds}
          describedBy="sentra-teachers-error"
        />
        <div className="space-y-1.5">
          <Label htmlFor="sentra-order">Urutan (opsional)</Label>
          <Input
            id="sentra-order"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            aria-invalid={errors.sortOrder ? true : undefined}
            aria-describedby={errors.sortOrder ? "sentra-order-error" : undefined}
          />
          {errors.sortOrder && (
            <p id="sentra-order-error" role="alert" className="text-sm text-destructive">
              {errors.sortOrder}
            </p>
          )}
        </div>
        {editing && (
          <div className="space-y-1.5">
            <Label htmlFor="sentra-status">Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v as "ACTIVE" | "INACTIVE")}>
              <SelectTrigger id="sentra-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Aktif</SelectItem>
                <SelectItem value="INACTIVE">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sentra nonaktif hilang dari pilihan, riwayatnya tetap tampil.
            </p>
          </div>
        )}
      </form>
    </ResponsiveFormDialog>
  );
}
