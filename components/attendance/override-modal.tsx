"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { toast } from "sonner";

const STATUSES = [
  { value: "PRESENT", label: "Hadir" },
  { value: "LATE", label: "Terlambat" },
  { value: "ABSENT", label: "Alpa" },
  { value: "LEAVE", label: "Izin" },
  { value: "HALF_DAY", label: "Setengah Hari" },
];

export function OverrideModal({
  open,
  onOpenChange,
  recordId,
  employeeId,
  employeeName,
  date,
  currentStatus,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string | null;
  employeeId: string;
  employeeName: string;
  date: string;
  currentStatus: string | null;
  onSuccess: () => void;
}) {
  const [status, setStatus] = useState(currentStatus ?? "PRESENT");
  const [reason, setReason] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(currentStatus ?? "PRESENT");
    setReason("");
    setCheckInTime("");
  }, [currentStatus, open]);

  async function handleSave() {
    if (!reason.trim()) { toast.error("Alasan wajib diisi"); return; }
    setSaving(true);

    if (recordId) {
      // Update existing record
      const res = await fetch(`/api/attendance/${recordId}/override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason, checkInTime: checkInTime || undefined }),
      });
      if (res.ok) {
        toast.success("Kehadiran diperbarui");
        onOpenChange(false);
        onSuccess();
      } else {
        const data = await res.json();
        toast.error(data.error || "Gagal menyimpan");
      }
    } else {
      // Create new record for employee on this date
      const res = await fetch(`/api/attendance/${employeeId}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, status, reason, checkInTime: checkInTime || undefined }),
      });
      if (res.ok) {
        toast.success("Kehadiran ditambahkan");
        onOpenChange(false);
        onSuccess();
      } else {
        const data = await res.json();
        toast.error(data.error || "Gagal menyimpan");
      }
    }
    setSaving(false);
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Timpa Kehadiran"
      description={`${employeeName} — ${new Date(date + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </>
      }
    >
          <Field>
            <FieldLabel required>Status</FieldLabel>
            <Select value={status} onValueChange={(v) => v && setStatus(v)}>
              <SelectTrigger aria-required>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {(status === "PRESENT" || status === "LATE") && (
            <Field>
              <FieldLabel>Waktu Masuk</FieldLabel>
              <Input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
            </Field>
          )}
          <Field>
            <FieldLabel required>Alasan</FieldLabel>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Sakit, konfirmasi via WA"
              required
              aria-required
              rows={2}
            />
          </Field>
    </ResponsiveFormDialog>
  );
}
