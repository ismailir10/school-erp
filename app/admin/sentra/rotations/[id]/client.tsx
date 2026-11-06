"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import {
  buildGrid,
  dayLabels,
  findInactiveCells,
  gridToSlots,
  isGridDirty,
  toYmd,
  type GridState,
} from "@/components/admin/sentra/grid-utils";
import { RotationDialog } from "@/components/admin/sentra/rotation-dialog";
import { RotationGrid } from "@/components/admin/sentra/rotation-grid";
import type { RotationDetail, SentraOptions } from "@/components/admin/sentra/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { userMessage } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { formatDate } from "@/lib/format";

const EMPTY_OPTIONS: SentraOptions = { employees: [], classes: [], academicYears: [] };

export function RotationDetailClient({
  rotationId,
  canWrite,
}: {
  rotationId: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<RotationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState<GridState>({});
  const [grid, setGrid] = useState<GridState>({});
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<SentraOptions>(EMPTY_OPTIONS);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`/api/admin/sentra/rotations/${rotationId}`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as RotationDetail;
      setData(json);
      const g = buildGrid(json.slots);
      setSaved(g);
      setGrid(g);
    } catch {
      setLoadError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [rotationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canWrite || !data?.campusId) return;
    fetch(`/api/admin/sentra/options?campusId=${encodeURIComponent(data.campusId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((o: SentraOptions) => setOptions(o))
      .catch(() => toast.error("Gagal memuat pilihan kelas"));
  }, [canWrite, data?.campusId]);

  const classIds = useMemo(() => data?.classes.map((c) => c.classSectionId) ?? [], [data]);
  const cycleDays = data?.cycleDays ?? 0;
  const dirty = data ? isGridDirty(saved, grid, cycleDays, classIds) : false;
  const hasInactive = data
    ? findInactiveCells(grid, cycleDays, classIds, data.sentra).cells.size > 0
    : false;

  // Simple unsaved-changes guard for tab close / reload.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save() {
    if (!data) return;
    setSaving(true);
    try {
      await sendJson(
        `/api/admin/sentra/rotations/${data.id}/slots`,
        { method: "PUT", body: { slots: gridToSlots(grid, cycleDays, classIds) } },
        "Gagal menyimpan putaran",
      );
      toast.success("Putaran tersimpan");
      setSaved(grid);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menyimpan putaran"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!data) return;
    setDeleting(true);
    try {
      await sendJson(`/api/admin/sentra/rotations/${data.id}`, { method: "DELETE" }, "Gagal menghapus putaran");
      toast.success("Putaran dihapus");
      router.push(`/admin/sentra?campusId=${encodeURIComponent(data.campusId)}`);
    } catch (err) {
      toast.error(userMessage(err, "Gagal menghapus putaran"));
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-field" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <ErrorState title="Gagal memuat putaran" description="Coba lagi sebentar ya." onRetry={() => { setLoading(true); void load(); }}>
        <Button variant="outline" render={<Link href="/admin/sentra" />}>Kembali ke Sentra</Button>
      </ErrorState>
    );
  }

  const backHref = `/admin/sentra?campusId=${encodeURIComponent(data.campusId)}`;
  const meta = `${data.academicYear.name} · Mulai ${formatDate(toYmd(data.startDate))} · ${data.cycleDays} hari`;

  return (
    <div>
      <Link
        href={backHref}
        className="mb-field inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Sentra
      </Link>
      <PageHeader
        title={data.name}
        description={meta}
        badge={
          <StatusBadge status={data.status} label={data.status === "ACTIVE" ? "Aktif" : "Nonaktif"} />
        }
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}>Ubah</Button>
              <Button variant="outline" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                Hapus
              </Button>
            </>
          ) : undefined
        }
      />

      <section aria-labelledby="grid-title" className="space-y-field">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="grid-title" className="text-h2 font-semibold text-foreground">
            Sentra per kelas
          </h2>
          {canWrite && (
            <Button onClick={save} disabled={!dirty || hasInactive || saving} aria-busy={saving || undefined}>
              {saving ? "Menyimpan..." : "Simpan putaran"}
            </Button>
          )}
        </div>
        <RotationGrid
          grid={grid}
          onChange={(key, sentraId) => setGrid((g) => ({ ...g, [key]: sentraId }))}
          labels={dayLabels(data.startDate, data.cycleDays)}
          classes={data.classes}
          sentra={data.sentra}
          startDate={data.startDate}
          readOnly={!canWrite}
        />
      </section>

      {canWrite && (
        <>
          <RotationDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            campusId={data.campusId}
            options={options}
            rotation={data}
            onSaved={() => void load()}
          />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Hapus putaran?"
            description={`Putaran ${data.name} dan seluruh isian gridnya akan dihapus. Tindakan ini tidak bisa dibatalkan.`}
            confirmLabel="Hapus"
            destructive
            loading={deleting}
            onConfirm={remove}
          />
        </>
      )}
    </div>
  );
}
