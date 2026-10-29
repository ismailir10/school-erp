"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { pickDefaultYear } from "./pick-default-year";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DataTableMobileMeta } from "@/components/ui/data-table-mobile-meta";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkPromoteDialog } from "@/components/admin/classes/bulk-promote-dialog";
import { ProgramChangeImpact } from "@/components/admin/classes/program-change-impact";
import { ArrowUpRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { classFormSchema } from "@/lib/validations/class";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";

type ClassRow = {
  id: string;
  name: string;
  capacity: number;
  slotTemplate: "FULL_DAY" | "MORNING_AND_AFTERNOON";
  ageGroup: "A" | "B";
  status: "ACTIVE" | "INACTIVE";
  campusId: string;
  programId: string;
  academicYearId: string;
  classTrackId: string;
  campus: { id: string; name: string };
  program: { id: string; code: string; name: string };
  academicYear: { id: string; name: string; status: string };
  enrolledCount: number;
  attendance7dPct: number | null;
  todaySession: "Held" | "Missing" | "Holiday";
  health: "Sehat" | "Perhatian" | "Kritis" | "Belum ada siswa" | "Tidak Aktif" | "Libur";
  teachingAssignments: {
    id: string;
    employee: { id: string; nama: string };
  }[];
};

type Campus = { id: string; name: string; status: string };
type Program = { id: string; code: string; name: string; status: string };
type AcademicYear = {
  id: string;
  name: string;
  status: "PLANNING" | "ACTIVE" | "ARCHIVED";
  startDate: string;
  endDate: string;
};

type StatusFilter = "ACTIVE" | "INACTIVE" | "all";

const EMPTY_CLASS_FORM = {
  campusId: "",
  programId: "",
  name: "",
  capacity: 20,
  slotTemplate: "FULL_DAY" as const,
  ageGroup: "" as unknown as "A" | "B",
};

function DiscardClassFooter({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { keepRef.current?.focus(); }, []);
  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="alert" className="text-sm">
        <p className="font-medium">Buang perubahan?</p>
        <p className="text-muted-foreground">Data yang belum disimpan akan hilang.</p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" ref={keepRef} variant="ghost" onClick={onKeep}>Lanjut mengisi</Button>
        <Button type="button" variant="destructive" onClick={onDiscard}>Buang perubahan</Button>
      </div>
    </div>
  );
}

export function ClassesClient({
  canWrite,
  initialYearId,
}: {
  canWrite: boolean;
  /** `?yearId=` from the URL (e.g. the "Kelola kelas tahun ini" link on academic years). */
  initialYearId?: string;
}) {
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ACTIVE");
  const [campusFilter, setCampusFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const listRequestId = useRef(0);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const formId = useId();
  const form = useZodForm(classFormSchema, { defaultValues: EMPTY_CLASS_FORM });
  const dirty = form.formState.isDirty;
  const watchedProgramId = form.watch("programId");
  // The server refuses a program move once the class's students are invoiced;
  // the impact panel reports it so Simpan is disabled instead of bouncing.
  const [programChangeBlocked, setProgramChangeBlocked] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftFocus = useRef<HTMLElement | null>(null);

  function keepDraft() {
    setDiscardOpen(false);
    // Restore after the popup's focus manager handles the removed footer.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (draftFocus.current?.isConnected) draftFocus.current.focus();
      else document.getElementById(formId)?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    }));
  }

  function closeForm() {
    setDiscardOpen(false);
    setDialogOpen(false);
    resetForm();
  }

  function requestFormClose() {
    if (form.formState.isSubmitting) return;
    if (discardOpen) { keepDraft(); return; }
    if (dirty) {
      const active = document.activeElement;
      draftFocus.current = active instanceof HTMLElement && document.getElementById(formId)?.contains(active) ? active : null;
      setDiscardOpen(true);
    } else closeForm();
  }

  const [deactivateTarget, setDeactivateTarget] = useState<ClassRow | null>(
    null,
  );
  const [reactivateTarget, setReactivateTarget] = useState<ClassRow | null>(
    null,
  );
  const [promoteOpen, setPromoteOpen] = useState(false);

  const archivedMode = useMemo(() => {
    const y = years.find((y) => y.id === yearId);
    return y?.status === "ARCHIVED";
  }, [years, yearId]);

  async function fetchReference() {
    const [campusRes, programRes, yearRes] = await Promise.all([
      fetch("/api/config/campuses?status=ALL"),
      fetch("/api/programs"),
      fetch("/api/academic-years"),
    ]);

    if (campusRes.ok) {
      const j = await campusRes.json().catch(() => null);
      setCampuses(Array.isArray(j) ? j : j?.data ?? []);
    }
    if (programRes.ok) {
      const j = await programRes.json().catch(() => null);
      setPrograms(Array.isArray(j) ? j : j?.data ?? []);
    }
    if (yearRes.ok) {
      const j = await yearRes.json().catch(() => null);
      const list: AcademicYear[] = Array.isArray(j) ? j : j?.data ?? [];
      setYears(list);
      if (!yearId) {
        // A valid ?yearId= wins; an absent or unknown one falls back to the
        // usual default so a stale link never lands on an empty page.
        const fromUrl = initialYearId ? list.find((y) => y.id === initialYearId) : undefined;
        const def = fromUrl ?? pickDefaultYear(list, new Date());
        if (def) setYearId(def.id);
      }
    }
  }

  const fetchRows = useCallback(async () => {
    if (!yearId) return;
    const requestId = ++listRequestId.current;
    setLoading(true);
    setLoadError(false);
    const params = new URLSearchParams({
      pageSize: "100",
      yearId,
    });
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (campusFilter !== "all") params.set("campusId", campusFilter);
    if (programFilter !== "all") params.set("programId", programFilter);
    if (query.trim()) params.set("q", query.trim());
    try {
      const res = await fetch(`/api/admin/classes?${params.toString()}`);
      if (!res.ok) throw new Error("Classes read failed");
      const j = await res.json();
      if (requestId !== listRequestId.current) return;
      setRows(Array.isArray(j?.data) ? j.data : []);
    } catch {
      if (requestId === listRequestId.current) setLoadError(true);
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  }, [yearId, statusFilter, campusFilter, programFilter, query]);

  useEffect(() => {
    fetchReference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Cancel both the pending search timer and any older response when the
    // selected search/year/filter context changes.
    const timer = setTimeout(() => void fetchRows(), 300);
    return () => { clearTimeout(timer); listRequestId.current += 1; };
  }, [fetchRows]);

  // Keep the selected year in the URL so reload / share lands on the same year.
  useEffect(() => {
    if (!yearId || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("yearId") === yearId) return;
      url.searchParams.set("yearId", yearId);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // URL sync is a convenience; never block the page on it.
    }
  }, [yearId]);

  useEffect(() => {
    setTablePage(1);
  }, [yearId, statusFilter, campusFilter, programFilter, query]);

  const resetForm = useCallback(() => {
    setEditing(null);
    setProgramChangeBlocked(false);
    form.reset(EMPTY_CLASS_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = useCallback(() => {
    setDiscardOpen(false);
    resetForm();
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = useCallback((row: ClassRow) => {
    setDiscardOpen(false);
    setEditing(row);
    form.reset({
      campusId: row.campusId,
      programId: row.programId,
      name: row.name,
      capacity: row.capacity,
      slotTemplate: row.slotTemplate,
      ageGroup: row.ageGroup,
    });
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = form.handleSubmit(async (values) => {
    if (discardOpen) return;
    const url = editing
      ? `/api/admin/classes/${editing.id}`
      : `/api/admin/classes`;
    const method = editing ? "PATCH" : "POST";
    const body = editing
      ? {
          name: values.name,
          capacity: values.capacity,
          slotTemplate: values.slotTemplate,
          ageGroup: values.ageGroup,
          // Only a changed program is sent; an untouched one is a no-op the
          // server would answer with "Tidak ada perubahan" on its own.
          ...(values.programId !== editing.programId ? { programId: values.programId } : {}),
        }
      : {
          campusId: values.campusId,
          programId: values.programId,
          academicYearId: yearId,
          name: values.name,
          capacity: values.capacity,
          slotTemplate: values.slotTemplate,
          ageGroup: values.ageGroup,
        };
    try {
      await sendJson(url, { method, body }, MESSAGES.saveFailed);
      toast.success(editing ? "Kelas diperbarui" : "Kelas ditambahkan");
      closeForm();
      fetchRows();
    } catch (err) {
      applyServerErrors(form, err, MESSAGES.saveFailed);
    }
  });

  async function flipStatus(target: ClassRow, status: "ACTIVE" | "INACTIVE") {
    const res =
      status === "INACTIVE"
        ? await fetch(`/api/admin/classes/${target.id}`, { method: "DELETE" })
        : await fetch(`/api/admin/classes/${target.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });
    if (res.ok) {
      toast.success(status === "ACTIVE" ? "Diaktifkan" : "Dinonaktifkan");
      fetchRows();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Gagal");
    }
  }

  const columns: ColumnDef<ClassRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Nama" />
        ),
        cell: ({ row }) => (
          <DataTableLinkCell
            href={`/admin/classes/${row.original.id}`}
            description={
              // Two "KB" classes at different campuses look identical without
              // these; the Kampus / Program / Wali Kelas columns are hidden
              // below `md` (CORE-7).
              <DataTableMobileMeta>
                <span>
                  {[
                    row.original.campus.name,
                    row.original.program.name,
                    row.original.teachingAssignments[0]?.employee?.nama ?? "Belum ada wali kelas",
                  ].join(" · ")}
                </span>
              </DataTableMobileMeta>
            }
          >
            {row.original.name}
          </DataTableLinkCell>
        ),
      },
      {
        id: "campus",
        accessorFn: (r) => r.campus.name,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Kampus" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm">{row.original.campus.name}</span>
        ),
      },
      {
        id: "program",
        accessorFn: (r) => r.program.name,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Program" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => (
          <span className="text-sm">{row.original.program.name}</span>
        ),
      },
      {
        id: "homeroom",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Wali Kelas" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => {
          const h = row.original.teachingAssignments[0]?.employee?.nama;
          return h ? (
            <span className="text-sm">{h}</span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "roster",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Siswa" />
        ),
        cell: ({ row }) => (
          <span className="font-currency text-sm">
            {row.original.enrolledCount}/{row.original.capacity}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "health",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Kondisi" />
        ),
        meta: { priority: "low" },
        cell: ({ row }) => <StatusBadge status={row.original.health} />,
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <DataTableRowActions
              rowLabel={row.original.name}
              onEdit={
                canWrite && !archivedMode ? () => openEdit(row.original) : undefined
              }
              onDeactivate={
                canWrite && !archivedMode && row.original.status === "ACTIVE"
                  ? () => setDeactivateTarget(row.original)
                  : undefined
              }
              onActivate={
                canWrite && !archivedMode && row.original.status === "INACTIVE"
                  ? () => setReactivateTarget(row.original)
                  : undefined
              }
              isActive={row.original.status === "ACTIVE"}
            />
          </div>
        ),
      },
    ],
    [canWrite, archivedMode, openEdit],
  );

  const tableTotalPages = Math.max(1, Math.ceil(rows.length / tablePageSize));
  const safeTablePage = Math.min(tablePage, tableTotalPages);
  const tablePagination = {
    page: safeTablePage,
    pageSize: tablePageSize,
    total: rows.length,
    totalPages: tableTotalPages,
  };

  return (
    <>
      <PageHeader
        title="Kelas"
        description="Daftar kelas per tahun ajaran — buat, ubah kapasitas, kelola siswa dan wali kelas, dan pantau kondisi tiap kelas."
        actions={
          canWrite && !archivedMode ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPromoteOpen(true)} className="gap-2">
                <ArrowUpRight className="size-4" /> Naik Kelas Massal
              </Button>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="size-4" /> Tambah Kelas
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* min-w-0 preserved on both wrappers — the class table's columns
          (Wali Kelas, Kondisi badge, etc.) overflow a flex/grid ancestor
          without it, which clips the DataTable horizontally on narrow
          viewports. */}
      <div className="min-w-0 space-y-section">
      <div className="min-w-0 [&>div]:flex-wrap">
      <DataTableToolbar
        value={query}
        onValueChange={setQuery}
        searchPlaceholder="Cari nama kelas..."
        filters={[
          {
            key: "yearId",
            label: "Tahun Ajaran",
            value: yearId,
            resetValue: pickDefaultYear(years, new Date())?.id ?? yearId,
            onChange: (v) => setYearId(v),
            options: years.map((y) => ({
              value: y.id,
              label: `${y.name}${y.status === "ACTIVE" ? " · Aktif" : ""}${y.status === "ARCHIVED" ? " · Arsip" : ""}${y.status === "PLANNING" ? " · Rencana" : ""}`,
            })),
          },
          {
            key: "campus",
            label: "Kampus",
            value: campusFilter,
            onChange: setCampusFilter,
            options: [
              { value: "all", label: "Semua Kampus" },
              ...campuses.map((c) => ({ value: c.id, label: c.name })),
            ],
          },
          {
            key: "program",
            label: "Program",
            value: programFilter,
            onChange: setProgramFilter,
            options: [
              { value: "all", label: "Semua Program" },
              ...programs.map((p) => ({ value: p.id, label: p.name })),
            ],
          },
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            resetValue: "ACTIVE",
            onChange: (v) => setStatusFilter(v as StatusFilter),
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
              { value: "INACTIVE", label: "Tidak Aktif" },
            ],
          },
        ]}
      />
      </div>

      {archivedMode && (
        <div className="rounded-md border border-status-leave bg-status-leave-subtle px-4 py-3 text-sm text-status-leave-text">
          Tahun ajaran ini sudah diarsipkan. Tampilan hanya baca.
        </div>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>
          <p>Gagal memuat daftar kelas. Coba lagi.</p>
          {rows.length > 0 && <p className="mt-1 text-muted-foreground">Daftar terakhir masih ditampilkan dan belum diperbarui.</p>}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void fetchRows()}>Coba lagi</Button>
          </AlertDescription>
        </Alert>
      )}
      {(!loadError || rows.length > 0) && <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        isFiltered={!!query.trim() || campusFilter !== "all" || programFilter !== "all" || statusFilter === "INACTIVE"}
        pagination={tablePagination}
        emptyTitle="Belum ada kelas"
        emptyDescription="Kelas yang dibuat akan tampil di sini."
      />}
      </div>

      <BulkPromoteDialog
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
        years={years}
        defaultSourceYearId={yearId}
        onDone={fetchRows}
      />

      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { if (!v) requestFormClose(); }}
        title={editing ? "Ubah Kelas" : "Tambah Kelas"}
        description={
          editing
            ? "Perbarui nama, kapasitas, pola slot, atau program. Kampus tidak dapat diubah."
            : "Pilih kampus dan program, beri nama, lalu tentukan kapasitas."
        }
        footer={
          discardOpen ? <DiscardClassFooter onKeep={keepDraft} onDiscard={closeForm} /> : <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={requestFormClose}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Kelas"}
            disabled={programChangeBlocked}
          />
        }
      >
        <form id={formId} onSubmit={save} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <FormField
            control={form.control}
            name="campusId"
            label="Kampus"
            required
            id="class-campus"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
                disabled={!!editing}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih kampus" />
                </SelectTrigger>
                <SelectContent>
                  {campuses
                    .filter((c) => c.status === "ACTIVE" || c.id === field.value)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.status !== "ACTIVE" ? " (nonaktif)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />

          <FormField
            control={form.control}
            name="programId"
            label="Program"
            required
            id="class-program"
            render={({ field, controlProps }) => (
              <Select
                value={field.value}
                onValueChange={(v) => v != null && field.onChange(v)}
              >
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih program" />
                </SelectTrigger>
                <SelectContent>
                  {programs
                    .filter((p) => p.status === "ACTIVE" || p.id === field.value)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.code})
                        {p.status !== "ACTIVE" ? " — nonaktif" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          />

          {editing && (
            <ProgramChangeImpact
              classId={editing.id}
              currentProgramId={editing.programId}
              nextProgramId={watchedProgramId}
              onBlockedChange={setProgramChangeBlocked}
            />
          )}

          <FormField
            control={form.control}
            name="name"
            label="Nama kelas"
            required
            id="class-name"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} placeholder="mis. TKIT A" />
            )}
          />

          <FormField
            control={form.control}
            name="capacity"
            label="Kapasitas"
            required
            id="class-capacity"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} type="number" min={1} max={200} />
            )}
          />

          <FormField
            control={form.control}
            name="slotTemplate"
            label="Pola Waktu Kelas"
            required
            id="class-slot-template"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_DAY">Sehari penuh</SelectItem>
                  <SelectItem value="MORNING_AND_AFTERNOON">
                    Pagi & sore
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          />

          <FormField
            control={form.control}
            name="ageGroup"
            label="Kelompok usia"
            required
            id="class-age-group"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                  <SelectValue placeholder="Pilih kelompok usia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A · 4–5 tahun (TK A)</SelectItem>
                  <SelectItem value="B">B · 5–6 tahun (TK B)</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </form>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(v) => !v && setDeactivateTarget(null)}
        entityName={deactivateTarget ? `kelas ${deactivateTarget.name}` : "kelas"}
        extraWarning={
          deactivateTarget && deactivateTarget.enrolledCount > 0
            ? `${deactivateTarget.enrolledCount} siswa aktif tidak akan otomatis dipindahkan.`
            : undefined
        }
        onConfirm={async () => {
          if (deactivateTarget) {
            await flipStatus(deactivateTarget, "INACTIVE");
            setDeactivateTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => !v && setReactivateTarget(null)}
        title="Aktifkan kembali kelas?"
        description={
          reactivateTarget
            ? `${reactivateTarget.name} akan muncul kembali di daftar aktif.`
            : ""
        }
        confirmLabel="Aktifkan"
        onConfirm={async () => {
          if (reactivateTarget) {
            await flipStatus(reactivateTarget, "ACTIVE");
            setReactivateTarget(null);
          }
        }}
      />
    </>
  );
}
