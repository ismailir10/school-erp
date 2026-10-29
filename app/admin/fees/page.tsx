"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { Coins, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminTabs, AdminTabsList, AdminTabsTrigger, AdminTabsContent } from "@/components/admin/admin-tabs";
import { KeringananTab } from "@/components/admin/fees/keringanan-tab";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah } from "@/lib/format";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { feeComponentFormSchema, type CreateFeeComponentInput } from "@/lib/validations/fee-component";
import { MAX_FEE_AMOUNT } from "@/lib/validations/fee-structure";
import { ProgramClassesUsage } from "@/components/admin/fees/program-classes-usage";
import { BundleFeesSection } from "@/components/admin/fees/bundle-fees-section";

type FeeComponent = { id: string; code: string; label: string; category: string; isRecurring: boolean; isEnabled: boolean; sortOrder: number };
type Program = { id: string; code: string; name: string; status: string };
type AcademicYear = { id: string; name: string; status: string };
type FeeStructure = { id: string; feeComponentId: string; amount: number; notes: string | null; feeComponent: FeeComponent };

const CATEGORY_LABELS: Record<string, string> = { TUITION: "SPP", REGISTRATION: "Pendaftaran", ACTIVITY: "Kegiatan", MATERIAL: "Bahan", OTHER: "Lainnya" };

// Tarif per Program's live amounts reach the Tarif cell through context, not
// a closure: TanStack's flexRender mounts each `cell` function as its own
// React component, so a column array rebuilt on every render would remount
// every RupiahInput on every keystroke and drop focus. Keeping
// STRUCTURE_COLUMNS module-level keeps the cell identity stable.
type TarifContextValue = {
  amounts: Record<string, number>;
  setAmount: (componentId: string, amount: number) => void;
};
const TarifContext = createContext<TarifContextValue>({ amounts: {}, setAmount: () => {} });

function TarifCell({ component: c }: { component: FeeComponent }) {
  const { amounts, setAmount } = useContext(TarifContext);
  // Inactive-but-stored rows are read-only — editing them would let an
  // admin change an amount `saveStructure()` never sends, which would
  // look saved but silently do nothing.
  if (!c.isEnabled) {
    return (
      <div className="text-right font-currency text-sm tabular-nums text-muted-foreground">
        {formatRupiah(amounts[c.id] ?? 0)}
      </div>
    );
  }
  return (
    <RupiahInput
      aria-label={`Tarif ${c.label}`}
      value={amounts[c.id] ?? 0}
      onChange={(v) => setAmount(c.id, v ?? 0)}
      className="ml-auto max-w-40"
    />
  );
}

const STRUCTURE_COLUMNS: ColumnDef<FeeComponent>[] = [
  {
    accessorKey: "label",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Komponen" />,
    cell: ({ row }) => {
      const c = row.original;
      return (
        <div className={!c.isEnabled ? "opacity-60" : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{c.label}</span>
            <Badge variant="outline" className="text-xs font-currency">{c.code}</Badge>
            {!c.isEnabled && <StatusBadge status="INACTIVE" label="Nonaktif" />}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "category",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Kategori" />,
    cell: ({ row }) => <Badge variant="secondary" className="text-xs">{CATEGORY_LABELS[row.original.category] ?? row.original.category}</Badge>,
  },
  {
    accessorKey: "isRecurring",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tipe" />,
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.isRecurring ? "Bulanan" : "Sekali bayar"}</span>,
  },
  {
    id: "amount",
    header: () => <div className="text-right">Tarif</div>,
    cell: ({ row }) => <TarifCell component={row.original} />,
  },
];

const FEE_TABS = ["components", "structure", "keringanan"] as const;

export default function FeesPage() {
  // `?tab=` so other surfaces can deep-link to the right tab — the student
  // dossier's Keringanan section links straight here, and landing on Komponen
  // Biaya instead would make the admin hunt for the tab they asked for.
  // Unrecognised values fall back rather than rendering an empty tab body.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = FEE_TABS.includes(tabParam as (typeof FEE_TABS)[number])
    ? (tabParam as string)
    : "components";

  const [components, setComponents] = useState<FeeComponent[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [componentDialog, setComponentDialog] = useState(false);
  const [editingFee, setEditingFee] = useState<FeeComponent | null>(null);
  const [componentSearch, setComponentSearch] = useState("");
  const [componentStatus, setComponentStatus] = useState("ACTIVE");
  const [componentCategory, setComponentCategory] = useState("all");
  const componentFormId = useId();
  // Reused for both create and edit — createFeeComponentSchema's required
  // `code` is always satisfied on edit too (defaultValues seed it from the
  // existing row; the field itself is rendered disabled, so it's never
  // touched). `updateFeeComponentSchema` (server-side, no `code`) stays the
  // API's own schema for PUT; the client posts the same body shape either
  // way, same as before this migration.
  const componentForm = useZodForm(feeComponentFormSchema, {
    defaultValues: { code: "", label: "", category: "TUITION", isRecurring: true, sortOrder: "0" },
  });
  const [confirmTarget, setConfirmTarget] = useState<FeeComponent | null>(null);

  // Fee structure state
  const [selectedProgram, setSelectedProgram] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [structures, setStructures] = useState<FeeStructure[]>([]);
  const [structureAmounts, setStructureAmounts] = useState<Record<string, number>>({});
  // Snapshot taken right after a fetch (or a successful save) resolves —
  // compared against `structureAmounts` to drive the dirty-state indicator
  // and gate "Simpan Tarif". Same JSON.stringify-equality approach as
  // app/admin/report-cards/raport-editor.tsx's `isDirty`.
  const [structureBaseline, setStructureBaseline] = useState<Record<string, number>>({});
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureSaving, setStructureSaving] = useState(false);
  // Set when the admin picks a different program/year while `structureDirty`
  // is true — gates the switch behind a ConfirmDialog instead of letting
  // `fetchStructure()`'s effect silently overwrite the unsaved amounts.
  const [pendingSelection, setPendingSelection] = useState<{ field: "program" | "year"; value: string } | null>(null);
  // "Harga paket sekolah + daycare" belongs to the year, not the program: its
  // section owns its edits and only reports whether it has unsaved ones, which
  // gates the YEAR switch (a program switch never touches it). The key is
  // bumped after "Simpan Tarif" so its "Jumlah biasa" hints refetch.
  const [bundleDirty, setBundleDirty] = useState(false);
  const [bundleRefreshKey, setBundleRefreshKey] = useState(0);

  async function fetchAll() {
    try {
      const [cRes, pRes, yRes] = await Promise.all([
        fetch("/api/fee-components"),
        fetch("/api/programs"),
        fetch("/api/academic-years"),
      ]);
      if (!cRes.ok || !pRes.ok || !yRes.ok) {
        toast.error("Gagal memuat data biaya");
        return;
      }
      const [c, p, y] = await Promise.all([cRes.json(), pRes.json(), yRes.json()]);
      setComponents(c); setPrograms(p); setYears(y);
    } catch {
      toast.error("Gagal memuat data biaya");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  // Default the Tarif per Program pickers to the active program/year — the
  // same "first ACTIVE, else first" rule the billing-run wizard uses
  // (components/admin/invoices/billing-run-wizard/billing-defaults.ts). Only
  // fills an EMPTY selection, so it never clobbers an admin's manual choice
  // on a later refetch (e.g. after toggling a component).
  useEffect(() => {
    if (programs.length === 0 || years.length === 0) return;
    setSelectedProgram((prev) => prev || (programs.find((p) => p.status === "ACTIVE") ?? programs[0]).id);
    setSelectedYear((prev) => prev || (years.find((y) => y.status === "ACTIVE") ?? years[0]).id);
  }, [programs, years]);

  const saveComponent = componentForm.handleSubmit(async (values) => {
    try {
      await sendJson(
        editingFee ? `/api/fee-components/${editingFee.id}` : "/api/fee-components",
        { method: editingFee ? "PUT" : "POST", body: values },
        "Gagal menyimpan komponen biaya",
      );
      toast.success(editingFee ? "Komponen diperbarui" : "Komponen biaya ditambahkan");
      setComponentDialog(false);
      setEditingFee(null);
      fetchAll();
    } catch (err) {
      applyServerErrors(componentForm, err, "Gagal menyimpan komponen biaya");
    }
  });

  // Returns whether the toggle succeeded so the deactivate ConfirmDialog can
  // decide whether to keep itself open for a retry (same contract as
  // app/admin/(hr)/salary-components/page.tsx `toggleEnabled`). `useCallback`
  // with an empty dep array — needed so `feeComponentColumns` below can be
  // memoised too; same "frozen at mount, calls only stable setters" contract
  // the mount-time `fetchAll()` effect above already relies on.
  const toggleComponent = useCallback(async (c: FeeComponent): Promise<boolean> => {
    const res = await fetch(`/api/fee-components/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isEnabled: !c.isEnabled }) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengubah status komponen");
      return false;
    }
    toast.success(c.isEnabled ? "Komponen dinonaktifkan" : "Komponen diaktifkan");
    fetchAll();
    return true;
  }, []);

  // Ditto — stabilises the "Ubah" row action for `feeComponentColumns`.
  const openEditFee = useCallback(
    (c: FeeComponent) => {
      setEditingFee(c);
      componentForm.reset({
        code: c.code,
        label: c.label,
        category: c.category as CreateFeeComponentInput["category"],
        isRecurring: c.isRecurring,
        sortOrder: String(c.sortOrder),
      });
      setComponentDialog(true);
    },
    [componentForm],
  );

  async function fetchStructure() {
    if (!selectedProgram || !selectedYear) return;
    setStructureLoading(true);
    try {
      const res = await fetch(`/api/fee-structure?programId=${selectedProgram}&academicYearId=${selectedYear}`);
      if (!res.ok) { toast.error("Gagal memuat struktur biaya"); return; }
      const data: FeeStructure[] = await res.json();
      setStructures(data);
      const amounts: Record<string, number> = {};
      // API returns Prisma Decimal serialized as string — coerce on ingest.
      for (const s of data) amounts[s.feeComponentId] = Number(s.amount) || 0;
      setStructureAmounts(amounts);
      setStructureBaseline(amounts);
    } catch {
      toast.error("Gagal memuat struktur biaya");
    } finally {
      setStructureLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStructure(); }, [selectedProgram, selectedYear]);

  async function saveStructure() {
    // FIN-5: catch an oversized tarif here with the component named, instead
    // of a server round trip that used to end in a bare "Gagal menyimpan".
    const tooBig = components.find((c) => c.isEnabled && (structureAmounts[c.id] ?? 0) > MAX_FEE_AMOUNT);
    if (tooBig) {
      toast.error(`Tarif ${tooBig.label} maksimal ${formatRupiah(MAX_FEE_AMOUNT)}`);
      return;
    }
    setStructureSaving(true);
    // Unchanged payload shape — inactive components are read-only in the UI
    // (see `storedIds` below) and are deliberately never sent here,
    // so their previously-saved amount is left untouched by this PUT.
    const fees = components.filter(c => c.isEnabled).map(c => ({ feeComponentId: c.id, amount: structureAmounts[c.id] ?? 0 }));
    const res = await fetch("/api/fee-structure", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ programId: selectedProgram, academicYearId: selectedYear, fees }) });
    if (res.ok) { toast.success("Struktur biaya disimpan"); fetchStructure(); setBundleRefreshKey((k) => k + 1); }
    else {
      // Show the server's reason (e.g. nominal too large) rather than a bare failure.
      const d = await res.json().catch(() => ({}));
      toast.error(typeof d.error === "string" && d.error ? d.error : "Gagal menyimpan struktur biaya");
    }
    setStructureSaving(false);
  }

  // Components that were deactivated but still carry a saved fee-structure
  // amount for this program/year — shown as a muted, read-only row instead
  // of silently vanishing (Context finding 5). A component with no stored
  // row simply isn't billed and isn't shown here even if inactive.
  // Active/inactive comes from `components` (refetched after every toggle),
  // never from the nested `structures[].feeComponent` snapshot — that one
  // is only refreshed with the structure, so a just-deactivated component
  // would otherwise vanish from this tab until the next structure fetch.
  const storedIds = useMemo(
    () => new Set(structures.map((s) => s.feeComponentId)),
    [structures],
  );
  const structureRows = useMemo(
    () => components.filter((c) => c.isEnabled || storedIds.has(c.id)),
    [components, storedIds],
  );
  // Only active components are ever billed (materializeBillingRun filters
  // `feeComponent: { isEnabled: true }` — lib/finance/materialize-billing-run.ts:85),
  // so the total shown here matches what a new invoice would actually carry,
  // rather than double-counting a deactivated component's stale amount.
  const structureTotal = useMemo(
    () => structureRows.reduce((sum, c) => sum + (c.isEnabled ? (structureAmounts[c.id] ?? 0) : 0), 0),
    [structureRows, structureAmounts],
  );
  const structureDirty = useMemo(
    () => JSON.stringify(structureAmounts) !== JSON.stringify(structureBaseline),
    [structureAmounts, structureBaseline],
  );

  const setTarifAmount = useCallback(
    (componentId: string, amount: number) => setStructureAmounts((prev) => ({ ...prev, [componentId]: amount })),
    [],
  );
  const tarifContext = useMemo(
    () => ({ amounts: structureAmounts, setAmount: setTarifAmount }),
    [structureAmounts, setTarifAmount],
  );

  // Program/year Select handlers — go straight through when there's nothing
  // unsaved; otherwise stage the pick behind the "Buang perubahan tarif?"
  // ConfirmDialog so `fetchStructure()`'s effect never overwrites unsaved
  // amounts silently.
  function handleProgramChange(v: string | null) {
    if (!v) return;
    if (structureDirty) setPendingSelection({ field: "program", value: v });
    else setSelectedProgram(v);
  }
  function handleYearChange(v: string | null) {
    if (!v) return;
    if (structureDirty || bundleDirty) setPendingSelection({ field: "year", value: v });
    else setSelectedYear(v);
  }
  function applyPendingSelection() {
    if (!pendingSelection) return;
    if (pendingSelection.field === "program") setSelectedProgram(pendingSelection.value);
    else setSelectedYear(pendingSelection.value);
  }

  // "Urutan" (sortOrder) intentionally has no column here (Assumption 4,
  // cycle doc 2026-09-26-admin-ui-standard-c1) — it only orders invoice
  // lines, not a fact an admin scans a list for. `/api/fee-components`
  // already returns rows `orderBy: { sortOrder: "asc" }`, so the table's
  // natural (unsorted) row order IS the sortOrder order; the field itself
  // stays editable in the create/edit form below.
  //
  // Memoised (Cycle 3 T7) — a fresh array every render would remount row
  // cells and close any open row-action menu. Declared before the `loading`
  // early return below so the hook always runs (rules-of-hooks).
  const feeComponentColumns: ColumnDef<FeeComponent>[] = useMemo(() => [
    {
      accessorKey: "label",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Komponen" />,
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className={!c.isEnabled ? "opacity-50" : ""}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">{c.label}</span>
              <Badge variant="outline" className="text-xs font-currency">{c.code}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">{c.isRecurring ? "Bulanan" : "Sekali bayar"}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kategori" />,
      cell: ({ row }) => <Badge variant="secondary" className="text-xs">{CATEGORY_LABELS[row.original.category] ?? row.original.category}</Badge>,
      meta: { priority: "low" },
    },
    {
      id: "status",
      accessorFn: (row) => (row.isEnabled ? "ACTIVE" : "INACTIVE"),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.isEnabled ? "ACTIVE" : "INACTIVE"}
          label={row.original.isEnabled ? "Aktif" : "Tidak Aktif"}
        />
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DataTableRowActions
          rowLabel={row.original.label}
          onEdit={() => openEditFee(row.original)}
          onDeactivate={row.original.isEnabled ? () => setConfirmTarget(row.original) : undefined}
          onActivate={!row.original.isEnabled ? () => toggleComponent(row.original) : undefined}
          isActive={row.original.isEnabled}
        />
      ),
    },
  ], [openEditFee, toggleComponent]);

  if (loading) return <Skeleton className="h-96 rounded-xl" />;

  const filteredComponents = components.filter((c) => {
    const q = componentSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      [c.code, c.label, CATEGORY_LABELS[c.category] ?? c.category]
        .join(" ")
        .toLowerCase()
        .includes(q);
    const matchesStatus =
      componentStatus === "all" ||
      (componentStatus === "ACTIVE" && c.isEnabled) ||
      (componentStatus === "INACTIVE" && !c.isEnabled);
    const matchesCategory = componentCategory === "all" || c.category === componentCategory;
    return matchesSearch && matchesStatus && matchesCategory;
  });


  return (
    <>
      <PageHeader
        title="Biaya"
        description="Daftar komponen → tarif per program → keringanan per siswa."
      />

      <AdminTabs defaultValue={initialTab}>
        <AdminTabsList>
          <AdminTabsTrigger value="components">Komponen Biaya</AdminTabsTrigger>
          <AdminTabsTrigger value="structure">Tarif per Program</AdminTabsTrigger>
          <AdminTabsTrigger value="keringanan">Keringanan Siswa</AdminTabsTrigger>
        </AdminTabsList>

        {/* Fee Components */}
        <AdminTabsContent value="components">
          <DataTableToolbar
            value={componentSearch}
            onValueChange={setComponentSearch}
            searchPlaceholder="Cari kode atau komponen..."
            filters={[
              {
                key: "status",
                label: "Status",
                value: componentStatus,
                onChange: setComponentStatus,
                resetValue: "ACTIVE",
                options: [
                  { value: "all", label: "Semua Status" },
                  { value: "ACTIVE", label: "Aktif" },
                  { value: "INACTIVE", label: "Tidak Aktif" },
                ],
              },
              {
                key: "category",
                label: "Kategori",
                value: componentCategory,
                onChange: setComponentCategory,
                options: [
                  { value: "all", label: "Semua Kategori" },
                  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
                ],
              },
            ]}
            actions={
              <Button
                size="sm"
                onClick={() => {
                  setEditingFee(null);
                  componentForm.reset({ code: "", label: "", category: "TUITION", isRecurring: true, sortOrder: String(components.length + 1) });
                  setComponentDialog(true);
                }}
              >
                <Plus size={14} className="mr-1.5" /> Tambah Komponen
              </Button>
            }
          />
          <DataTable
            columns={feeComponentColumns}
            data={filteredComponents}
            pagination={{ page: 1, pageSize: 10, total: filteredComponents.length, totalPages: Math.max(1, Math.ceil(filteredComponents.length / 10)) }}
            emptyTitle="Belum ada komponen biaya"
            emptyDescription="Ubah kata kunci atau filter, atau tambahkan komponen seperti SPP, Uang Pangkal, Seragam."
          />
        </AdminTabsContent>

        {/* Fee Structure per Program */}
        <AdminTabsContent value="structure">
          <div className="flex flex-wrap gap-3 mt-4 mb-4">
            <Select value={selectedProgram} onValueChange={handleProgramChange} disabled={structureSaving}>
              <SelectTrigger aria-label="Program" className="w-full sm:w-48"><SelectValue placeholder="Pilih program" /></SelectTrigger>
              <SelectContent>{programs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={handleYearChange} disabled={structureSaving}>
              <SelectTrigger aria-label="Tahun Ajaran" className="w-full sm:w-48"><SelectValue placeholder="Pilih tahun ajaran" /></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {programs.length === 0 || years.length === 0 ? (
            <EmptyState
              icon={Coins}
              title={programs.length === 0 ? "Belum ada program" : "Belum ada tahun ajaran"}
              description="Tambahkan program dan tahun ajaran di halaman Tahun Ajaran & Program sebelum mengatur tarif."
              actionLabel="Buka Tahun Ajaran & Program"
              actionHref="/admin/academic-years"
            />
          ) : structureLoading || !selectedProgram || !selectedYear ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <>
              <DataTableToolbar
                actions={
                  <div className="flex items-center gap-3">
                    {structureDirty && (
                      <span className="text-xs text-muted-foreground">Ada perubahan belum disimpan</span>
                    )}
                    <Button size="sm" onClick={saveStructure} disabled={structureSaving || !structureDirty}>
                      <Save size={14} className="mr-1.5" /> {structureSaving ? "Menyimpan..." : "Simpan Tarif"}
                    </Button>
                  </div>
                }
              />
              <TarifContext.Provider value={tarifContext}>
                <DataTable
                  columns={STRUCTURE_COLUMNS}
                  data={structureRows}
                  pagination={{ page: 1, pageSize: Math.max(structureRows.length, 10), total: structureRows.length, totalPages: 1 }}
                  emptyTitle="Belum ada komponen biaya aktif"
                  emptyDescription="Tambahkan komponen biaya di tab Komponen Biaya terlebih dahulu."
                />
              </TarifContext.Provider>
              <div className="flex items-center justify-between mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <p className="text-sm font-semibold">Total Komponen Aktif</p>
                <p className="font-currency text-sm font-semibold tabular-nums text-primary-text">{formatRupiah(structureTotal)}</p>
              </div>
              <ProgramClassesUsage
                programId={selectedProgram}
                programName={programs.find((p) => p.id === selectedProgram)?.name ?? ""}
                yearId={selectedYear}
              />
            </>
          )}
          {programs.length > 0 && years.length > 0 && selectedYear && (
            <BundleFeesSection
              academicYearId={selectedYear}
              refreshKey={bundleRefreshKey}
              onDirtyChange={setBundleDirty}
            />
          )}
        </AdminTabsContent>

        {/* Keringanan — durable per-student fee adjustments (Cycle A) */}
        <AdminTabsContent value="keringanan">
          <KeringananTab />
        </AdminTabsContent>
      </AdminTabs>

      {/* Add Component Dialog */}
      <ResponsiveFormDialog
        open={componentDialog}
        onOpenChange={setComponentDialog}
        title={editingFee ? "Edit Komponen Biaya" : "Tambah Komponen Biaya"}
        size="lg"
        footer={
          <FormDialogFooter
            formId={componentFormId}
            pending={componentForm.formState.isSubmitting}
            onCancel={() => setComponentDialog(false)}
            submitLabel={editingFee ? "Simpan Perubahan" : "Tambah Komponen Biaya"}
          />
        }
      >
        <form id={componentFormId} onSubmit={saveComponent} noValidate className="space-y-field">
          <FormRootError formState={componentForm.formState} />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={componentForm.control}
              name="code"
              label="Kode"
              required
              id="fee-code"
              description="Pengenal unik, permanen setelah dibuat — dipakai untuk impor dan seed data, bukan yang tampil di tagihan (itu memakai Label). Huruf, angka, _ atau -, tanpa spasi."
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} disabled={!!editingFee} placeholder="spp" />
              )}
            />
            <FormField
              control={componentForm.control}
              name="label"
              label="Label"
              required
              id="fee-label"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} placeholder="SPP Bulanan" />
              )}
            />
          </div>
          <FormField
            control={componentForm.control}
            name="category"
            label="Kategori"
            id="fee-category"
            render={({ field, controlProps }) => (
              <Select value={field.value} onValueChange={(v) => v != null && field.onChange(v)}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TUITION">SPP</SelectItem>
                  <SelectItem value="REGISTRATION">Pendaftaran</SelectItem>
                  <SelectItem value="ACTIVITY">Kegiatan</SelectItem>
                  <SelectItem value="MATERIAL">Bahan</SelectItem>
                  <SelectItem value="OTHER">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={componentForm.control}
              name="sortOrder"
              label="Urutan"
              id="fee-sort-order"
              description="Menentukan urutan komponen ini pada baris tagihan — angka lebih kecil tampil lebih dulu."
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} type="number" />
              )}
            />
            <FormField
              control={componentForm.control}
              name="isRecurring"
              label="Tipe"
              id="fee-type"
              render={({ field, controlProps }) => (
                <Select
                  value={field.value ? "true" : "false"}
                  onValueChange={(v) => v != null && field.onChange(v === "true")}
                >
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Bulanan (berulang)</SelectItem>
                    <SelectItem value="false">Sekali bayar</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </form>
      </ResponsiveFormDialog>

      {/* Deactivate guard — activation stays single-click (non-destructive).
          Consequence copy verified against lib/finance/materialize-billing-run.ts:85
          (`feeComponent: { isEnabled: true }` when reading fee structures for a
          new billing run) — a deactivated component drops out of new billing
          runs/invoices; rows already written to an Invoice are untouched. */}
      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title="Nonaktifkan komponen ini?"
        description={`${confirmTarget?.label ?? ""} tidak akan ditambahkan lagi ke tagihan atau proses tagih baru. Tagihan yang sudah dibuat tidak berubah. Bisa diaktifkan kembali kapan saja.`}
        confirmLabel="Ya, Nonaktifkan"
        destructive
        onConfirm={async () => {
          if (!confirmTarget) return;
          const ok = await toggleComponent(confirmTarget);
          if (!ok) throw new Error("Gagal menonaktifkan komponen biaya");
        }}
      />

      {/* Discard guard — switching Program/Tahun Ajaran while structureDirty
          would otherwise let fetchStructure()'s effect silently overwrite the
          unsaved amounts on the next render. Cancel leaves the current
          selection untouched (the Selects are controlled by
          selectedProgram/selectedYear, which this dialog never touches). */}
      <ConfirmDialog
        open={!!pendingSelection}
        onOpenChange={(o) => !o && setPendingSelection(null)}
        title="Buang perubahan tarif?"
        description={
          pendingSelection?.field === "year" && bundleDirty
            ? "Tarif dan harga paket yang belum disimpan akan hilang jika Anda beralih sekarang."
            : "Tarif yang belum disimpan untuk program dan tahun ajaran ini akan hilang jika Anda beralih sekarang."
        }
        confirmLabel="Buang perubahan"
        destructive
        onConfirm={() => {
          applyPendingSelection();
        }}
      />
    </>
  );
}
