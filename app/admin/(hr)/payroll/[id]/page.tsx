"use client";

import { UserAvatar } from "@/components/ui/user-avatar";
import { useEffect, useId, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { DetailPageHeader } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Download, Check, Pencil, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatRupiah, formatDate, formatDateShort } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { adjustPayrollLineFormSchema, payrollEditFormSchema, payrollVariablesSchema } from "@/lib/validations/payroll";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { readApiError } from "@/lib/api/client-errors";

type PayrollLine = {
  id: string; labelSnapshot: string; categorySnapshot: string;
  calculatedAmount: number; adjustmentAmount: number; adjustmentNote: string | null; finalAmount: number;
  componentDef: { code: string; calcType: string };
};

type PayrollItem = {
  id: string; grossAmount: number; deductions: number; netAmount: number;
  overtimeHours: number; outdoorDays: number; holidayWorkedDays: number; dcDays: number;
  employee: { id: string; kode: string; nama: string; jabatan: string; bankAccountNo: string | null; bankName: string | null };
  lines: PayrollLine[];
};

type PayrollData = {
  id: string; periodStart: string; periodEnd: string; actualWorkDays: number; status: string;
  items: PayrollItem[];
};

export default function PayrollDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PayrollData | null>(null);
  const [loading, setLoading] = useState(true);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [bankFilter, setBankFilter] = useState("all");

  // Detail sheet
  const [detailItem, setDetailItem] = useState<PayrollItem | null>(null);

  // Modals
  const [varsModal, setVarsModal] = useState<PayrollItem | null>(null);
  const [lineModal, setLineModal] = useState<{ item: PayrollItem; line: PayrollLine } | null>(null);
  const [approveModal, setApproveModal] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Vars form
  const varsFormId = useId();
  const varsForm = useZodForm(payrollVariablesSchema, {
    defaultValues: { overtimeHours: 0, outdoorDays: 0, holidayWorkedDays: 0, dcDays: 0 },
  });

  // Line adjustment form
  const adjFormId = useId();
  const adjForm = useZodForm(adjustPayrollLineFormSchema, {
    defaultValues: { adjustmentAmount: "", adjustmentNote: "" },
  });
  const liveAdjustmentAmount = Number(adjForm.watch("adjustmentAmount")) || 0;

  const [approving, setApproving] = useState(false);

  // Edit toggle for summary card (Category B — Edit Toggle Pattern, DRAFT only)
  const [isEditing, setIsEditing] = useState(false);
  const periodForm = useZodForm(payrollEditFormSchema, {
    defaultValues: { periodStart: "", periodEnd: "", actualWorkDays: undefined },
  });
  const [comparison, setComparison] = useState<Record<string, number> | null>(null);
  const [prevPeriod, setPrevPeriod] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [payRes, compRes] = await Promise.all([
      fetch(`/api/payroll/${id}`),
      fetch(`/api/payroll/compare?current=${id}`),
    ]);
    const payData = await payRes.json();
    setData(payData);
    setDetailItem((current) => {
      if (!current) return current;
      return payData.items?.find((i: PayrollItem) => i.id === current.id) ?? current;
    });
    try {
      const comp = await compRes.json();
      if (comp?.comparison) {
        const map: Record<string, number> = {};
        for (const c of comp.comparison) {
          if (c.delta !== null) map[c.employeeId] = c.delta;
        }
        setComparison(map);
        setPrevPeriod(comp.previousPeriod);
      }
    } catch { /* no comparison available */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const payrollItems = useMemo(() => data?.items ?? [], [data]);
  const filteredItems = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    return payrollItems.filter((item) => {
      const matchesSearch =
        !q ||
        [
          item.employee.nama,
          item.employee.kode,
          item.employee.jabatan,
          item.employee.bankName ?? "",
          item.employee.bankAccountNo ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const matchesBank =
        bankFilter === "all" ||
        (bankFilter === "complete" && Boolean(item.employee.bankAccountNo)) ||
        (bankFilter === "missing" && !item.employee.bankAccountNo);
      return matchesSearch && matchesBank;
    });
  }, [payrollItems, employeeSearch, bankFilter]);

  // Memoised — rebuilding this array on every render (e.g. while the period
  // edit form or either dialog's form state changes) would remount every row
  // cell and close any open row-action menu (lesson from the Cycle 2
  // reviews). Only `comparison` and `setDetailItem` are read inside; the
  // latter is a stable `useState` setter.
  const columns: ColumnDef<PayrollItem>[] = useMemo(() => [
    {
      id: "nama",
      accessorFn: (row) => row.employee.nama,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Karyawan" />
      ),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar name={item.employee.nama} size="sm" className="shrink-0" />
            <DataTableLinkCell
              className="min-w-0 whitespace-normal"
              onClick={() => setDetailItem(item)}
              description={`${item.employee.kode} · ${item.employee.jabatan}`}
            >
              {item.employee.nama}
            </DataTableLinkCell>
          </div>
        );
      },
    },
    {
      id: "grossAmount",
      accessorFn: (row) => Number(row.grossAmount),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Pendapatan" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="font-currency text-sm">{formatRupiah(row.original.grossAmount)}</span>
      ),
    },
    {
      id: "deductions",
      accessorFn: (row) => Number(row.deductions),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Potongan" />
      ),
      meta: { priority: "low" },
      cell: ({ row }) => (
        <span className="font-currency text-sm text-destructive">{formatRupiah(row.original.deductions)}</span>
      ),
    },
    {
      id: "netAmount",
      accessorFn: (row) => Number(row.netAmount),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Bersih" />
      ),
      cell: ({ row }) => {
        const item = row.original;
        const delta = comparison?.[item.employee.id];
        return (
          <div className="whitespace-normal">
            <span className="font-currency text-sm font-bold">{formatRupiah(item.netAmount)}</span>
            {delta !== undefined && (
              <p className={`font-currency text-xs ${delta >= 0 ? "text-success" : "text-destructive"}`}>
                {delta >= 0 ? "+" : ""}{formatRupiah(delta)}
                <span className="ml-1 font-sans text-muted-foreground">vs periode lalu</span>
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "bank",
      header: "Rekening",
      meta: { priority: "low" },
      cell: ({ row }) => {
        if (!row.original.employee.bankAccountNo) {
          return <StatusBadge status="UNFILLED" />;
        }
        return (
          <span className="text-xs text-muted-foreground font-currency">
            ••• {row.original.employee.bankAccountNo.slice(-4)}
          </span>
        );
      },
    },
  ], [comparison]);

  function openVars(item: PayrollItem) {
    varsForm.reset({
      overtimeHours: item.overtimeHours,
      outdoorDays: item.outdoorDays,
      holidayWorkedDays: item.holidayWorkedDays,
      dcDays: item.dcDays,
    });
    setVarsModal(item);
  }

  const saveVars = varsForm.handleSubmit(async (values) => {
    if (!varsModal) return;
    try {
      await sendJson(`/api/payroll/${id}/items/${varsModal.id}/variables`, { method: "PUT", body: values }, "Variabel belum tersimpan. Coba lagi sebentar.");
      toast.success("Variabel diperbarui");
      setVarsModal(null);
      fetchData();
    } catch (err) {
      applyServerErrors(varsForm, err, "Variabel belum tersimpan. Coba lagi sebentar.");
    }
  });

  function openLineAdj(item: PayrollItem, line: PayrollLine) {
    // Blank (not "0") when there's no existing adjustment — matches the
    // prior `String(line.adjustmentAmount || "")` display exactly;
    // z.coerce.number() still turns a resubmitted blank back into 0.
    adjForm.reset({
      adjustmentAmount: line.adjustmentAmount ? String(line.adjustmentAmount) : "",
      adjustmentNote: line.adjustmentNote ?? "",
    });
    setLineModal({ item, line });
  }

  const saveLineAdj = adjForm.handleSubmit(async (values) => {
    if (!lineModal) return;
    try {
      await sendJson(`/api/payroll/${id}/items/${lineModal.item.id}/lines/${lineModal.line.id}`, { method: "PUT", body: values }, "Penyesuaian belum tersimpan. Coba lagi sebentar.");
      toast.success("Penyesuaian disimpan");
      setLineModal(null);
      fetchData();
    } catch (err) {
      applyServerErrors(adjForm, err, "Penyesuaian belum tersimpan. Coba lagi sebentar.");
    }
  });

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`/api/payroll/${id}/approve`, { method: "POST" });
      if (res.ok) { toast.success("Penggajian disetujui"); fetchData(); }
      else {
        // The API's own sentence ("Periode belum selesai. …", negative-net
        // names) is the useful part — show it instead of a bare failure.
        const err = await readApiError(res, "Penggajian belum bisa disetujui. Coba lagi sebentar.");
        toast.error(err.message);
        // Re-thrown so ConfirmDialog keeps the modal open for retry instead
        // of closing after a failed approve (it only closes when onConfirm
        // resolves without throwing).
        throw err;
      }
    } finally {
      setApproving(false);
    }
  }

  // HR-11: a DRAFT run can be discarded (the API drops its slips). Only the
  // DRAFT -> CANCELLED flip exists server-side, so the button is DRAFT-only.
  async function handleCancelDraft() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/payroll/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const err = await readApiError(res, "Draf belum bisa dibatalkan. Coba lagi sebentar.");
        toast.error(err.message);
        throw err; // keeps the dialog open for a retry
      }
      toast.success("Draf penggajian dibatalkan");
      router.push("/admin/payroll");
    } finally {
      setCancelling(false);
    }
  }

  async function handleExport() {
    window.open(`/api/payroll/${id}/export/bsi`, "_blank");
    setTimeout(fetchData, 1000);
  }

  function openEdit() {
    if (!data) return;
    periodForm.reset({
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      actualWorkDays: data.actualWorkDays,
    });
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  const savePeriod = periodForm.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/payroll/${id}`, { method: "PUT", body: values }, "Periode belum tersimpan. Coba lagi sebentar.");
      toast.success("Periode diperbarui");
      setIsEditing(false);
      fetchData();
    } catch (err) {
      applyServerErrors(periodForm, err, "Periode belum tersimpan. Coba lagi sebentar.");
    }
  });

  if (loading) return <DetailPageSkeleton />;
  if (!data) return <EmptyState title="Data penggajian tidak ditemukan" description="Data penggajian tidak tersedia atau telah dihapus." actionLabel="Kembali ke daftar penggajian" actionHref="/admin/payroll" />;

  const totalGross = data.items.reduce((s, i) => s + Number(i.grossAmount), 0);
  const totalDed = data.items.reduce((s, i) => s + Number(i.deductions), 0);
  const totalNet = data.items.reduce((s, i) => s + Number(i.netAmount), 0);
  const noBank = data.items.filter((i) => !i.employee.bankAccountNo);
  const isDraft = data.status === "DRAFT";
  const isApproved = ["APPROVED", "EXPORTED", "SLIPS_SENT"].includes(data.status);
  // Mirrors POST /api/payroll/[id]/approve (HRX-5): the whole of periodEnd still
  // counts as a working day, so approval opens the day after it (Asia/Jakarta).
  // The server 409s earlier attempts; disabling here saves the round trip.
  const periodStillOpen = isDraft && data.periodEnd >= getTodayInTimezone("Asia/Jakarta");
  const approveFrom = (() => {
    const d = new Date(`${data.periodEnd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <>
      <DetailPageHeader
        backHref="/admin/payroll"
        title={`${formatDateShort(data.periodStart)} — ${formatDateShort(data.periodEnd)}`}
        description={`${data.items.length} karyawan · ${data.actualWorkDays} hari kerja`}
        badge={
          <>
            <StatusBadge status={data.status} />
            {isDraft && <Badge variant="outline" data-testid="payroll-draft-provisional">Sementara</Badge>}
          </>
        }
        actions={
          <>
            {isDraft && !isEditing && (
              <Button size="sm" variant="outline" onClick={openEdit} data-testid="payroll-edit-btn">
                <Pencil size={14} className="mr-1.5" /> Ubah
              </Button>
            )}
            {isDraft && (
              <Button size="sm" variant="outline" onClick={() => setCancelModal(true)} data-testid="payroll-cancel-draft-btn" className="text-destructive hover:text-destructive">
                <Trash2 size={14} className="mr-1.5" /> Batalkan draf
              </Button>
            )}
            {periodStillOpen && (
              <span id="payroll-approve-hint" className="text-xs text-muted-foreground">
                Bisa disetujui mulai {formatDate(approveFrom)}
              </span>
            )}
            {isDraft && (
              <Button
                size="sm"
                onClick={() => setApproveModal(true)}
                disabled={periodStillOpen}
                aria-describedby={periodStillOpen ? "payroll-approve-hint" : undefined}
              >
                <Check size={14} className="mr-1.5" /> Setujui
              </Button>
            )}
            {isApproved && <Button size="sm" variant="outline" onClick={handleExport}><Download size={14} className="mr-1.5" /> Ekspor BSI</Button>}
          </>
        }
      />

      {/* Summary card — read-only view or Edit mode (DRAFT only) */}
      <Card className="p-card mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-medium">Ringkasan Periode</p>
            <p className="text-xs text-muted-foreground">
              {isEditing ? "Ubah periode atau hari kerja lalu simpan." : "Detail periode penggajian."}
            </p>
          </div>
          {isEditing && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={periodForm.formState.isSubmitting}>
                <X size={14} className="mr-1.5" /> Batal
              </Button>
              <Button size="sm" onClick={savePeriod} disabled={periodForm.formState.isSubmitting} data-testid="payroll-edit-save">
                {periodForm.formState.isSubmitting ? "Menyimpan..." : "Simpan Perubahan"}
              </Button>
            </div>
          )}
        </div>

        {!isEditing ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Periode Mulai</p>
              <p className="text-sm font-medium" data-testid="payroll-period-start">{formatDateShort(data.periodStart)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Periode Akhir</p>
              <p className="text-sm font-medium">{formatDateShort(data.periodEnd)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hari Kerja Aktual</p>
              <p className="text-sm font-medium">{data.actualWorkDays}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormRootError formState={periodForm.formState} className="md:col-span-3" />
            <FormField
              control={periodForm.control}
              name="periodStart"
              label="Periode Mulai"
              id="payroll-period-start"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} />
              )}
            />
            <FormField
              control={periodForm.control}
              name="periodEnd"
              label="Periode Akhir"
              id="payroll-period-end"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={field.value} onChange={field.onChange} />
              )}
            />
            <FormField
              control={periodForm.control}
              name="actualWorkDays"
              label="Hari Kerja Aktual"
              id="payroll-actual-work-days"
              description="Mengubah hari kerja aktual tidak menghitung ulang slip. Buat ulang penggajian bila perlu."
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" min={1} />
              )}
            />
          </div>
        )}
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-card"><p className="text-xs text-muted-foreground">Total Pendapatan</p><p className="font-currency text-2xl font-bold mt-1">{formatRupiah(totalGross)}</p></Card>
        <Card className="p-card"><p className="text-xs text-muted-foreground">Total Potongan</p><p className="font-currency text-2xl font-bold mt-1 text-destructive">{formatRupiah(totalDed)}</p></Card>
        <Card className="p-card"><p className="text-xs text-muted-foreground">Total Bersih</p><p className="font-currency text-2xl font-bold mt-1 text-primary-text">{formatRupiah(totalNet)}</p></Card>
        <Card className="p-card"><p className="text-xs text-muted-foreground">Status</p>
          <StatusBadge status={data.status} />
          {noBank.length > 0 && <p className="text-xs text-destructive mt-1">{noBank.length} tanpa rekening</p>}
        </Card>
      </div>

      {prevPeriod && (
        <p className="text-xs text-muted-foreground mb-4">
          Dibandingkan dengan periode sebelumnya: {prevPeriod.split(" — ").map((d) => formatDateShort(d)).join(" — ")}
        </p>
      )}
      {periodStillOpen && (
        <p className="text-xs text-muted-foreground mb-4" data-testid="payroll-provisional-note">
          Angka sementara: dihitung dari kehadiran sampai hari ini, jadi selisih dengan periode lalu belum bermakna.
        </p>
      )}

      {/* Employee DataTable */}
      <DataTableToolbar
        value={employeeSearch}
        onValueChange={setEmployeeSearch}
        searchPlaceholder="Cari karyawan, kode, jabatan..."
        filters={[
          {
            key: "bank",
            label: "Rekening",
            value: bankFilter,
            onChange: setBankFilter,
            options: [
              { value: "all", label: "Semua Rekening" },
              { value: "complete", label: "Rekening Lengkap" },
              { value: "missing", label: "Tanpa Rekening" },
            ],
          },
        ]}
      />
      <DataTable
        columns={columns}
        data={filteredItems}
        pagination={{ page: 1, pageSize: 10, total: filteredItems.length, totalPages: Math.max(1, Math.ceil(filteredItems.length / 10)) }}
        defaultSort={{ field: "nama", order: "asc" }}
        emptyTitle="Tidak ada data karyawan"
        emptyDescription="Ubah kata kunci atau filter rekening untuk melihat data lain."
      />

      {/* Detail Sheet */}
      <Sheet open={!!detailItem} onOpenChange={(o) => !o && setDetailItem(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {detailItem && (
            <>
              <SheetHeader>
                <SheetTitle>{detailItem.employee.nama}</SheetTitle>
                <SheetDescription>
                  {detailItem.employee.kode} · {detailItem.employee.jabatan}
                </SheetDescription>
              </SheetHeader>

              {/* Sheet body padding — SheetContent has none, SheetHeader brings its own px */}
              <div className="mt-6 space-y-4 px-4 pb-4" data-testid="payroll-item-sheet-body">
                {/* Variables button */}
                {isDraft && (
                  <Button variant="link" size="sm" onClick={() => openVars(detailItem)} className="gap-1.5">
                    <Settings2 size={12} /> Ubah variabel kehadiran
                  </Button>
                )}

                {/* Component lines */}
                <div className="space-y-1">
                  {detailItem.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between py-2 text-xs border-b border-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={line.categorySnapshot === "INCOME" ? "text-foreground" : "text-destructive"}>
                          {line.labelSnapshot}
                        </span>
                        {Number(line.adjustmentAmount) !== 0 && (
                          <Badge variant="outline" className="text-caption">Adj</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-currency">{formatRupiah(line.finalAmount)}</span>
                        {isDraft && (
                          <Button type="button" size="icon-sm" variant="ghost" onClick={() => openLineAdj(detailItem, line)} aria-label={`Ubah penyesuaian ${line.labelSnapshot}`} className="text-muted-foreground">
                            <Pencil size={12} />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Totals */}
                <div className="border-t border-border pt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Pendapatan</span><span className="font-currency font-medium">{formatRupiah(detailItem.grossAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Potongan</span><span className="font-currency font-medium text-destructive">{formatRupiah(detailItem.deductions)}</span></div>
                  <div className="flex justify-between font-bold text-base"><span>Bersih</span><span className="font-currency text-primary-text">{formatRupiah(detailItem.netAmount)}</span></div>
                </div>

                {/* Bank info */}
                {detailItem.employee.bankAccountNo && (
                  <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                    Transfer ke: {detailItem.employee.bankName} {detailItem.employee.bankAccountNo}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Variables Modal */}
      <ResponsiveFormDialog
        open={!!varsModal}
        onOpenChange={(o) => !o && setVarsModal(null)}
        title="Variabel Kehadiran"
        description={varsModal?.employee.nama}
        size="2xl"
        footer={
          <FormDialogFooter
            formId={varsFormId}
            pending={varsForm.formState.isSubmitting}
            onCancel={() => setVarsModal(null)}
            submitLabel="Simpan & Hitung Ulang"
          />
        }
      >
        <form id={varsFormId} onSubmit={saveVars} noValidate className="space-y-field">
          <FormRootError formState={varsForm.formState} />
          <FormField
            control={varsForm.control}
            name="overtimeHours"
            label="Jam Lembur"
            id="payroll-vars-overtime-hours"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" step="0.5" />
            )}
          />
          <FormField
            control={varsForm.control}
            name="outdoorDays"
            label="Hari Outdoor"
            id="payroll-vars-outdoor-days"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" />
            )}
          />
          <FormField
            control={varsForm.control}
            name="holidayWorkedDays"
            label="Hari Libur Kerja"
            id="payroll-vars-holiday-worked-days"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" />
            )}
          />
          <FormField
            control={varsForm.control}
            name="dcDays"
            label="Hari DC"
            id="payroll-vars-dc-days"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" />
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Line Adjustment Modal */}
      <ResponsiveFormDialog
        open={!!lineModal}
        onOpenChange={(o) => !o && setLineModal(null)}
        title="Penyesuaian"
        description={lineModal ? `${lineModal.line.labelSnapshot} — ${lineModal.item.employee.nama}` : undefined}
        size="lg"
        footer={
          <FormDialogFooter
            formId={adjFormId}
            pending={adjForm.formState.isSubmitting}
            onCancel={() => setLineModal(null)}
            submitLabel="Simpan Perubahan"
          />
        }
      >
        <form id={adjFormId} onSubmit={saveLineAdj} noValidate className="space-y-field">
          <FormRootError formState={adjForm.formState} />
          <p className="text-sm text-muted-foreground">Kalkulasi: <span className="font-currency font-medium">{formatRupiah(lineModal?.line.calculatedAmount ?? 0)}</span></p>
          <FormField
            control={adjForm.control}
            name="adjustmentAmount"
            label="Penyesuaian (+ atau -)"
            id="payroll-line-adjustment-amount"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={String(field.value ?? "")} type="number" placeholder="0" className="font-currency" />
            )}
          />
          <FormField
            control={adjForm.control}
            name="adjustmentNote"
            label="Catatan"
            required
            id="payroll-line-adjustment-note"
            render={({ field, controlProps }) => (
              <Textarea {...field} {...controlProps} placeholder="Alasan penyesuaian..." rows={2} />
            )}
          />
          <p className="text-sm">Final: <span className="font-currency font-bold text-primary-text">{formatRupiah(Number(lineModal?.line.calculatedAmount ?? 0) + liveAdjustmentAmount)}</span></p>
        </form>
      </ResponsiveFormDialog>

      {/* Cancel draft — discards the run's slips (HR-11) */}
      <ConfirmDialog
        open={cancelModal}
        onOpenChange={setCancelModal}
        title="Batalkan draf penggajian?"
        description="Semua slip dalam draf ini akan dibuang dan tidak bisa dikembalikan. Anda bisa membuat draf baru untuk periode yang sama."
        confirmLabel="Batalkan draf"
        cancelLabel="Kembali"
        destructive
        onConfirm={handleCancelDraft}
        loading={cancelling}
      />

      {/* Approve — irreversible (locks attendance) */}
      <ConfirmDialog
        open={approveModal}
        onOpenChange={setApproveModal}
        title="Setujui Penggajian"
        description="Setelah disetujui, kehadiran akan dikunci dan tidak bisa diubah."
        confirmLabel="Setujui"
        onConfirm={handleApprove}
        loading={approving}
      >
        <div className="py-2 space-y-2 text-sm">
          <p>Periode: {formatDateShort(data.periodStart)} — {formatDateShort(data.periodEnd)}</p>
          <p>Karyawan: {data.items.length}</p>
          <p>Total Bersih: <span className="font-currency font-bold">{formatRupiah(totalNet)}</span></p>
          {noBank.length > 0 && <p className="text-destructive">{noBank.length} karyawan tanpa rekening bank</p>}
        </div>
      </ConfirmDialog>
    </>
  );
}
