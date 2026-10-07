"use client";

import { useEffect, useId } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormRootError } from "@/components/ui/form";
import { ClassSectionCombobox, type ClassSection } from "@/components/admin/class-section-picker";
import { promoteStudentSchema, withdrawStudentSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { sendJson } from "@/lib/api/send-json";
import { userMessage } from "@/lib/api/client-errors";
import { toast } from "sonner";

/**
 * The three lifecycle actions off the header's `⋯` menu: Naik Kelas
 * (promote), Luluskan (graduate — no fields), Keluarkan (withdraw —
 * destructive, reason required). Their `open` state is owned by the page
 * (the menu items that trigger them live in `DetailPageHeader`, outside this
 * component's own subtree); everything else — the class list, the forms,
 * the submit handlers — lives here.
 *
 * Withdraw and Graduate used to be plain `ConfirmDialog`s whose `onConfirm`
 * swallowed its own fetch failure (toast + return, never throw) — so
 * `ConfirmDialog`'s own "close only if `onConfirm` resolves without
 * throwing" contract never saw a rejection, and the dialog closed on a
 * server error exactly as if it had succeeded. Graduate keeps `ConfirmDialog`
 * (still no fields) but now rethrows on failure. Withdraw moves onto RHF +
 * `ResponsiveFormDialog`: the dialog only closes from this component's own
 * success path, so a failed submit's `FormRootError` stays on screen with
 * the dialog open, and the reason field gets a real inline validation error
 * instead of a pre-submit toast.
 */
export function StudentLifecycleDialogs({
  studentId,
  studentName,
  promoteOpen,
  onPromoteOpenChange,
  promoteSections,
  graduateOpen,
  onGraduateOpenChange,
  withdrawOpen,
  onWithdrawOpenChange,
  reactivateOpen = false,
  onReactivateOpenChange,
  onChanged,
}: {
  studentId: string;
  studentName: string;
  promoteOpen: boolean;
  onPromoteOpenChange: (open: boolean) => void;
  /**
   * Fetched by the page's `openPromoteDialog` *before* it flips `promoteOpen`
   * true (same pre-open gate the pre-split page had: the dialog never shows
   * with nothing to pick from — a failed class-list fetch toasts and never
   * opens it at all), so this component only renders the already-loaded list.
   */
  promoteSections: ClassSection[];
  graduateOpen: boolean;
  onGraduateOpenChange: (open: boolean) => void;
  withdrawOpen: boolean;
  onWithdrawOpenChange: (open: boolean) => void;
  /** Aktifkan kembali — only offered for a WITHDRAWN student. */
  reactivateOpen?: boolean;
  onReactivateOpenChange?: (open: boolean) => void;
  /** Called after any of the actions succeeds, so the page can refetch. */
  onChanged: () => void;
}) {
  // ---------- Promote (Naik Kelas) ----------
  const promoteFormId = useId();
  const promoteForm = useZodForm(promoteStudentSchema, {
    defaultValues: { targetClassSectionId: "", notes: "" },
  });

  useEffect(() => {
    if (promoteOpen) promoteForm.reset({ targetClassSectionId: "", notes: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoteOpen]);

  const handlePromote = promoteForm.handleSubmit(async (values) => {
    try {
      await sendJson(`/api/students/${studentId}/promote`, { method: "POST", body: values }, "Gagal naik kelas");
      toast.success("Naik kelas");
      onPromoteOpenChange(false);
      onChanged();
    } catch (err) {
      applyServerErrors(promoteForm, err, "Gagal naik kelas");
    }
  });

  // ---------- Graduate (Luluskan) ----------
  async function handleGraduate() {
    try {
      await sendJson(`/api/students/${studentId}/graduate`, { method: "POST", body: {} }, "Gagal meluluskan");
      toast.success("Diluluskan");
      onChanged();
    } catch (err) {
      // Rethrow so ConfirmDialog's own catch keeps the dialog open instead of
      // closing it the same way a success would.
      toast.error(userMessage(err, "Gagal meluluskan"));
      throw err;
    }
  }

  // ---------- Reactivate (Aktifkan kembali) ----------
  async function handleReactivate() {
    try {
      await sendJson(`/api/students/${studentId}`, { method: "PUT", body: { status: "ACTIVE" } }, "Gagal mengaktifkan siswa");
      toast.success("Siswa aktif kembali");
      onChanged();
    } catch (err) {
      // Rethrow so ConfirmDialog keeps itself open on failure, like Graduate.
      toast.error(userMessage(err, "Gagal mengaktifkan siswa"));
      throw err;
    }
  }

  // ---------- Withdraw (Keluarkan) ----------
  const withdrawFormId = useId();
  const withdrawForm = useZodForm(withdrawStudentSchema, {
    defaultValues: { reason: "" },
  });

  useEffect(() => {
    if (withdrawOpen) withdrawForm.reset({ reason: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdrawOpen]);

  const handleWithdraw = withdrawForm.handleSubmit(async (values) => {
    try {
      const data = await sendJson<{ unpaidInvoiceCount: number }>(
        `/api/students/${studentId}/withdraw`,
        { method: "POST", body: { reason: values.reason } },
        "Gagal mengeluarkan siswa",
      );
      if (data.unpaidInvoiceCount > 0) {
        toast.success(`Siswa dikeluarkan. Perhatian: ${data.unpaidInvoiceCount} tagihan belum lunas.`);
      } else {
        toast.success("Dikeluarkan");
      }
      onWithdrawOpenChange(false);
      onChanged();
    } catch (err) {
      applyServerErrors(withdrawForm, err, "Gagal mengeluarkan siswa");
    }
  });

  const withdrawing = withdrawForm.formState.isSubmitting;

  return (
    <>
      {/* ---------- Promote (2 fields) ---------- */}
      <ResponsiveFormDialog
        open={promoteOpen}
        onOpenChange={(o) => !promoteForm.formState.isSubmitting && onPromoteOpenChange(o)}
        title="Naik Kelas"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onPromoteOpenChange(false)} disabled={promoteForm.formState.isSubmitting}>Batal</Button>
            <Button type="submit" form={promoteFormId} disabled={promoteForm.formState.isSubmitting}>
              {promoteForm.formState.isSubmitting ? "Memproses..." : "Naik Kelas"}
            </Button>
          </>
        }
      >
        <form id={promoteFormId} onSubmit={handlePromote} noValidate className="space-y-field">
          <FormRootError formState={promoteForm.formState} />
          <FormField
            control={promoteForm.control}
            name="targetClassSectionId"
            label="Kelas Tujuan"
            required
            id="promote-class-section"
            render={({ field, controlProps }) => (
              <ClassSectionCombobox
                id={controlProps.id}
                sections={promoteSections}
                value={(field.value as string | undefined) ?? ""}
                onChange={field.onChange}
                placeholder="Pilih kelas tujuan..."
              />
            )}
          />
          <FormField
            control={promoteForm.control}
            name="notes"
            label="Catatan (opsional)"
            id="promote-notes"
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                value={(field.value as string | undefined) ?? ""}
                placeholder="Catatan naik kelas"
                rows={2}
              />
            )}
          />
        </form>
      </ResponsiveFormDialog>

      {/* Graduate Confirm */}
      <ConfirmDialog
        open={graduateOpen}
        onOpenChange={onGraduateOpenChange}
        title="Luluskan Siswa"
        description={`Luluskan ${studentName}? Status siswa akan berubah menjadi Lulus dan semua pendaftaran kelas aktif akan diakhiri.`}
        onConfirm={handleGraduate}
        confirmLabel="Luluskan"
      />

      {/* Reactivate Confirm — enrolments are not restored; the admin re-enrols */}
      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={(o) => onReactivateOpenChange?.(o)}
        title={`Aktifkan kembali ${studentName}?`}
        description="Status siswa kembali Aktif. Daftarkan ke kelas setelahnya."
        confirmLabel="Aktifkan kembali"
        onConfirm={handleReactivate}
      />

      {/* ---------- Withdraw (destructive — a failed submit keeps this open) ---------- */}
      <ResponsiveFormDialog
        open={withdrawOpen}
        onOpenChange={(o) => !withdrawing && onWithdrawOpenChange(o)}
        title="Keluarkan Siswa"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => onWithdrawOpenChange(false)} disabled={withdrawing}>Batal</Button>
            <Button type="submit" form={withdrawFormId} variant="destructive" disabled={withdrawing}>
              {withdrawing ? "Memproses..." : "Keluarkan"}
            </Button>
          </>
        }
      >
        <form id={withdrawFormId} onSubmit={handleWithdraw} noValidate className="space-y-field">
          <FormRootError formState={withdrawForm.formState} />
          <p className="text-sm text-muted-foreground">
            Mengeluarkan {studentName} dari sekolah. Status akan berubah menjadi Keluar dan semua pendaftaran kelas aktif akan diakhiri.
          </p>
          <FormField
            control={withdrawForm.control}
            name="reason"
            label="Alasan Keluar"
            required
            id="withdraw-reason"
            render={({ field, controlProps }) => (
              <Textarea
                {...field}
                {...controlProps}
                placeholder="Masukkan alasan siswa keluar dari sekolah..."
                rows={3}
              />
            )}
          />
        </form>
      </ResponsiveFormDialog>
    </>
  );
}
