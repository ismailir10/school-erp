"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { DataTable } from "@/components/ui/data-table";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { FormDialogFooter, FormRootError } from "@/components/ui/form";
import { StatCard } from "@/components/admin/stat-card";
import { StatsCardsRow } from "@/components/admin/stats-cards-row";
import { AdminLinkTabs } from "@/components/admin/admin-tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeactivateConfirmDialog } from "@/components/admin/deactivate-confirm-dialog";
import { Plus, Users, PhoneCall, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { createAdmissionSchema } from "@/lib/validations/admission";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  AdmissionFormBody,
  EMPTY_ADMISSION_FORM,
  type AdmissionFormValues,
} from "@/components/admin/admissions/admission-form-body";
import { SiblingDetectBanner } from "@/components/admin/admissions/sibling-detect-banner";
import {
  AdmissionConvertDialog,
  type EmailConflict,
} from "@/components/admin/admissions/convert-dialog";
import { createAdmissionColumns } from "@/components/admin/admissions/columns";
import {
  AdmissionDuplicateDialog,
  type PossibleDuplicate,
} from "@/components/admin/admissions/duplicate-dialog";
import { NEXT_STATUS, ADMISSION_STATUS_LABELS } from "@/components/admin/admissions/constants";
import type { Admission, Program, Campus } from "@/components/admin/admissions/types";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

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
// Page (owns list state, fetching, stats, dialogs' open state + handlers;
// columns + form body + convert dialog live in components/admin/admissions/*)
// ------------------------------------------------------------------

export default function AdmissionsPage() {
  const [data, setData] = useState<Admission[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const listRequestId = useRef(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [stats, setStats] = useState({ total: 0, inquiry: 0, admitted: 0 });
  const [canEdit, setCanEdit] = useState(false);

  // FIND-011: stat-cards were a one-shot useEffect on mount, so creating /
  // converting / cancelling an admission left the KPI cards stale until the
  // admin reloaded. Extract into a callable so every mutation handler can
  // call it alongside `fetchAdmissions()`.
  const fetchStats = useCallback(() => {
    // Total Calon must include every status — previously summed only
    // INQUIRY + ADMITTED, so a Pertanyaan→Kunjungan transition silently
    // dropped the total by 1 (Finding F-3). Fetch an unfiltered count plus
    // the two visible buckets in parallel.
    Promise.all([
      fetch("/api/admissions?pageSize=1").then(r => r.json()),
      fetch("/api/admissions?pageSize=1&status=INQUIRY").then(r => r.json()),
      fetch("/api/admissions?pageSize=1&status=ADMITTED").then(r => r.json()),
    ]).then(([all, inquiry, admitted]) => {
      const t = all.pagination?.total ?? 0;
      const i = inquiry.pagination?.total ?? 0;
      const a = admitted.pagination?.total ?? 0;
      setStats({ total: t, inquiry: i, admitted: a });
    }).catch((err) => console.error("[admissions] stats fetch failed", err));
  }, []);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmission, setEditingAdmission] = useState<Admission | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Admission | null>(null);
  // "Terima" (→ ADMITTED) is the one pipeline step that commits the family; confirm it.
  const [admitTarget, setAdmitTarget] = useState<Admission | null>(null);
  // T10: convert-confirm + email-conflict UI state.
  const [convertTarget, setConvertTarget] = useState<Admission | null>(null);
  const [emailConflict, setEmailConflict] = useState<EmailConflict | null>(null);
  // R2-ADMIN-1: convert answered 409 POSSIBLE_DUPLICATE — ask before adding a second record.
  const [duplicate, setDuplicate] = useState<PossibleDuplicate | null>(null);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const admissionFormId = useId();
  const form = useZodForm(createAdmissionSchema, { defaultValues: EMPTY_ADMISSION_FORM });
  const dirty = form.formState.isDirty;
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftFocus = useRef<HTMLElement | null>(null);

  function keepDraft() {
    setDiscardOpen(false);
    // Restore after the popup's focus manager handles the removed footer.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (draftFocus.current?.isConnected) draftFocus.current.focus();
      else document.getElementById(admissionFormId)?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    }));
  }

  function closeForm() {
    setDiscardOpen(false);
    setDialogOpen(false);
    setEditingAdmission(null);
    form.reset(EMPTY_ADMISSION_FORM);
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

  // Fetch programs + campuses once. Campuses cached for 1 h server-side
  // (revalidate=3600 in /api/config/campuses) so this is cheap on repeat opens.
  useEffect(() => {
    fetch("/api/programs")
      .then((r) => r.json())
      .then((p) => setPrograms(Array.isArray(p) ? p : p.data ?? []))
      .catch((err) => console.error("[admissions] programs fetch failed", err));
    fetch("/api/config/campuses")
      .then((r) => r.json())
      .then((c) => setCampuses(Array.isArray(c) ? c : []))
      .catch((err) => console.error("[admissions] campuses fetch failed", err));
  }, []);

  const fetchAdmissions = useCallback(async () => {
    const requestId = ++listRequestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortOrder,
      });
      if (search) params.set("search", search);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/admissions?${params}`);
      if (!res.ok) throw new Error("Admissions read failed");
      const json = await res.json();
      if (requestId !== listRequestId.current) return;
      setData(json.data ?? []);
      setCanEdit(json.canEdit === true);
      if (json.pagination) setPagination(json.pagination);
    } catch {
      if (requestId === listRequestId.current) setLoadError(true);
    } finally {
      if (requestId === listRequestId.current) setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchAdmissions();
    return () => { listRequestId.current += 1; };
  }, [fetchAdmissions]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
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

  // T10: when an admission has a sibling-detect match, intercept Convert with
  // a confirmation dialog (state below). For admissions without detection the
  // direct path runs unchanged. The runConvert helper does the actual POST so
  // both call sites + the dialog confirm action route through one place.
  const runConvert = useCallback(async (
    admissionId: string,
    mergeWithDetected: boolean,
    confirmDuplicate = false,
    childName = "",
  ) => {
    const res = await fetch(`/api/admissions/${admissionId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mergeWithDetected, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) }),
    });
    if (res.ok) {
      toast.success(
        mergeWithDetected ? "Dikonversi menjadi siswa" : "Dikonversi tanpa menggabungkan",
      );
      setConvertTarget(null);
      setEmailConflict(null);
      setDuplicate(null);
      fetchAdmissions();
      fetchStats();
      return;
    }
    if (res.status === 409) {
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        conflictingParentName?: string;
        message?: string;
        existingStudents?: PossibleDuplicate["existingStudents"];
        existingParent?: PossibleDuplicate["existingParent"];
      };
      if (d.error === "POSSIBLE_DUPLICATE") {
        setConvertTarget(null);
        setDuplicate({
          admissionId,
          childName,
          mergeWithDetected,
          existingStudents: d.existingStudents ?? [],
          existingParent: d.existingParent ?? null,
        });
        return;
      }
      if (d.error === "EMAIL_CONFLICT") {
        setEmailConflict({
          message:
            d.message ??
            "Email orang tua sudah terdaftar. Pilih Gabungkan atau hapus email pendaftaran.",
          conflictingParentName: d.conflictingParentName ?? null,
        });
        return;
      }
    }
    const d = await res.json().catch(() => ({}));
    toast.error(d.error || "Gagal mengonversi pendaftaran. Coba lagi.");
  }, [fetchAdmissions, fetchStats]);

  const confirmDuplicateConvert = useCallback(async (dup: PossibleDuplicate) => {
    setDuplicatePending(true);
    try {
      await runConvert(dup.admissionId, dup.mergeWithDetected, true, dup.childName);
    } finally {
      setDuplicatePending(false);
    }
  }, [runConvert]);

  // Cycle A: "Kirim Formulir" — invite the parent to complete the rich
  // enrollment application. Creates/refreshes the EnrollmentApplication +
  // emails the tokenized link. 422 NO_EMAIL when the inquiry lacks an email;
  // 409 when the form is already filled/processed.
  const sendEnrollmentForm = useCallback(async (a: Admission) => {
    const res = await fetch("/api/enrollments/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admissionId: a.id }),
    });
    if (res.ok) {
      const d = (await res.json().catch(() => ({}))) as { sent?: boolean; formUrl?: string };
      toast.success(
        d.sent
          ? "Formulir pendaftaran dikirim ke email orang tua"
          : "Formulir disiapkan (email tidak terkirim — bagikan tautan manual)",
        d.formUrl
          ? {
              description: "Salin tautan untuk dibagikan via WhatsApp",
              action: { label: "Salin tautan", onClick: () => void navigator.clipboard?.writeText(d.formUrl!) },
            }
          : undefined,
      );
      return;
    }
    const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    toast.error(d.message || d.error || "Gagal mengirim formulir");
  }, []);

  const convertToStudent = useCallback((a: Admission) => {
    if (a.detectedParentId) {
      setConvertTarget(a);
      setEmailConflict(null);
      return;
    }
    // No detection → preserve the pre-T10 one-click behaviour (auto-merge).
    void runConvert(a.id, true, false, a.childName);
  }, [runConvert]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (discardOpen) return;
    const url = editingAdmission ? `/api/admissions/${editingAdmission.id}` : "/api/admissions";
    const method = editingAdmission ? "PUT" : "POST";
    try {
      await sendJson(url, { method, body: values }, "Gagal menyimpan pendaftaran. Periksa kolom yang ditandai.");
      toast.success(editingAdmission ? "Data diperbarui" : "Pendaftaran tercatat");
      closeForm();
      fetchAdmissions(); fetchStats();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan pendaftaran. Periksa kolom yang ditandai.");
    }
  });

  const advanceStatus = useCallback(async (a: Admission) => {
    const next = NEXT_STATUS[a.status];
    if (!next) return;
    const res = await fetch(`/api/admissions/${a.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next.status }),
    });
    if (res.ok) {
      toast.success(`Status diubah ke ${ADMISSION_STATUS_LABELS[next.status] ?? next.status}`);
      fetchAdmissions(); fetchStats();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error || "Gagal mengubah status");
    }
  }, [fetchAdmissions, fetchStats]);

  const requestAdvance = useCallback((a: Admission) => {
    if (NEXT_STATUS[a.status]?.status === "ADMITTED") setAdmitTarget(a);
    else void advanceStatus(a);
  }, [advanceStatus]);

  async function handleCancel() {
    if (!cancelTarget) return;
    const res = await fetch(`/api/admissions/${cancelTarget.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    if (res.ok) { toast.success("Pendaftaran dibatalkan"); setCancelTarget(null); fetchAdmissions(); fetchStats(); }
    else toast.error("Gagal membatalkan");
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
      childName: a.childName, dateOfBirth: a.dateOfBirth ?? "", childGender: a.childGender ?? "",
      parentName: a.parentName, parentPhone: a.parentPhone ?? "", parentWhatsapp: a.parentWhatsapp ?? "",
      parentEmail: a.parentEmail ?? "", parentEducation: a.parentEducation ?? "",
      parentOccupation: a.parentOccupation ?? "",
      parentIncome: a.parentIncome ?? "",
      parentRelationship: a.parentRelationship ?? "",
      programId: a.programId ?? "",
      campusPreference: a.campusPreference ?? "",
      source: a.source as AdmissionFormValues["source"], notes: a.notes ?? "", followUpDate: a.followUpDate ?? "",
    });
    setDialogOpen(true);
  }, [form]);

  const handleCancelRequest = useCallback((a: Admission) => setCancelTarget(a), []);

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
        onAdvanceStatus: requestAdvance,
        onConvertToStudent: convertToStudent,
        onSendEnrollmentForm: sendEnrollmentForm,
      }),
    [canEdit, handleEditRow, handleCancelRequest, requestAdvance, convertToStudent, sendEnrollmentForm],
  );

  return (
    <>
      <PageHeader
        title="Pendaftaran"
        description="Calon siswa yang bertanya atau mendaftar."
        actions={
          canEdit ? <Button size="sm" onClick={openDialog}>
            <Plus size={14} className="mr-1.5" /> Catat Pertanyaan
          </Button> : undefined
        }
      />

      <AdminLinkTabs
        className="mb-4"
        items={[
          { href: "/admin/admissions", label: "Calon Siswa" },
          { href: "/admin/enrollments", label: "Formulir" },
        ]}
      />

      <StatsCardsRow cols={3}>
        <StatCard label="Total Calon" value={stats.total} icon={Users} color="primary" index={0} />
        <StatCard label={ADMISSION_STATUS_LABELS.INQUIRY} value={stats.inquiry} icon={PhoneCall} color="warning" index={1} />
        <StatCard label={ADMISSION_STATUS_LABELS.ADMITTED} value={stats.admitted} icon={CheckCircle} color="success" index={2} />
      </StatsCardsRow>

      <DataTableToolbar
        searchPlaceholder="Cari nama anak atau orang tua..."
        onSearchChange={handleSearchChange}
        filters={[
          {
            key: "status",
            label: "Status",
            value: statusFilter,
            onChange: (v) => {
              setStatusFilter(v);
              setPagination((p) => ({ ...p, page: 1 }));
            },
            options: [
              { value: "all", label: "Semua Status" },
              ...Object.entries(ADMISSION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
      />

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
        isFiltered={!!search.trim() || statusFilter !== "all"}
        emptyTitle="Tidak ada pendaftaran"
        emptyDescription="Catat pertanyaan baru ketika orang tua menghubungi sekolah"
      />}

      {/* Add/Edit Admission — ResponsiveFormDialog owns the Dialog/Sheet breakpoint switch */}
      <ResponsiveFormDialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!open) requestFormClose(); }}
        title={editingAdmission ? "Edit Pendaftaran" : "Catat Pertanyaan Baru"}
        size="xl"
        footer={
          discardOpen ? <DiscardAdmissionFooter onKeep={keepDraft} onDiscard={closeForm} /> : <FormDialogFooter
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
          <AdmissionFormBody control={form.control} programs={programs} campuses={campuses} />
        </form>
      </ResponsiveFormDialog>

      <DeactivateConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        entityName={cancelTarget ? `pendaftaran ${cancelTarget.childName}` : ""}
        action="cancel"
        onConfirm={handleCancel}
      />

      <ConfirmDialog
        open={!!admitTarget}
        onOpenChange={(o) => !o && setAdmitTarget(null)}
        title={`Terima pendaftaran ${admitTarget?.childName ?? "anak ini"}?`}
        description="Keluarga bisa melanjutkan ke tahap berikutnya, dan pendaftaran ini siap dikonversi menjadi data siswa."
        confirmLabel="Terima"
        onConfirm={async () => {
          if (admitTarget) await advanceStatus(admitTarget);
        }}
      />

      <AdmissionConvertDialog
        convertTarget={convertTarget}
        emailConflict={emailConflict}
        onClose={() => {
          setConvertTarget(null);
          setEmailConflict(null);
        }}
        onConvert={(admissionId, mergeWithDetected) =>
          void runConvert(admissionId, mergeWithDetected, false, convertTarget?.childName)
        }
      />

      <AdmissionDuplicateDialog
        duplicate={duplicate}
        pending={duplicatePending}
        onClose={() => setDuplicate(null)}
        onConfirm={(dup) => void confirmDuplicateConvert(dup)}
      />
    </>
  );
}
