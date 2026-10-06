"use client";

import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusChip } from "../status-chip";
import { EnrollmentApplicationView } from "@/components/admin/enrollment-application-view";
import { EnrollmentDocumentsCard } from "@/components/admin/enrollment-documents-card";
import type { AdminDocuments } from "@/lib/enrollment/documents";

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
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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

  async function convert() {
    setBusy(true);
    let errorToasted = false;
    try {
      const res = await fetch(`/api/enrollments/${id}/convert`, { method: "POST" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { documentsCopied?: DocumentsCopied };
        const { copiedText, anyFailed } = copyOutcomeMessages(body.documentsCopied);
        toast.success(`Siswa berhasil dibuat dari formulir.${copiedText}`);
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
  const transitions: Record<string, { label: string; to: string; variant?: "outline"; menu?: boolean }[]> = {
    SUBMITTED: [
      { label: "Mulai Tinjau", to: "UNDER_REVIEW", variant: "outline", menu: true },
      { label: "Terima", to: "ACCEPTED" },
      { label: "Tolak", to: "REJECTED", variant: "outline" },
    ],
    UNDER_REVIEW: [
      { label: "Terima", to: "ACCEPTED" },
      { label: "Tolak", to: "REJECTED", variant: "outline" },
    ],
    ACCEPTED: [{ label: "Kembali ke Tinjau", to: "UNDER_REVIEW", variant: "outline" }],
    REJECTED: [{ label: "Tinjau Ulang", to: "UNDER_REVIEW", variant: "outline" }],
  };
  const actions = d.studentId || !d.canEdit ? [] : (transitions[d.status] ?? []);
  const toAction = (a: (typeof actions)[number]): DetailPageHeaderAction => ({
    label: a.label,
    onClick: () => transition(a.to),
    disabled: busy,
  });
  const primaryEnrollmentActions = actions.filter((a) => !a.menu).map(toAction);
  const menuEnrollmentActions = actions.filter((a) => a.menu).map(toAction);

  return (
    <>
      <DetailPageHeader
        backHref="/admin/enrollments"
        backLabel="Kembali ke Daftar Formulir Pendaftaran"
        title={d.childName || "Tanpa nama"}
        description={`${d.program?.name ?? "—"}${d.dcareAddon ? " + Dcare" : ""}`}
        badge={<StatusChip status={d.status} studentId={d.studentId} />}
        primaryActions={primaryEnrollmentActions}
        menuActions={menuEnrollmentActions}
      />

      <div className="space-y-section">
        {/* Actionable for staff, so it sits right under the header. */}
        <EnrollmentDocumentsCard
          applicationId={id}
          documents={d.documents ?? {}}
          canEdit={d.canEdit}
        />

        <EnrollmentApplicationView
          application={{
            id,
            studentData: d.studentData,
            ayahData: d.ayahData,
            ibuData: d.ibuData,
            consentData: d.consentData,
          }}
        />

        {d.canEdit && d.status === "ACCEPTED" && !d.studentId && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Formulir sudah diterima. Konversi menjadi data siswa + orang tua.
              </p>
              <Button onClick={() => setConvertOpen(true)} disabled={busy}>
                Konversi ke Siswa
              </Button>
            </div>
          </>
        )}
        {d.studentId && (
          <>
            <Separator />
            <p className="text-sm text-status-present-text">
              Formulir ini sudah dikonversi menjadi data siswa.
            </p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Konversi menjadi siswa?"
        description="Tindakan ini membuat data siswa dan data orang tua dari formulir pendaftaran ini."
        confirmLabel="Konversi ke Siswa"
        loading={busy}
        onConfirm={convert}
      />
    </>
  );
}
