"use client";

// Keringanan (durable per-student fee adjustments) — Cycle A, T6.
// docs/cycles/2026-08-13-keringanan-fee-adjustments.md
//
// Self-contained Category A CRUD tab (.claude/standards/crud.md) mounted as
// the third tab on /admin/fees. Shape cloned from
// app/admin/(hr)/salary-components/page.tsx: DataTableToolbar → DataTable →
// DataTableRowActions → ResponsiveFormDialog → ConfirmDialog confirm before
// deactivate (cycle 2026-09-26, admin-ui-standard-c1 T5 — was a raw
// AlertDialog).
//
// `studentId` / `academicYearId` / `feeComponentId` / `type` are immutable
// after creation (lib/validations/student-fee-adjustment.ts) — the edit
// dialog renders them read-only rather than hiding them, so the admin can
// still see what a grant applies to while correcting `mode` / `value` /
// `reason` / validity window.

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldDescription } from "@/components/ui/field";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { DatePicker } from "@/components/ui/date-picker";
import { formatRupiah, formatDateShort } from "@/lib/format";
import { userMessage } from "@/lib/api/client-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { keringananFormSchema } from "@/lib/validations/student-fee-adjustment";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type AdjustmentType = "DISCOUNT" | "SURCHARGE";
type AdjustmentMode = "PERCENT" | "FIXED";

type Adjustment = {
  id: string;
  studentId: string;
  academicYearId: string;
  feeComponentId: string | null;
  type: AdjustmentType;
  mode: AdjustmentMode;
  value: string; // Prisma Decimal serializes as string over JSON
  reason: string;
  validFrom: string | null;
  validTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  student: { name: string; nis: string | null };
  feeComponent: { label: string } | null;
  academicYear: { name: string };
};

type FeeComponentOption = { id: string; label: string; isEnabled: boolean; status: string };
type AcademicYearOption = { id: string; name: string; status: string };

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

// ------------------------------------------------------------------
// Labels + formatting helpers
// ------------------------------------------------------------------

const TYPE_LABELS: Record<AdjustmentType, string> = { DISCOUNT: "Diskon", SURCHARGE: "Tambahan" };

function formatNilai(mode: AdjustmentMode, value: string): string {
  return mode === "PERCENT" ? `${Number(value)}%` : formatRupiah(value);
}

function formatValidity(validFrom: string | null, validTo: string | null): string {
  if (!validFrom && !validTo) return "Tidak terbatas";
  if (validFrom && validTo) return `${formatDateShort(validFrom)} – ${formatDateShort(validTo)}`;
  if (validFrom) return `Mulai ${formatDateShort(validFrom)}`;
  return `Sampai ${formatDateShort(validTo as string)}`;
}

// Reused for both the create and edit RHF instance — `keringananFormSchema`'s
// `isEditing` marker (not itself rendered as a control) turns off the
// studentId/academicYearId/feeComponentId required-check in edit mode, since
// the edit dialog never renders those as inputs and a stored row can hold a
// value that looks "empty" to that check (e.g. a legacy/Cycle-B
// `feeComponentId: null`, coalesced to `""` here).
function buildInitialForm() {
  return {
    isEditing: false,
    studentId: "",
    academicYearId: "",
    feeComponentId: "",
    type: "DISCOUNT" as AdjustmentType,
    mode: "PERCENT" as AdjustmentMode,
    value: "",
    reason: "",
    // Kept as plain strings (DatePicker's own "no value" shape), never
    // `undefined` — see `optionalDate()` in student-fee-adjustment.ts for why.
    validFrom: "",
    validTo: "",
  };
}

// ------------------------------------------------------------------
// Read-only display for the four immutable fields on edit
// ------------------------------------------------------------------

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function KeringananTab() {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  // Distinct from "no rows". A failed load must never render as "Belum ada
  // keringanan" — an admin reading that would conclude the student has no
  // discount and bill them the full amount.
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const [feeComponents, setFeeComponents] = useState<FeeComponentOption[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Adjustment | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const formId = useId();
  const form = useZodForm(keringananFormSchema, { defaultValues: buildInitialForm() });
  const mode = form.watch("mode");

  const [confirmTarget, setConfirmTarget] = useState<Adjustment | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const activeFeeComponents = useMemo(
    () => feeComponents.filter((fc) => fc.isEnabled && fc.status === "ACTIVE"),
    [feeComponents],
  );

  // ------------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------------

  const fetchAdjustments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/student-fee-adjustments?${params}`);
      if (!res.ok) {
        setLoadError(true);
        setAdjustments([]);
        toast.error(MESSAGES.loadFailed("Data keringanan"));
        return;
      }
      const json = await res.json();
      setLoadError(false);
      setAdjustments(json.data ?? []);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      setLoadError(true);
      setAdjustments([]);
      toast.error(MESSAGES.loadFailed("Data keringanan"));
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchAdjustments();
  }, [fetchAdjustments]);

  // Reference data (fee components, academic years) for the create/edit
  // Selects — fetched once, this tab is self-contained per the cycle doc
  // (Assumption 4: it must not grow app/admin/fees/page.tsx further).
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/fee-components"), fetch("/api/academic-years")])
      .then(async ([fcRes, ayRes]) => {
        if (cancelled) return;
        if (!fcRes.ok || !ayRes.ok) {
          toast.error(MESSAGES.loadFailed("Data referensi"));
          return;
        }
        const [fc, ay] = await Promise.all([fcRes.json(), ayRes.json()]);
        setFeeComponents(Array.isArray(fc) ? fc : []);
        setAcademicYears(Array.isArray(ay) ? ay : []);
      })
      .catch(() => {
        if (!cancelled) toast.error(MESSAGES.loadFailed("Data referensi"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------------------------
  // Toolbar handlers
  // ------------------------------------------------------------------

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setPagination((p) => ({ ...p, page }));
  }, []);

  const handlePageSizeChange = useCallback((pageSize: number) => {
    setPagination((p) => ({ ...p, page: 1, pageSize }));
  }, []);

  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    setSortBy(field);
    setSortOrder(order);
    setPagination((p) => ({ ...p, page: 1 }));
  }, []);

  // ------------------------------------------------------------------
  // Dialog open/submit
  // ------------------------------------------------------------------

  function openCreate() {
    setEditing(null);
    setSelectedStudent(null);
    form.reset(buildInitialForm());
    setDialogOpen(true);
  }

  const openEdit = useCallback(
    (adj: Adjustment) => {
      setEditing(adj);
      setSelectedStudent({ id: adj.studentId, name: adj.student.name, nickname: null, nis: adj.student.nis });
      form.reset({
        isEditing: true,
        studentId: adj.studentId,
        academicYearId: adj.academicYearId,
        feeComponentId: adj.feeComponentId ?? "",
        type: adj.type,
        mode: adj.mode,
        value: String(Number(adj.value)),
        reason: adj.reason,
        validFrom: adj.validFrom ?? "",
        validTo: adj.validTo ?? "",
      });
      setDialogOpen(true);
    },
    [form],
  );

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      if (editing) {
        await sendJson(
          `/api/student-fee-adjustments/${editing.id}`,
          {
            method: "PUT",
            body: {
              mode: values.mode,
              value: values.value,
              reason: values.reason,
              // Send null, not an omitted key, when the admin blanks a date —
              // omitting it means "leave unchanged", so an open-ended
              // validity could never be restored once a bound had been set.
              validFrom: values.validFrom ?? null,
              validTo: values.validTo ?? null,
            },
          },
          "Gagal menyimpan perubahan",
        );
        toast.success("Keringanan diperbarui");
      } else {
        await sendJson(
          "/api/student-fee-adjustments",
          {
            method: "POST",
            body: {
              studentId: values.studentId,
              academicYearId: values.academicYearId,
              feeComponentId: values.feeComponentId,
              type: values.type,
              mode: values.mode,
              value: values.value,
              reason: values.reason,
              ...(values.validFrom ? { validFrom: values.validFrom } : {}),
              ...(values.validTo ? { validTo: values.validTo } : {}),
            },
          },
          "Gagal menambahkan keringanan",
        );
        toast.success("Keringanan ditambahkan");
      }
      setDialogOpen(false);
      fetchAdjustments();
    } catch (err) {
      applyServerErrors(form, err, editing ? "Gagal menyimpan perubahan" : "Gagal menambahkan keringanan");
    }
  });

  // ------------------------------------------------------------------
  // Deactivate / reactivate
  // ------------------------------------------------------------------

  // Returns whether the toggle succeeded so the deactivate ConfirmDialog can
  // decide whether to keep itself open for a retry (same contract as
  // app/admin/(hr)/salary-components/page.tsx `toggleEnabled`). `useCallback`
  // so `columns` below can be memoised too.
  const setStatus = useCallback(
    async (adj: Adjustment, nextStatus: "ACTIVE" | "INACTIVE"): Promise<boolean> => {
      setTogglingId(adj.id);
      try {
        const res = await fetch(`/api/student-fee-adjustments/${adj.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(body.error || "Gagal mengubah status keringanan");
          return false;
        }
        toast.success(nextStatus === "INACTIVE" ? "Keringanan dinonaktifkan" : "Keringanan diaktifkan");
        fetchAdjustments();
        return true;
      } catch (e) {
        toast.error(userMessage(e, "Gagal mengubah status keringanan"));
        return false;
      } finally {
        setTogglingId(null);
      }
    },
    [fetchAdjustments],
  );

  // ------------------------------------------------------------------
  // Columns
  // ------------------------------------------------------------------

  // Sortability rule (one rule, applied to every data column): every header
  // renders via DataTableColumnHeader, and a column sorts only when the API
  // accepts that field in its `sort` allow-list
  // (app/api/student-fee-adjustments/route.ts `parseSort(... allow: [...])`)
  // — `value`/`validFrom`/`status` do, `student`/`feeComponent`/`type` don't
  // (they're relation-derived `cell`-only columns with no `accessorFn`, so
  // TanStack's `getCanSort()` returns false for them on its own; wrapping
  // them in DataTableColumnHeader too just means they render as a plain
  // title instead of a mix of raw strings and sortable headers).
  // Memoised (Cycle 3 T7) — a fresh array every render would remount row
  // cells and close any open row-action menu.
  const columns: ColumnDef<Adjustment>[] = useMemo(() => [
    {
      id: "student",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Siswa" />,
      cell: ({ row }) => {
        const adj = row.original;
        return (
          <div>
            <span className="text-sm font-medium">{adj.student.name}</span>
            {adj.student.nis && (
              <span className="block text-xs text-muted-foreground">NIS {adj.student.nis}</span>
            )}
          </div>
        );
      },
    },
    {
      id: "feeComponent",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Komponen Biaya" />,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.feeComponent?.label ?? "—"}</span>
      ),
      meta: { priority: "low" },
    },
    {
      id: "type",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Jenis" />,
      cell: ({ row }) => (
        <Badge variant="secondary" className="text-xs">
          {TYPE_LABELS[row.original.type]}
        </Badge>
      ),
    },
    {
      accessorKey: "value",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Nilai" />,
      cell: ({ row }) => (
        <span className="font-currency text-sm tabular-nums">
          {formatNilai(row.original.mode, row.original.value)}
        </span>
      ),
    },
    {
      accessorKey: "validFrom",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Masa Berlaku" />,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatValidity(row.original.validFrom, row.original.validTo)}
        </span>
      ),
      meta: { priority: "low" },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const adj = row.original;
        return (
          <DataTableRowActions
            rowLabel={adj.student.name}
            onEdit={() => openEdit(adj)}
            isActive={adj.status === "ACTIVE"}
            onDeactivate={togglingId === adj.id ? undefined : () => setConfirmTarget(adj)}
            onActivate={togglingId === adj.id ? undefined : () => setStatus(adj, "ACTIVE")}
          />
        );
      },
    },
  ], [openEdit, setStatus, togglingId]);

  const dialogTitle = editing ? "Edit Keringanan" : "Tambah Keringanan";
  const nilaiDescription =
    mode === "PERCENT"
      ? "Persentase dari komponen biaya, maksimal 100."
      : "Nominal rupiah, dipotong atau ditambahkan langsung.";

  return (
    <>
      <DataTableToolbar
        searchPlaceholder="Cari nama atau NIS siswa..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: handleStatusChange,
            resetValue: "ACTIVE",
            options: [
              { value: "all", label: "Semua Status" },
              { value: "ACTIVE", label: "Aktif" },
              { value: "INACTIVE", label: "Tidak Aktif" },
            ],
          },
        ]}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" /> Tambah Keringanan
          </Button>
        }
      />

      {loadError && !loading ? (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium">Data keringanan tidak bisa dimuat</p>
          <p className="text-muted-foreground max-w-md text-sm">
            Jangan buat tagihan sebelum daftar ini tampil — keringanan yang tersimpan tidak
            terlihat di sini, jadi tagihan bisa keluar tanpa potongan.
          </p>
          <Button size="sm" variant="outline" onClick={fetchAdjustments}>
            Muat Ulang
          </Button>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={adjustments}
          pagination={pagination}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSortChange={handleSortChange}
          defaultSort={{ field: "createdAt", order: "desc" }}
          loading={loading}
          emptyTitle="Belum ada keringanan"
          emptyDescription="Tambahkan diskon atau tambahan biaya untuk siswa tertentu, misalnya potongan sibling atau beasiswa."
        />
      )}

      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={dialogTitle}
        description="Keringanan berlaku otomatis pada setiap tagihan bulanan yang dibuat untuk siswa ini."
        size="lg"
        footer={
          <FormDialogFooter
            formId={formId}
            pending={form.formState.isSubmitting}
            onCancel={() => setDialogOpen(false)}
            submitLabel={editing ? "Simpan Perubahan" : "Tambah Keringanan"}
          />
        }
      >
        <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />

          {editing ? (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-muted-foreground/20 bg-muted/40 p-3">
              <ReadOnlyField label="Siswa" value={`${editing.student.name}${editing.student.nis ? ` · ${editing.student.nis}` : ""}`} />
              <ReadOnlyField label="Tahun Ajaran" value={editing.academicYear.name} />
              <ReadOnlyField label="Komponen Biaya" value={editing.feeComponent?.label ?? "—"} />
              <ReadOnlyField label="Jenis" value={TYPE_LABELS[editing.type]} />
            </div>
          ) : (
            <>
              <FormField
                control={form.control}
                name="studentId"
                label="Siswa"
                required
                id="keringanan-student"
                render={({ field, controlProps }) => (
                  <StudentPicker
                    id="keringanan-student"
                    aria-invalid={controlProps["aria-invalid"]}
                    selected={selectedStudent}
                    onSelect={(s) => {
                      setSelectedStudent(s);
                      field.onChange(s?.id ?? "");
                    }}
                  />
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="academicYearId"
                  label="Tahun Ajaran"
                  required
                  id="keringanan-year"
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                        <SelectValue placeholder="Pilih tahun ajaran" />
                      </SelectTrigger>
                      <SelectContent>
                        {academicYears.map((y) => (
                          <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FormField
                  control={form.control}
                  name="feeComponentId"
                  label="Komponen Biaya"
                  required
                  id="keringanan-component"
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                        <SelectValue placeholder="Pilih komponen" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeFeeComponents.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Belum ada komponen aktif</div>
                        ) : (
                          activeFeeComponents.map((fc) => (
                            <SelectItem key={fc.id} value={fc.id}>{fc.label}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="type"
                  label="Jenis"
                  required
                  id="keringanan-type"
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DISCOUNT">Diskon</SelectItem>
                        <SelectItem value="SURCHARGE">Tambahan</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mode"
                  label="Mode"
                  required
                  id="keringanan-mode"
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                      <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PERCENT">Persen (%)</SelectItem>
                        <SelectItem value="FIXED">Nominal (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </>
          )}

          {/* Mode stays editable on edit (only student/year/component/type are
              immutable — see updateStudentFeeAdjustmentSchema). Jenis is not
              repeated here; it's already shown read-only above. */}
          {editing && (
            <FormField
              control={form.control}
              name="mode"
              label="Mode"
              required
              id="keringanan-mode-edit"
              render={({ field, controlProps }) => (
                <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Persen (%)</SelectItem>
                    <SelectItem value="FIXED">Nominal (Rp)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="value"
            label="Nilai"
            required
            id="keringanan-value"
            description={nilaiDescription}
            render={({ field, controlProps }) =>
              mode === "FIXED" ? (
                <RupiahInput
                  {...controlProps}
                  value={(field.value as number | null | undefined) ?? null}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              ) : (
                <Input
                  {...controlProps}
                  type="number"
                  min={0}
                  step="0.01"
                  max={100}
                  value={(field.value as string | number | undefined) ?? ""}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  placeholder="0"
                  className="font-currency"
                />
              )
            }
          />

          <FormField
            control={form.control}
            name="reason"
            label="Alasan"
            required
            id="keringanan-reason"
            description="Muncul sebagai catatan pada baris tagihan yang terpengaruh."
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                maxLength={500}
                placeholder="Contoh: potongan sibling, anak kedua dan ketiga"
              />
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="validFrom"
              label="Berlaku Dari"
              id="keringanan-valid-from"
              render={({ field, controlProps }) => (
                // The live field value stays a plain string (DatePicker's own
                // empty state, "") the whole time it's being edited —
                // `keringananFormSchema`'s `optionalDate()` maps "" → undefined
                // only when the resolver parses a snapshot on submit. Calling
                // `field.onChange(undefined)` directly from the widget doesn't
                // reliably propagate through a Controller-bound field (see
                // that helper's comment in student-fee-adjustment.ts).
                <DatePicker {...controlProps} value={(field.value as string) ?? ""} onChange={field.onChange} />
              )}
            />
            <FormField
              control={form.control}
              name="validTo"
              label="Berlaku Sampai"
              id="keringanan-valid-to"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={(field.value as string) ?? ""} onChange={field.onChange} />
              )}
            />
          </div>
          <FieldDescription>Kosongkan salah satu atau keduanya jika keringanan berlaku selama tahun ajaran ini.</FieldDescription>
        </form>
      </ResponsiveFormDialog>

      {/* Deactivate guard — reactivate stays single-click (non-destructive) */}
      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title="Nonaktifkan keringanan ini?"
        description={`${confirmTarget?.student.name ?? ""} tidak akan lagi mendapat ${confirmTarget ? TYPE_LABELS[confirmTarget.type].toLowerCase() : ""} ini pada tagihan berikutnya. Bisa diaktifkan kembali kapan saja.`}
        confirmLabel="Ya, Nonaktifkan"
        destructive
        onConfirm={async () => {
          if (!confirmTarget) return;
          const ok = await setStatus(confirmTarget, "INACTIVE");
          if (!ok) throw new Error("Gagal menonaktifkan keringanan");
        }}
      />
    </>
  );
}
