"use client";

import { useId, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter } from "@/components/ui/form";
import { EntityLink } from "@/components/entity-link";
import { entityHref } from "@/lib/entity-links";
import { formatDateShort, formatTime } from "@/lib/format";

export type PendingCheckIn = {
  id: string;
  date: string;
  status: string;
  checkInTime: string | null;
  distanceMeters: number | null;
  accuracy: number | null;
  note: string | null;
  campusName: string;
  employee: { id: string; kode: string; nama: string; jabatan: string };
};

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * "Perlu persetujuan" tab: geofence check-ins waiting for a decision.
 * Setujui / Tolak are one tap each (Tolak opens an optional note), plus
 * "Setujui semua". `onChanged` reloads the pending list and the day's table.
 */
export function PendingApprovals({
  rows,
  loading,
  onChanged,
}: {
  rows: PendingCheckIn[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejecting, setRejecting] = useState<PendingCheckIn | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const rejectFormId = useId();

  async function decide(row: PendingCheckIn, decision: "approve" | "reject", note?: string) {
    setBusyId(row.id);
    try {
      const res = await post(`/api/attendance/${row.id}/${decision}`, note ? { note } : {});
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(typeof data.error === "string" && data.error.includes(" ") ? data.error : "Gagal menyimpan keputusan. Coba lagi.");
        // 409 means someone else already decided: refresh either way.
        if (res.status === 409) onChanged();
        return;
      }
      toast.success(decision === "approve" ? `Absensi ${row.employee.nama} disetujui` : `Absensi ${row.employee.nama} ditolak`);
      setRejecting(null);
      setRejectNote("");
      onChanged();
    } catch {
      toast.error("Koneksi terputus. Periksa internet, lalu coba lagi.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveAll() {
    setBulkBusy(true);
    try {
      const res = await post("/api/attendance/approve-all", { ids: rows.map((r) => r.id) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Gagal menyetujui semua. Coba lagi.");
        return;
      }
      toast.success(`${data.count ?? rows.length} absensi disetujui`);
      onChanged();
    } catch {
      toast.error("Koneksi terputus. Periksa internet, lalu coba lagi.");
    } finally {
      setBulkBusy(false);
    }
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title="Tidak ada yang perlu disetujui" description="Absensi di luar area kampus akan muncul di sini." />;
  }

  return (
    <div className="space-y-3" data-testid="pending-approvals">
      <div className="flex justify-end">
        <Button onClick={approveAll} disabled={bulkBusy || rows.length === 0} className="min-h-11">
          <Check size={16} className="mr-1.5" /> {bulkBusy ? "Menyetujui…" : "Setujui semua"}
        </Button>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 rounded-lg border p-card sm:flex-row sm:items-center sm:justify-between" data-testid="pending-row">
            <div className="min-w-0 space-y-1">
              <p className="text-body font-semibold">
                <EntityLink href={entityHref.employee(r.employee.id)}>{r.employee.nama}</EntityLink>
              </p>
              <p className="text-small text-muted-foreground">
                {r.employee.kode} · {formatDateShort(r.date)}, {formatTime(r.checkInTime)}
              </p>
              <p className="text-small">
                {r.distanceMeters === null
                  ? "Lokasi tidak terbaca"
                  : `± ${r.distanceMeters} m dari ${r.campusName}`}
              </p>
              {r.note ? <p className="whitespace-pre-wrap break-words text-small text-muted-foreground">“{r.note}”</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" className="min-h-11" disabled={busyId === r.id} onClick={() => setRejecting(r)}>
                <X size={16} className="mr-1.5" /> Tolak
              </Button>
              <Button className="min-h-11" disabled={busyId === r.id} onClick={() => decide(r, "approve")}>
                <Check size={16} className="mr-1.5" /> Setujui
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ResponsiveFormDialog
        open={rejecting !== null}
        onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectNote(""); } }}
        title={rejecting ? `Tolak absensi ${rejecting.employee.nama}?` : "Tolak absensi"}
        description="Hari ini dicatat sebagai alpa. Catatan boleh dikosongkan."
        size="md"
        footer={
          <FormDialogFooter
            formId={rejectFormId}
            pending={busyId !== null}
            onCancel={() => { setRejecting(null); setRejectNote(""); }}
            submitLabel="Tolak"
            submitVariant="destructive"
            pendingLabel="Menyimpan…"
          />
        }
      >
        <form
          id={rejectFormId}
          onSubmit={(e) => { e.preventDefault(); if (rejecting) void decide(rejecting, "reject", rejectNote.trim() || undefined); }}
          className="space-y-2"
        >
          <label htmlFor="reject-note" className="text-small font-semibold">Catatan (opsional)</label>
          <Textarea id="reject-note" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} maxLength={500} rows={3} className="text-base" />
        </form>
      </ResponsiveFormDialog>
    </div>
  );
}
