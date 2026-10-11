"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type CopyStatus = "copied" | "skipped_existing" | "missing" | "failed";
type DocumentsCopied = { ktpAyah?: CopyStatus; ktpIbu?: CopyStatus; kk?: CopyStatus };

const COPIED_LABELS: [keyof DocumentsCopied, string][] = [
  ["ktpAyah", "KTP Ayah"],
  ["ktpIbu", "KTP Ibu"],
  ["kk", "KK"],
];

/** Toast copy for the guardian-document copy that runs after convert. */
function copyOutcomeMessages(copied: DocumentsCopied | undefined) {
  if (!copied) return { copiedText: "", anyFailed: false };
  const done = COPIED_LABELS.filter(([k]) => copied[k] === "copied").map(([, l]) => l);
  return {
    copiedText: done.length > 0 ? ` ${done.join(", ")} disalin ke data wali.` : "",
    anyFailed: COPIED_LABELS.some(([k]) => copied[k] === "failed"),
  };
}

export default function EnrollmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  // Terima / Tolak are decisions the family feels — confirm before they fire.
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED" | null>(null);
  // "Ubah data" swaps the read-only body for the editor; "Tandai formulir masuk" confirms first.
  const [editing, setEditing] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  // Bumped when an action finishes, so focus lands somewhere sensible once the new view is rendered.
  const [focusReturn, setFocusReturn] = useState(0);

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

  // After leaving edit mode / marking submitted, focus returns to the action that opened it; when that
  // lives in the closed overflow menu, to the menu trigger; failing that, to the page heading.
  useEffect(() => {
    if (focusReturn === 0) return;
    const target =
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
    setFocusReturn((n) => n + 1);
  }

  async function markSubmitted() {
    setBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${id}/mark-submitted`, { method: "POST" });
      if (res.ok) {
        toast.success("Formulir ditandai masuk.");
        try {
          await load(false);
        } catch {
          // Keep the previous view; the toast already confirmed the change.
        }
        setFocusReturn((n) => n + 1);
        return;
      }
      const err = await readApiError(res, "Gagal menandai formulir masuk. Coba lagi.");
      if (res.status === 400) {
        // Data is missing: the API names each field; staff can fix it right here.
        const detail = err.fieldErrors.map((e) => e.message).join(" ");
        toast.error(detail || err.message, { action: { label: "Ubah data", onClick: () => setEditing(true) } });
      } else {
        toast.error(err.message);
        if (res.status === 409) void load(false);
      }
    } catch {
      toast.error("Gagal menandai formulir masuk. Periksa koneksi, lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    setBusy(true);
    let errorToasted = false;
    try {
      const res = await fetch(`/api/enrollments/${id}/convert`, { method: "POST" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          student?: { id?: string };
          documentsCopied?: DocumentsCopied;
        };
        const { copiedText, anyFailed } = copyOutcomeMessages(body.documentsCopied);
        const message = `Siswa berhasil dibuat dari formulir.${copiedText}`;
        const studentId = body.student?.id;
        if (studentId) {
          toast.success(message, {
            action: { label: "Lihat siswa", onClick: () => router.push(`/admin/students/${studentId}`) },
          });
        } else {
          toast.success(message);
        }
        if (anyFailed) {
          toast.warning("Sebagian berkas gagal disalin ke data wali. Unggah manual dari halaman wali.");
        }
        void load();
        return;
      }

      const jr = (await res.json()) as { error?: string };
      errorToasted = true;
      toast.error(jr.error || "Gagal konversi");
      throw new Error("Enrollment conversion failed");
    } catch (error) {
      if (!errorToasted) {
        toast.error("Gagal mengonversi formulir. Coba lagi.");
      }
      throw error instanceof Error
        ? error
        : new Error("Enrollment conversion failed");
    } finally {
      setBusy(false);
    }
  }

  async function transition(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/enrollments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success("Status diperbarui");
        void load();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Gagal memperbarui status");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <DetailPageSkeleton />;
  if (!d)
    return (
      <EmptyState
        title="Formulir tidak ditemukan"
        description="Formulir pendaftaran ini tidak tersedia atau telah dihapus."
        actionLabel="Kembali ke Daftar Formulir Pendaftaran"
        actionHref="/admin/enrollments"
      />
    );

  // SUBMITTED has 3 transitions — over the header's 2-visible cap. "Mulai
  // Tinjau" is the preliminary step (move into review before deciding), so
  // it goes to the overflow menu; the two actual decisions (Terima / Tolak)
  // stay visible, same as they already are in UNDER_REVIEW.
  //
  // ACCEPTED leads with the filled "Konversi ke Siswa" (the one next step),
  // which opens the confirm instead of changing status.
  type Transition = {
    label: string;
    to?: string;
    variant?: "default" | "outline";
    menu?: boolean;
    convert?: boolean;
    decide?: boolean;
  };
  const transitions: Record<string, Transition[]> = {
    SUBMITTED: [
      { label: "Mulai Tinjau", to: "UNDER_REVIEW", variant: "outline", menu: true },
      { label: "Terima", to: "ACCEPTED", decide: true },
      { label: "Tolak", to: "REJECTED", variant: "outline", decide: true },
    ],
    UNDER_REVIEW: [
      { label: "Terima", to: "ACCEPTED", decide: true },
      { label: "Tolak", to: "REJECTED", variant: "outline", decide: true },
    ],
    ACCEPTED: [
      { label: "Konversi ke Siswa", variant: "default", convert: true },
      { label: "Kembali ke Tinjau", to: "UNDER_REVIEW", variant: "outline" },
    ],
    REJECTED: [{ label: "Tinjau Ulang", to: "UNDER_REVIEW", variant: "outline" }],
  };
  const actions = d.studentId || !d.canEdit ? [] : (transitions[d.status] ?? []);
  const toAction = (a: (typeof actions)[number]): DetailPageHeaderAction => ({
    label: a.label,
    onClick: a.convert
      ? () => setConvertOpen(true)
      : a.decide
        ? () => setDecision(a.to as "ACCEPTED" | "REJECTED")
        : () => transition(a.to!),
    disabled: busy,
    variant: a.variant,
  });
  const primaryEnrollmentActions = actions.filter((a) => !a.menu).map(toAction);
  const menuEnrollmentActions = actions.filter((a) => a.menu).map(toAction);

  // Staff correction tools: only with admissions.edit, never once the student exists.
  const canChange = d.canEdit && !d.studentId;
  const isEditing = editing && canChange;
  const editAction: DetailPageHeaderAction = {
    label: "Ubah data",
    onClick: () => setEditing(true),
    disabled: busy,
    // Before the formulir is in, correcting the data is the natural first step.
    variant: d.status === "INVITED" ? "default" : "outline",
    testId: "enrollment-edit-action",
  };
  const markAction: DetailPageHeaderAction = {
    label: "Tandai formulir masuk",
    onClick: () => setMarkOpen(true),
    disabled: busy,
    variant: "outline",
  };
  if (canChange) {
    // The header shows at most two buttons: a full header keeps these in the overflow menu.
    for (const a of d.status === "INVITED" ? [editAction, markAction] : [editAction]) {
      if (primaryEnrollmentActions.length < 2) primaryEnrollmentActions.push(a);
      else menuEnrollmentActions.push(a);
    }
  }

  return (
    <>
      <DetailPageHeader
        backHref="/admin/enrollments"
        backLabel="Kembali ke Daftar Formulir Pendaftaran"
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
        open={decision !== null}
        onOpenChange={(o) => !o && setDecision(null)}
        title={
          decision === "REJECTED"
            ? `Tolak pendaftaran ${d.childName || "anak ini"}?`
            : `Terima pendaftaran ${d.childName || "anak ini"}?`
        }
        description={
          decision === "REJECTED"
            ? "Pastikan keluarga diberi tahu bahwa pendaftaran ini tidak dilanjutkan. Kamu masih bisa meninjau ulang formulirnya nanti."
            : "Keluarga bisa melanjutkan ke tahap berikutnya, dan formulir ini siap dikonversi menjadi data siswa."
        }
        confirmLabel={decision === "REJECTED" ? "Tolak" : "Terima"}
        destructive={decision === "REJECTED"}
        loading={busy}
        onConfirm={() => (decision ? transition(decision) : undefined)}
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
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Konversi menjadi siswa?"
        description={
          d.fee?.status === "UNPAID"
            ? `Biaya pendaftaran ${formatRupiah(d.fee.amount)} belum dibayar. Siswa tetap bisa dibuat, tetapi pembayarannya masih perlu ditindaklanjuti. Tindakan ini membuat data siswa dan data orang tua dari formulir pendaftaran ini.`
            : "Tindakan ini membuat data siswa dan data orang tua dari formulir pendaftaran ini."
        }
        confirmLabel="Konversi ke Siswa"
        loading={busy}
        onConfirm={convert}
      />
    </>
  );
}
