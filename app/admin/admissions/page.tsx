"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormRootError } from "@/components/ui/form";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { ClipboardCheck, Plus, UserPlus, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { createAdmissionSchema } from "@/lib/validations/admission";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { ApiError } from "@/lib/api/client-errors";
import {
  AdmissionFormBody,
  EMPTY_ADMISSION_FORM,
} from "@/components/admin/admissions/admission-form-body";
import { SiblingDetectBanner } from "@/components/admin/admissions/sibling-detect-banner";
import { createAdmissionColumns } from "@/components/admin/admissions/columns";
import { isLeadEditable, rowLabel } from "@/components/admin/admissions/row-actions";
import { SendFormulirDialog } from "@/components/admin/admissions/send-formulir-dialog";
import { PAYMENT_UNPAID, TAHAP_FILTER_OPTIONS } from "@/components/admin/admissions/constants";
import { useUrlFilters } from "@/components/admin/admissions/use-url-filters";
import { useRowFocus } from "@/components/admin/admissions/use-row-focus";
import { useAdmissionList } from "@/components/admin/admissions/use-admission-list";
import { useSendFormulir } from "@/components/admin/admissions/use-send-formulir";
import { resolveFollowUpPhone } from "@/lib/enrollment/follow-up";
import { admissionChildLabel } from "@/lib/admission/child-label";
import type { Admission, Program } from "@/components/admin/admissions/types";

const LIST_PATH = "/admin/admissions";
const CANCEL_FALLBACK = "Gagal membatalkan pendaftaran. Coba lagi.";

type StatFilterKey = "all" | "BARU" | "FORMULIR_MASUK" | "unpaid";
type StatCardSpec = {
  label: string; value: string | number; icon: typeof Users; color: "primary" | "warning" | "success";
  filter: StatFilterKey; active: boolean;
};

/** A stat card that is also the filter for the rows it counts. */
function StatFilter({
  label, value, pressed, onPress, children,
}: { label: string; value: string | number; pressed: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${label}: ${value}`}
      onClick={onPress}
      className="block w-full rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:ring-2 aria-pressed:ring-primary/40"
    >
      {children}
    </button>
  );
}

function DiscardAdmissionFooter({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
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

// ------------------------------------------------------------------
// Page (owns list state, fetching, the dialogs' open state + handlers; columns,
// row actions and form body live in components/admin/admissions/*).
// The URL is the source of truth for the filters (`?tahap=`, `?payment=unpaid`,
// `?search=`, `?page=`), so dashboard links and reloads land on the same view.
// ------------------------------------------------------------------

export default function AdmissionsPage() {
  const {
    tahap, unpaidOnly, search, pageNumber, editId,
    updateQuery, searchInput, setSearchInput, commitSearch,
  } = useUrlFilters(LIST_PATH);

  const [programs, setPrograms] = useState<Program[]>([]);
  const {
    data, canEdit, stats, pagination, loading, loadError, loadedQuery, query, refetch: fetchAdmissions, setPageSize, sortBy, sortOrder, setSort,
  } = useAdmissionList({
    pageNumber,
    search,
    tahap,
    unpaidOnly,
    onPageOutOfRange: (lastPage) => updateQuery({ page: lastPage > 1 ? String(lastPage) : null }),
  });

  // "Kirim Formulir" is one tap; `sent` is the result card's content (the lead + the invite response).
  const { send, sendingIds, sent: formulirSent, clearSent } = useSendFormulir({ onChanged: fetchAdmissions });

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmission, setEditingAdmission] = useState<Admission | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Admission | null>(null);
  const admissionFormId = useId();
  const form = useZodForm(createAdmissionSchema, { defaultValues: EMPTY_ADMISSION_FORM });
  const dirty = form.formState.isDirty;
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftFocus = useRef<HTMLElement | null>(null);

  // Focus goes back to the row a dialog was opened from (after the reload, when it changed something).
  const { focusRow, focusWhenLoaded } = useRowFocus(loading);

  function keepDraft() {
    setDiscardOpen(false);
    // Restore after the popup's focus manager handles the removed footer.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (draftFocus.current?.isConnected) draftFocus.current.focus();
      else document.getElementById(admissionFormId)?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    }));
  }

  function closeForm(options?: { reload?: boolean }) {
    const rowId = editingAdmission?.id ?? null;
    setDiscardOpen(false);
    setDialogOpen(false);
    setEditingAdmission(null);
    form.reset(EMPTY_ADMISSION_FORM);
    if (rowId) {
      if (options?.reload) focusWhenLoaded(rowId);
      else focusRow(rowId);
    }
  }

  function requestFormClose() {
    if (form.formState.isSubmitting) return;
    if (discardOpen) { keepDraft(); return; }
    if (dirty) {
      const active = document.activeElement;
      draftFocus.current = active instanceof HTMLElement && document.getElementById(admissionFormId)?.contains(active) ? active : null;
      setDiscardOpen(true);
    } else closeForm();
  }

  // Fetch programs once (the lead form's "Program diminati" select).
  useEffect(() => {
    fetch("/api/programs")
      .then((r) => r.json())
      .then((p) => setPrograms(Array.isArray(p) ? p : p.data ?? []))
      .catch((err) => console.error("[admissions] programs fetch failed", err));
  }, []);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handlePageChange = useCallback((page: number) => {
    updateQuery({ page: page > 1 ? String(page) : null });
  }, [updateQuery]);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    updateQuery({ page: null });
  }, [updateQuery, setPageSize]);

  const handleSortChange = useCallback((field: string, order: "asc" | "desc") => {
    // The table reports its starting sort on mount: that must not throw away `?page=`.
    if (field === sortBy && order === sortOrder) return;
    setSort(field, order);
    updateQuery({ page: null });
  }, [updateQuery, setSort, sortBy, sortOrder]);

  const handleTahapChange = useCallback((value: string) => {
    updateQuery({ tahap: value === "all" ? null : value, page: null });
  }, [updateQuery]);

  const handleUnpaidChange = useCallback((pressed: boolean) => {
    updateQuery({ payment: pressed ? PAYMENT_UNPAID : null, page: null });
  }, [updateQuery]);

  const handleResetFilters = useCallback(() => {
    updateQuery({ payment: null, search: null, tahap: null, page: null });
  }, [updateQuery]);

  // A stat card applies its own filter alone (the counts ignore search, so search is cleared too);
  // pressing the active card, or Total, shows everything again.
  const applyStat = useCallback((filter: StatFilterKey) => {
    const clear = { tahap: null, payment: null, search: null, page: null };
    if (filter === "all") updateQuery(clear);
    else if (filter === "unpaid") updateQuery({ ...clear, payment: PAYMENT_UNPAID });
    else updateQuery({ ...clear, tahap: filter });
  }, [updateQuery]);

  function closeSentCard() {
    const id = formulirSent?.admission.id;
    clearSent();
    // The parent may have opened the link meanwhile: read the list again before focus returns.
    if (id) focusWhenLoaded(id);
    void fetchAdmissions();
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (discardOpen) return;
    const url = editingAdmission ? `/api/admissions/${editingAdmission.id}` : "/api/admissions";
    const method = editingAdmission ? "PUT" : "POST";
    // The schema turns a blank field into `undefined`, which JSON.stringify would drop —
    // and a dropped key means "leave it as it is". Send every field, blank included,
    // so clearing a field in edit actually clears it.
    const payload = Object.fromEntries(
      Object.keys(EMPTY_ADMISSION_FORM).map((key) => [key, values[key as keyof typeof values] ?? ""]),
    );
    try {
      await sendJson(url, { method, body: payload }, "Gagal menyimpan pendaftaran. Periksa kolom yang ditandai.");
      toast.success(editingAdmission ? "Data diperbarui" : "Pendaftaran tercatat");
      closeForm({ reload: true });
      void fetchAdmissions();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan pendaftaran. Periksa kolom yang ditandai.");
    }
  });

  async function handleCancel() {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    try {
      await sendJson(`/api/admissions/${id}`, { method: "PUT", body: { status: "CANCELLED" } }, CANCEL_FALLBACK);
      toast.success("Pendaftaran dibatalkan");
      setCancelTarget(null);
      focusWhenLoaded(id);
      void fetchAdmissions();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : CANCEL_FALLBACK;
      toast.error(message);
      if (err instanceof ApiError && err.status === 409) {
        // The lead changed since the list was read (it became a student, or was cancelled already):
        // nothing to retry here, so close and show what it is now.
        focusWhenLoaded(id);
        void fetchAdmissions();
        return;
      }
      // 403, 429, a lost connection: keep the dialog open so staff can try again.
      throw err;
    }
  }

  function closeCancel() {
    const id = cancelTarget?.id;
    setCancelTarget(null);
    if (id) focusRow(id);
  }

  function openDialog() {
    setDiscardOpen(false);
    setEditingAdmission(null);
    form.reset(EMPTY_ADMISSION_FORM);
    setDialogOpen(true);
  }

  // Stable per the row-action edit handler that opens the dialog pre-filled.
  // `form.reset` is stable across renders (react-hook-form), as are the
  // `setState` setters, so this only changes identity if `form` itself does.
  const handleEditRow = useCallback((a: Admission) => {
    setDiscardOpen(false);
    setEditingAdmission(a);
    form.reset({
      parentName: a.parentName, parentRelationship: a.parentRelationship ?? "",
      parentPhone: a.parentPhone ?? "", parentWhatsapp: a.parentWhatsapp ?? "", parentEmail: a.parentEmail ?? "",
      childName: a.childName, dateOfBirth: a.dateOfBirth ?? "", childGender: a.childGender ?? "",
      programId: a.programId ?? "", notes: a.notes ?? "",
    });
    setDialogOpen(true);
  }, [form]);

  const handleCancelRequest = useCallback((a: Admission) => setCancelTarget(a), []);

  // Deep link `?edit=<admissionId>` (the formulir page's "Data kontak"): open that lead's dialog
  // once the rows are here, then drop the param so closing the dialog does not reopen it.
  // The caller adds `?search=<parent name>` so the lead is on the first page. If the first read
  // fails nothing is dropped, so a reload retries.
  const handledEdit = useRef<string | null>(null);
  useEffect(() => {
    if (!editId) {
      handledEdit.current = null;
      return;
    }
    if (loadedQuery !== query || handledEdit.current === editId) return;
    handledEdit.current = editId;
    const lead = data.find((row) => row.id === editId);
    if (canEdit) {
      if (lead && isLeadEditable(lead)) {
        // Opening the dialog is the response to the URL (an external system), not derived state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        handleEditRow(lead);
      } else {
        toast.error("Data kontak tidak bisa diubah: pertanyaan ini sudah jadi siswa atau dibatalkan, atau tidak ada di daftar.");
      }
    }
    // The link's `?search=` only put the lead on the first page; the dialog holds its own copy, so
    // the list goes back to unfiltered right away (a search staff typed themselves is never here:
    // `?edit=` only arrives with a navigation from the formulir page).
    updateQuery({ edit: null, search: null, page: null });
  }, [editId, loadedQuery, query, data, canEdit, handleEditRow, updateQuery]);

  // ------------------------------------------------------------------
  // Columns — module-level factory (components/admin/admissions/columns.tsx),
  // memoised here with stable useCallback handlers so a rebuild never remounts
  // row cells / closes an open row-action menu (lesson 6).
  // ------------------------------------------------------------------

  const columns = useMemo(
    () =>
      createAdmissionColumns({
        canEdit,
        onEdit: handleEditRow,
        onCancelRequest: handleCancelRequest,
        onSend: send,
        sendingIds,
      }),
    [canEdit, handleEditRow, handleCancelRequest, send, sendingIds],
  );

  const isFiltered = !!search || tahap !== "all" || unpaidOnly;
  const stat = (value: number | undefined) => (stats ? (value ?? 0) : "—");
  // A card is "on" when its filter is the only one applied (the counts ignore search).
  const only = (t: string, unpaid = false) => tahap === t && unpaidOnly === unpaid && !search;
  const statCards: StatCardSpec[] = [
    { label: "Total", value: stat(stats?.total), icon: Users, color: "primary", filter: "all", active: !isFiltered },
    { label: "Baru", value: stat(stats?.baru), icon: UserPlus, color: "primary", filter: "BARU", active: only("BARU") },
    { label: "Belum bayar", value: stat(stats?.belumBayar), icon: Wallet, color: "warning", filter: "unpaid", active: only("all", true) },
    { label: "Formulir masuk", value: stat(stats?.formulirMasuk), icon: ClipboardCheck, color: "success", filter: "FORMULIR_MASUK", active: only("FORMULIR_MASUK") },
  ];

  return (
    <>
      <PageHeader
        title="Pendaftaran"
        description="Dari pertanyaan pertama sampai jadi siswa."
        actions={
          canEdit ? <Button size="sm" onClick={openDialog}>
            <Plus size={14} className="mr-1.5" /> Catat Pertanyaan
          </Button> : undefined
        }
      />

      <StatsCardsRow cols={4}>
        {statCards.map((card, index) => (
          <StatFilter key={card.label} label={card.label} value={card.value} pressed={card.active} onPress={() => applyStat(card.active ? "all" : card.filter)}>
            <StatCard label={card.label} value={card.value} icon={card.icon} color={card.color} index={index} />
          </StatFilter>
        ))}
      </StatsCardsRow>

      <DataTableToolbar
        searchPlaceholder="Cari nama anak atau orang tua..."
        value={searchInput}
        onValueChange={setSearchInput}
        onSearchChange={commitSearch}
        hasExternalFilter={unpaidOnly}
        onReset={handleResetFilters}
        filters={[
          {
            key: "tahap",
            label: "Tahap",
            value: tahap,
            onChange: handleTahapChange,
            options: TAHAP_FILTER_OPTIONS,
          },
        ]}
        actions={
          <Toggle
            variant="outline"
            size="lg"
            pressed={unpaidOnly}
            onPressedChange={handleUnpaidChange}
            className="w-full sm:w-auto"
          >
            Belum bayar
          </Toggle>
        }
      />

      {/* Progress of a one-tap send: the button keeps its label, so this is what a screen reader hears. */}
      <p className="sr-only" aria-live="polite">
        {sendingIds
          .map((id) => data.find((row) => row.id === id))
          .filter((row): row is Admission => row !== undefined)
          .map((row) => `Mengirim formulir untuk ${rowLabel(row)}…`)
          .join(" ")}
      </p>

      {/* Heard after a filter or search changes; silent while the rows are loading. */}
      <p className="sr-only" role="status">
        {loading || loadError ? "" : `${pagination.total} pendaftaran`}
      </p>

      {loadError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
          <p>Gagal memuat data pendaftaran. Coba lagi.</p>
          {data.length > 0 && <p className="mt-1 text-muted-foreground">Daftar terakhir masih ditampilkan dan belum diperbarui.</p>}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void fetchAdmissions()}>Coba lagi</Button>
          </AlertDescription>
        </Alert>
      )}
      {(!loadError || data.length > 0) && <DataTable
        columns={columns}
        data={data}
        pagination={pagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        onSortChange={handleSortChange}
        defaultSort={{ field: "createdAt", order: "desc" }}
        loading={loading}
        isFiltered={isFiltered}
        emptyTitle={canEdit ? "Belum ada calon siswa. Catat pertanyaan pertama." : "Belum ada calon siswa."}
        emptyAction={canEdit ? { label: "Catat Pertanyaan", onClick: openDialog } : undefined}
      />}

      {/* Add/Edit lead — ResponsiveFormDialog owns the Dialog/Sheet breakpoint switch */}
      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!open) requestFormClose(); }}
        title={editingAdmission ? "Ubah data pertanyaan" : "Catat Pertanyaan Baru"}
        size="xl"
        footer={
          discardOpen ? <DiscardAdmissionFooter onKeep={keepDraft} onDiscard={() => closeForm()} /> : <FormDialogFooter
            formId={admissionFormId}
            pending={form.formState.isSubmitting}
            onCancel={requestFormClose}
            submitLabel={editingAdmission ? "Simpan Perubahan" : "Catat Pertanyaan"}
          />
        }
      >
        <form id={admissionFormId} onSubmit={handleSubmit} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          {editingAdmission?.detectedParent && (
            <SiblingDetectBanner detectedParent={editingAdmission.detectedParent} />
          )}
          <AdmissionFormBody control={form.control} programs={programs} />
        </form>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && closeCancel()}
        entityName={cancelTarget ? `pendaftaran ${admissionChildLabel(cancelTarget.childName)}` : ""}
        action="cancel"
        extraWarning={cancelTarget?.application?.fee?.status === "UNPAID" ? "Tautan pembayaran formulir yang belum dibayar ikut ditutup." : undefined}
        onConfirm={handleCancel}
      />

      <SendFormulirDialog
        result={formulirSent?.result ?? null}
        email={formulirSent?.admission.parentEmail}
        parentName={formulirSent?.admission.parentName ?? ""}
        childName={formulirSent?.admission.childName}
        resend={formulirSent?.resend ?? false}
        phone={formulirSent ? resolveFollowUpPhone({ admission: formulirSent.admission }) : null}
        onClose={closeSentCard}
      />
    </>
  );
}
