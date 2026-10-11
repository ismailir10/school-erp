"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "../status-chip";
import { EnrollmentApplicationView } from "@/components/admin/enrollment-application-view";
import { EnrollmentApplicationEditor, type EditorDoneReason } from "@/components/admin/enrollment-application-editor";
import { ConvertDuplicateConfirm, ConvertGuardianConfirm } from "@/components/admin/enrollment-convert-confirm";
import { toastMissingData, useEnrollmentConvert } from "@/components/admin/use-enrollment-convert";
import { EnrollmentDocumentsCard } from "@/components/admin/enrollment-documents-card";
import { EnrollmentFeeCard } from "@/components/admin/enrollment-fee-card";
import type { AdminDocuments } from "@/lib/enrollment/documents";
import type { AdminFeeView, FeeAttention } from "@/lib/enrollment/fee-admin-view";
import { formatRupiah } from "@/lib/format";
import { readApiError } from "@/lib/api/client-errors";

type Detail = {
  id: string;
  canEdit: boolean;
  status: string;
  studentId: string | null;
  childName: string;
  parentEmail: string | null;
  dcareAddon: boolean;
  submittedAt: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  studentData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ayahData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ibuData: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  consentData: any;
  /** Redacted by the API: file presence + names, never storage tokens. */
  documents?: AdminDocuments;
  program: { id: string; name: string } | null;
  admission: { id: string; parentName: string; parentPhone: string | null } | null;
  /** Pendaftaran fee; null when the program has none. */
  fee?: AdminFeeView | null;
  followUp?: { formUrl: string; canRemind: boolean } | null;
  /** Payments the processor refused to credit ("perlu dicek"). */
  feeProblems?: FeeAttention[];
  feePermissions?: { recordPayment: boolean; adjust: boolean };
};

/** Stages the convert route accepts from the "Terima & Jadikan Siswa" button (UNDER_REVIEW is legacy data). */
const ACCEPT_STAGES = new Set(["SUBMITTED", "UNDER_REVIEW", "ACCEPTED"]);

export default function EnrollmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  // Tolak is a decision the family feels — confirm before it fires.
  const [rejectOpen, setRejectOpen] = useState(false);
  // "Ubah data" swaps the read-only body for the editor; "Tandai formulir masuk" confirms first.
  const [editing, setEditing] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  // Bumped when an action finishes, so focus lands somewhere sensible once the new view is rendered.
  const [focusReturn, setFocusReturn] = useState(0);
  const focusPrefer = useRef<string | null>(null);
  const returnFocus = (testId?: string) => {
    focusPrefer.current = testId ?? null;
    setFocusReturn((n) => n + 1);
  };

  // `showSkeleton` is off for refreshes after an action, so the page does not
  // flash to a skeleton and lose the staff member's place.
  const load = useCallback(async (showSkeleton = true) => {
    if (showSkeleton) setLoading(true);
    try {
      const res = await fetch(`/api/enrollments/${id}`);
      if (res.ok) setD(await res.json());
      else setD(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const convertFlow = useEnrollmentConvert({ id, load, openEditor: () => setEditing(true), returnFocus });

  // After leaving edit mode / marking submitted, focus returns to the action that opened it; when that
  // lives in the closed overflow menu, to the menu trigger; failing that, to the page heading.
  useEffect(() => {
    if (focusReturn === 0) return;
    const preferred = focusPrefer.current
      ? document.querySelector<HTMLElement>(`[data-testid="${focusPrefer.current}"]`)
      : null;
    const target =
      preferred ??
      document.querySelector<HTMLElement>('[data-testid="enrollment-edit-action"]') ??
      document.querySelector<HTMLElement>('button[aria-label="Aksi lainnya"]') ??
      document.querySelector<HTMLElement>("h1");
    if (target && !target.hasAttribute("tabindex") && target.tagName === "H1") target.tabIndex = -1;
    target?.focus();
  }, [focusReturn]);

  async function editorDone(reason: EditorDoneReason) {
    // Saved or locked: show what the server now holds before leaving edit mode.
    if (reason !== "cancelled") {
      try {
        await load(false);
      } catch {
        // The view keeps the previous data; the success / error toast already told the story.
      }
    }
    setEditing(false);
    returnFocus();
  }

  async function markSubmitted() {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${id}/mark-submitted`, { method: "POST" });
      if (res.ok) {
        toast.success("Formulir ditandai masuk.");
        try {
          await load(false);
        } catch {
          // Keep the previous view; the toast already confirmed the change.
        }
        returnFocus();
        return;
      }
      const err = await readApiError(res, "Gagal menandai formulir masuk. Coba lagi.");
      if (res.status === 400) {
        // Data is missing: the API names each field; staff can fix it right here.
        toastMissingData(err.message, err.fieldErrors, () => setEditing(true));
      } else {
        toast.error(err.message);
        if (res.status === 409) void load(false);
      }
    } catch {
      toast.error("Gagal menandai formulir masuk. Periksa koneksi, lalu coba lagi.");
    } finally {
      setActionBusy(false);
    }
  }

  async function transition(status: "REJECTED" | "SUBMITTED") {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(status === "REJECTED" ? "Pendaftaran ditolak." : "Pendaftaran dibuka lagi.");
        try {
          await load(false);
        } catch {
          // Keep the previous view; the toast already confirmed the change.
        }
        returnFocus();
      } else {
        const err = await readApiError(res, "Gagal memperbarui status. Coba lagi.");
        toast.error(err.message);
      }
    } catch {
      toast.error("Gagal memperbarui status. Periksa koneksi, lalu coba lagi.");
    } finally {
      setActionBusy(false);
    }
  }

  // One lock for every header action and dialog while any request is in flight.
  const busy = actionBusy || convertFlow.busy;

  if (loading) return <DetailPageSkeleton />;
  if (!d)
    return (
      <EmptyState
        title="Formulir tidak ditemukan"
        description="Formulir pendaftaran ini tidak tersedia atau telah dihapus."
        actionLabel="Kembali ke Daftar Pendaftaran"
        actionHref="/admin/admissions"
      />
    );

  // Staff tools: only with admissions.edit, never once the student exists. The header shows at
  // most two buttons, so the stage's one next step leads and the rest wait in the overflow menu.
  //   INVITED            Ubah data, Tandai formulir masuk   | Jadikan siswa
  //   SUBMITTED/ACCEPTED Terima & Jadikan Siswa             | Ubah data, Tolak
  //   REJECTED           (nothing visible)                  | Buka lagi, Ubah data
  const canChange = d.canEdit && !d.studentId;
  const isEditing = editing && canChange;
  const invited = d.status === "INVITED";
  const editAction: DetailPageHeaderAction = {
    label: "Ubah data",
    onClick: () => setEditing(true),
    disabled: busy,
    // Before the formulir is in, correcting the data is the natural first step.
    variant: invited ? "default" : "outline",
    testId: "enrollment-edit-action",
  };
  const markAction: DetailPageHeaderAction = {
    label: "Tandai formulir masuk",
    onClick: () => setMarkOpen(true),
    disabled: busy,
    variant: "outline",
  };
  const acceptAction: DetailPageHeaderAction = {
    label: "Terima & Jadikan Siswa",
    onClick: () => convertFlow.setConfirmOpen(true),
    disabled: busy,
    variant: "default",
    testId: "enrollment-primary-action",
  };
  const directConvertAction: DetailPageHeaderAction = {
    label: "Jadikan siswa",
    onClick: () => convertFlow.setConfirmOpen(true),
    disabled: busy,
    testId: "enrollment-primary-action",
  };
  const rejectAction: DetailPageHeaderAction = {
    label: "Tolak",
    onClick: () => setRejectOpen(true),
    disabled: busy,
    destructive: true,
  };
  const reopenAction: DetailPageHeaderAction = {
    label: "Buka lagi",
    onClick: () => void transition("SUBMITTED"),
    disabled: busy,
  };
  // The lead's own contact fields (parent phone, WhatsApp, email, catatan) are edited in the
  // Pendaftaran list's dialog; the search puts this lead on its first page.
  const contactAction: DetailPageHeaderAction | null = d.admission
    ? {
        label: "Data kontak",
        href: `/admin/admissions?edit=${encodeURIComponent(d.admission.id)}&search=${encodeURIComponent(d.admission.parentName)}`,
        disabled: busy,
      }
    : null;
  let primaryEnrollmentActions: DetailPageHeaderAction[] = [];
  const menuEnrollmentActions: DetailPageHeaderAction[] = [];
  if (canChange) {
    if (invited) {
      primaryEnrollmentActions = [editAction, markAction];
      menuEnrollmentActions.push(directConvertAction);
    } else if (ACCEPT_STAGES.has(d.status)) {
      primaryEnrollmentActions = [acceptAction];
      menuEnrollmentActions.push(editAction, rejectAction);
    } else if (d.status === "REJECTED") {
      menuEnrollmentActions.push(reopenAction, editAction);
    } else {
      menuEnrollmentActions.push(editAction);
    }
    if (contactAction) menuEnrollmentActions.push(contactAction);
    // Defensive: a header never carries more than two visible buttons.
    menuEnrollmentActions.unshift(...primaryEnrollmentActions.splice(2));
  }

  return (
    <>
      <DetailPageHeader
        backHref="/admin/admissions"
        backLabel="Kembali ke Daftar Pendaftaran"
        title={d.childName || "Tanpa nama"}
        description={`${d.program?.name ?? "—"}${d.dcareAddon ? " + Dcare" : ""}`}
        badge={<StatusChip status={d.status} studentId={d.studentId} />}
        primaryActions={isEditing ? [] : primaryEnrollmentActions}
        menuActions={isEditing ? [] : menuEnrollmentActions}
      />

      <div className="space-y-section">
        {/* Money first: an unpaid fee is the thing staff chase. */}
        {d.fee && (
          <EnrollmentFeeCard
            applicationId={id}
            childName={d.childName}
            fee={d.fee}
            followUp={d.followUp ?? null}
            problems={d.feeProblems ?? []}
            canEdit={d.canEdit}
            permissions={d.feePermissions ?? { recordPayment: false, adjust: false }}
            onChange={() => void load(false)}
          />
        )}

        {/* Actionable for staff, so it sits right under the header. */}
        <EnrollmentDocumentsCard
          applicationId={id}
          documents={d.documents ?? {}}
          canEdit={d.canEdit}
        />

        {isEditing ? (
          <EnrollmentApplicationEditor
            application={{
              id,
              studentData: d.studentData,
              ayahData: d.ayahData,
              ibuData: d.ibuData,
              consentData: d.consentData,
              program: d.program,
              dcareAddon: d.dcareAddon,
              fee: d.fee ?? null,
              canAdjustFee: d.feePermissions?.adjust ?? false,
            }}
            onDone={editorDone}
          />
        ) : (
          <EnrollmentApplicationView
            application={{
              id,
              studentData: d.studentData,
              ayahData: d.ayahData,
              ibuData: d.ibuData,
              consentData: d.consentData,
            }}
          />
        )}

        {d.studentId && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-status-present-text">
                Formulir ini sudah dikonversi menjadi data siswa.
              </p>
              <Button variant="outline" size="sm" render={<Link href={`/admin/students/${d.studentId}`} />}>
                Lihat siswa
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Tolak pendaftaran ${d.childName || "anak ini"}?`}
        description='Pastikan keluarga diberi tahu bahwa pendaftaran ini tidak dilanjutkan. Formulirnya tetap tersimpan dan bisa dibuka lagi lewat "Aksi lainnya".'
        confirmLabel="Tolak"
        destructive
        loading={busy}
        onConfirm={() => transition("REJECTED")}
      />

      <ConfirmDialog
        open={markOpen}
        onOpenChange={setMarkOpen}
        title={`Tandai formulir ${d.childName || "anak ini"} sudah masuk?`}
        description='Orang tua tidak perlu mengisi lagi. Persetujuan dicatat sebagai "disetujui langsung di sekolah" atas nama Anda.'
        confirmLabel="Tandai masuk"
        loading={busy}
        onConfirm={markSubmitted}
      />

      <ConfirmDialog
        open={convertFlow.confirmOpen}
        onOpenChange={convertFlow.setConfirmOpen}
        title={invited ? `Jadikan ${d.childName || "anak ini"} siswa?` : `Terima ${d.childName || "anak ini"} dan jadikan siswa?`}
        description={
          (d.fee?.status === "UNPAID"
            ? `Biaya pendaftaran ${formatRupiah(d.fee.amount)} belum dibayar. Siswa tetap bisa dibuat, tetapi pembayarannya masih perlu ditindaklanjuti. Tindakan ini membuat data siswa dan data orang tua dari formulir pendaftaran ini.`
            : "Tindakan ini membuat data siswa dan data orang tua dari formulir pendaftaran ini.") +
          (invited ? " Orang tua belum mengirim formulir, jadi data yang tersimpan sekarang yang dipakai." : "")
        }
        confirmLabel={invited ? "Jadikan siswa" : "Terima & Jadikan Siswa"}
        loading={busy}
        onConfirm={convertFlow.convert}
      />

      <ConvertDuplicateConfirm
        candidates={convertFlow.prompt?.kind === "duplicate" ? convertFlow.prompt.candidates : null}
        childName={d.childName}
        onConfirm={() => convertFlow.answer("confirmDuplicate")}
        onOpenChange={(o) => !o && convertFlow.closePrompt("duplicate")}
      />

      <ConvertGuardianConfirm
        guardians={convertFlow.prompt?.kind === "guardians" ? convertFlow.prompt.guardians : null}
        onConfirm={() => convertFlow.answer("confirmGuardians")}
        onOpenChange={(o) => !o && convertFlow.closePrompt("guardians")}
      />
    </>
  );
}
