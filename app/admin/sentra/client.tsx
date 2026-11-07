"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { RotationDialog } from "@/components/admin/sentra/rotation-dialog";
import { SentraDialog } from "@/components/admin/sentra/sentra-dialog";
import type { RotationRow, SentraOptions, SentraRow } from "@/components/admin/sentra/types";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { sentraLabel } from "@/lib/sentra/rotation";

type Campus = { id: string; name: string };

const EMPTY_OPTIONS: SentraOptions = { employees: [], classes: [], academicYears: [] };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-h2 text-foreground">{children}</h2>;
}

export function SentraClient({
  canWrite,
  initialCampusId,
}: {
  canWrite: boolean;
  initialCampusId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campusesLoaded, setCampusesLoaded] = useState(false);
  const [campusId, setCampusId] = useState(initialCampusId ?? "");

  const [sentra, setSentra] = useState<SentraRow[]>([]);
  const [rotations, setRotations] = useState<RotationRow[]>([]);
  const [options, setOptions] = useState<SentraOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [sentraDialog, setSentraDialog] = useState<{ open: boolean; row: SentraRow | null }>({
    open: false,
    row: null,
  });
  const [rotationOpen, setRotationOpen] = useState(false);

  // Campuses once; default to the first one unless the URL names a valid one.
  useEffect(() => {
    fetch("/api/config/campuses")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : []) as Campus[];
        setCampuses(list);
        setCampusId((current) => (list.some((c) => c.id === current) ? current : (list[0]?.id ?? "")));
      })
      .catch(() => toast.error("Gagal memuat daftar kampus"))
      .finally(() => setCampusesLoaded(true));
  }, []);

  const load = useCallback(async () => {
    if (!campusId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/admin/sentra?campusId=${encodeURIComponent(campusId)}`);
      if (!res.ok) throw new Error("load");
      const json = (await res.json()) as { sentra: SentraRow[]; rotations: RotationRow[] };
      setSentra(json.sentra ?? []);
      setRotations(json.rotations ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [campusId]);

  const loadOptions = useCallback(async () => {
    if (!campusId || !canWrite) return;
    try {
      const res = await fetch(`/api/admin/sentra/options?campusId=${encodeURIComponent(campusId)}`);
      if (!res.ok) throw new Error("options");
      setOptions((await res.json()) as SentraOptions);
    } catch {
      toast.error("Gagal memuat pilihan guru dan kelas");
    }
  }, [campusId, canWrite]);

  useEffect(() => {
    void load();
    void loadOptions();
  }, [load, loadOptions]);

  function selectCampus(id: string) {
    setCampusId(id);
    router.replace(`${pathname}?campusId=${encodeURIComponent(id)}`);
  }

  const sentraColumns = useMemo<ColumnDef<SentraRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sentra" />,
        cell: ({ row }) => <span className="text-sm font-medium">{sentraLabel(row.original.name)}</span>,
      },
      {
        id: "teachers",
        enableSorting: false,
        header: "Guru sentra",
        cell: ({ row }) =>
          row.original.teachers.length > 0 ? (
            <span className="text-sm">{row.original.teachers.map((t) => t.name).join(", ")}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Belum ada guru</span>
          ),
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} label={row.original.status === "ACTIVE" ? "Aktif" : "Nonaktif"} />
        ),
      },
      ...(canWrite
        ? [
            {
              id: "actions",
              enableSorting: false,
              header: "Aksi",
              cell: ({ row }) => (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Ubah ${sentraLabel(row.original.name)}`}
                  onClick={() => setSentraDialog({ open: true, row: row.original })}
                >
                  Ubah
                </Button>
              ),
            } satisfies ColumnDef<SentraRow>,
          ]
        : []),
    ],
    [canWrite],
  );

  const rotationColumns = useMemo<ColumnDef<RotationRow>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nama" />,
        cell: ({ row }) => (
          <DataTableLinkCell href={`/admin/sentra/rotations/${row.original.id}`}>
            {row.original.name}
          </DataTableLinkCell>
        ),
      },
      {
        id: "year",
        accessorFn: (r) => r.academicYear.name,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tahun ajaran" />,
        cell: ({ row }) => <span className="text-sm">{row.original.academicYear.name}</span>,
      },
      {
        id: "classes",
        enableSorting: false,
        header: "Kelas",
        cell: ({ row }) => <span className="text-sm">{row.original.classes.map((c) => c.name).join(", ")}</span>,
      },
      {
        id: "start",
        accessorFn: (r) => r.startDate,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Mulai" />,
        cell: ({ row }) => <span className="text-sm">{formatDate(row.original.startDate)}</span>,
      },
      {
        id: "days",
        accessorFn: (r) => r.cycleDays,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Hari" />,
        cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.cycleDays}</span>,
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} label={row.original.status === "ACTIVE" ? "Aktif" : "Nonaktif"} />
        ),
      },
    ],
    [],
  );

  const hasCampuses = campuses.length > 0;

  return (
    <div>
      <PageHeader title="Sentra" description="Atur sentra, guru sentra, dan putaran kelas." />

      <div className="mb-section max-w-xs space-y-1.5">
        <Label htmlFor="sentra-campus">Kampus</Label>
        <Select value={campusId} onValueChange={(v) => v && selectCampus(v)} disabled={!hasCampuses}>
          <SelectTrigger id="sentra-campus">
            <SelectValue placeholder={campusesLoaded ? "Belum ada kampus" : "Memuat kampus..."} />
          </SelectTrigger>
          <SelectContent>
            {campuses.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadError ? (
        <ErrorState
          title="Gagal memuat sentra"
          description="Coba lagi sebentar ya."
          onRetry={() => void load()}
        />
      ) : (
        <div className="space-y-section">
          <section aria-labelledby="sentra-list-title" className="space-y-field">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>
                <span id="sentra-list-title">Daftar sentra</span>
              </SectionTitle>
              {canWrite && campusId && (
                <Button onClick={() => setSentraDialog({ open: true, row: null })}>
                  <Plus aria-hidden="true" /> Tambah sentra
                </Button>
              )}
            </div>
            <DataTable
              columns={sentraColumns}
              data={sentra}
              loading={loading}
              emptyTitle="Belum ada sentra"
              emptyDescription={
                canWrite
                  ? "Belum ada sentra. Tambahkan sentra pertama, lalu pilih guru yang memegangnya."
                  : "Belum ada sentra di kampus ini."
              }
              emptyAction={canWrite ? { label: "Tambah sentra", onClick: () => setSentraDialog({ open: true, row: null }) } : undefined}
            />
          </section>

          <section aria-labelledby="rotation-list-title" className="space-y-field">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>
                <span id="rotation-list-title">Putaran</span>
              </SectionTitle>
              {canWrite && campusId && (
                <Button onClick={() => setRotationOpen(true)}>
                  <Plus aria-hidden="true" /> Buat putaran
                </Button>
              )}
            </div>
            <DataTable
              columns={rotationColumns}
              data={rotations}
              loading={loading}
              emptyTitle="Belum ada putaran"
              emptyDescription={
                canWrite
                  ? "Buat putaran untuk mengatur sentra tiap kelas dari hari ke hari."
                  : "Belum ada putaran di kampus ini."
              }
              emptyAction={canWrite ? { label: "Buat putaran", onClick: () => setRotationOpen(true) } : undefined}
            />
          </section>
        </div>
      )}

      {canWrite && (
        <>
          <SentraDialog
            open={sentraDialog.open}
            onOpenChange={(open) => setSentraDialog((s) => ({ ...s, open }))}
            campusId={campusId}
            sentra={sentraDialog.row}
            employees={options.employees}
            onSaved={() => void load()}
          />
          <RotationDialog
            open={rotationOpen}
            onOpenChange={setRotationOpen}
            campusId={campusId}
            options={options}
            rotation={null}
            onSaved={(id) => router.push(`/admin/sentra/rotations/${id}`)}
          />
        </>
      )}
    </div>
  );
}
