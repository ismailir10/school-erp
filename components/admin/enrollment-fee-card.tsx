"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, MessageCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { paymentMethodLabel } from "@/lib/constants/payment-methods";
import { applyDiscount } from "@/lib/enrollment/fee";
import type { AdminFeeView, FeeAttention } from "@/lib/enrollment/fee-admin-view";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { feeDiscountFormSchema, feeMarkPaidFormSchema } from "@/lib/validations/enrollment-fee";

export type EnrollmentFeeCardProps = {
  applicationId: string;
  childName: string;
  fee: AdminFeeView;
  /** Editors only, only while UNPAID. */
  followUp: { formUrl: string; canRemind: boolean } | null;
  problems: FeeAttention[];
  canEdit: boolean;
  permissions: { recordPayment: boolean; adjust: boolean };
  /** Re-read the application after any change. */
  onChange: () => void;
};

const METHOD_OPTIONS = [
  { value: "CASH", label: "Tunai" },
  { value: "BANK_TRANSFER", label: "Transfer bank" },
] as const;

/** Wording for how the fee was settled. */
function settledBy(fee: AdminFeeView): string {
  if (fee.status === "WAIVED") return "Dibebaskan oleh admin";
  return fee.method ? paymentMethodLabel(fee.method) : "—";
}

/**
 * "Pembayaran pendaftaran" on `/admin/enrollments/[id]`: what the parent owes,
 * whether they paid, and what staff can do about it.
 *
 * Chasing goes through the reminder ENDPOINT (a plain link that redirects to
 * WhatsApp), never a wa.me URL held in the page: the message carries the
 * parent's form link and its token is a credential. Money actions are gated by
 * the same keys the API enforces (`permissions`), so nothing is shown that
 * would only be refused.
 */
export function EnrollmentFeeCard({
  applicationId,
  childName,
  fee,
  followUp,
  problems,
  canEdit,
  permissions,
  onChange,
}: EnrollmentFeeCardProps) {
  const [dialog, setDialog] = useState<"discount" | "paid" | null>(null);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const unpaid = fee.status === "UNPAID";
  const feeUrl = `/api/enrollments/${applicationId}/fee`;

  async function copyLink() {
    if (!followUp) return;
    try {
      await navigator.clipboard.writeText(followUp.formUrl);
      toast.success("Tautan pembayaran disalin");
    } catch {
      toast.error("Tautan tidak bisa disalin otomatis. Salin dari kolom alamat peramban.");
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const body = await sendJson<{ code: string; message: string }>(
        `${feeUrl}/refresh`,
        { method: "POST" },
        "Gagal memeriksa pembayaran. Coba lagi.",
      );
      if (body?.code === "UPDATED") toast.success(body.message);
      else if (body?.code === "NEEDS_REVIEW") toast.warning(body.message);
      else if (body?.code === "GATEWAY_ERROR") toast.error(body.message);
      else toast.info(body?.message ?? "Belum ada perubahan.");
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal memeriksa pembayaran. Coba lagi.");
    } finally {
      setRefreshing(false);
    }
  }

  async function waive() {
    try {
      await sendJson(feeUrl, { method: "PATCH", body: { action: "WAIVE" } }, "Gagal membebaskan biaya. Coba lagi.");
      toast.success("Biaya pendaftaran dibebaskan");
      onChange();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Gagal membebaskan biaya. Coba lagi.");
      // A 409 means someone settled it first: show what is true now.
      if (err instanceof ApiError && err.status === 409) onChange();
      throw err;
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4" aria-labelledby="pembayaran-pendaftaran-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="pembayaran-pendaftaran-title" className="text-sm font-semibold">
          Pembayaran pendaftaran
        </h3>
        <StatusBadge status={fee.status} />
      </div>

      {problems.length > 0 && (
        <div className="mb-4 space-y-2">
          {problems.map((p) => (
            <Alert key={p.code} variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Perlu dicek</AlertTitle>
              <AlertDescription>{p.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Biaya normal</dt>
        <dd className="text-right tabular-nums">{formatRupiah(fee.baseAmount)}</dd>
        {fee.discountPercent > 0 && (
          <>
            <dt className="text-muted-foreground">Diskon {fee.discountPercent}%</dt>
            <dd className="text-right tabular-nums">
              −{formatRupiah(fee.baseAmount - fee.amount)}
              {fee.discountReason && (
                <span className="block text-xs text-muted-foreground">{fee.discountReason}</span>
              )}
            </dd>
          </>
        )}
        {/* A waived fee keeps its old amount in the row; showing it as owed would read as a debt. */}
        {fee.status !== "WAIVED" && (
          <>
            <dt className="font-medium">{fee.status === "PAID" ? "Dibayar" : "Harus dibayar"}</dt>
            <dd className="text-right font-semibold tabular-nums">{formatRupiah(fee.amount)}</dd>
          </>
        )}
        {fee.status !== "UNPAID" && (
          <>
            <dt className="text-muted-foreground">{fee.status === "PAID" ? "Cara bayar" : "Status"}</dt>
            <dd className="text-right">{settledBy(fee)}</dd>
            {fee.paidAt && (
              <>
                <dt className="text-muted-foreground">Tanggal</dt>
                <dd className="text-right">{formatDateTime(fee.paidAt)}</dd>
              </>
            )}
            {fee.note && (
              <>
                <dt className="text-muted-foreground">Catatan</dt>
                <dd className="text-right">{fee.note}</dd>
              </>
            )}
          </>
        )}
      </dl>

      {unpaid && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {fee.linkError && <p>Tautan pembayaran gagal dibuat: {fee.linkError}</p>}
          {fee.lastCheckedAt && <p>Terakhir diperiksa ke gateway {formatDateTime(fee.lastCheckedAt)}.</p>}
        </div>
      )}

      {canEdit && unpaid && (
        <div className="mt-4 flex flex-col gap-4 border-t pt-4 sm:flex-row sm:flex-wrap sm:items-start">
          {followUp && (
            <div className="flex flex-wrap gap-2">
              {followUp.canRemind ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  // Base UI would otherwise mark the anchor role="button"; it navigates.
                  role="link"
                  render={
                    <a
                      href={`${feeUrl}/reminder`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Chat WhatsApp: ingatkan orang tua ${childName || "anak ini"}`}
                    />
                  }
                >
                  <MessageCircle aria-hidden="true" />
                  Chat WhatsApp
                </Button>
              ) : (
                <Button size="sm" disabled title="Belum ada nomor WhatsApp orang tua">
                  <MessageCircle aria-hidden="true" />
                  Chat WhatsApp
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                <Copy aria-hidden="true" />
                Salin tautan pembayaran
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {permissions.recordPayment && (
              <>
                <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing || undefined}>
                  <RefreshCw aria-hidden="true" />
                  {refreshing ? "Memeriksa..." : "Perbarui pembayaran"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog("paid")}>
                  Tandai sudah bayar
                </Button>
              </>
            )}
            {permissions.adjust && (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog("discount")}>
                  Atur diskon
                </Button>
                <Button size="sm" variant="outline" onClick={() => setWaiveOpen(true)}>
                  Bebaskan biaya
                </Button>
              </>
            )}
          </div>
          {followUp && !followUp.canRemind && (
            <p className="text-xs text-muted-foreground sm:basis-full">
              Belum ada nomor WhatsApp orang tua. Salin tautan dan kirim lewat cara lain.
            </p>
          )}
        </div>
      )}

      <DiscountDialog
        open={dialog === "discount"}
        onClose={() => setDialog(null)}
        feeUrl={feeUrl}
        fee={fee}
        onDone={onChange}
      />
      <MarkPaidDialog
        open={dialog === "paid"}
        onClose={() => setDialog(null)}
        feeUrl={feeUrl}
        fee={fee}
        onDone={onChange}
      />
      <ConfirmDialog
        open={waiveOpen}
        onOpenChange={setWaiveOpen}
        title={`Bebaskan biaya pendaftaran ${childName || "anak ini"}?`}
        description="Orang tua tidak perlu membayar biaya ini lagi. Tautan pembayaran yang sudah mereka pegang tidak berlaku."
        confirmLabel="Bebaskan biaya"
        destructive
        onConfirm={waive}
      />
    </section>
  );
}

/** Whether the parent may already be paying the amount we are about to change. */
function LiveLinkWarning({ fee }: { fee: AdminFeeView }) {
  if (!fee.linkActive) return null;
  return (
    <Alert>
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>Orang tua sudah punya tautan pembayaran</AlertTitle>
      <AlertDescription>
        Tautan itu dibatalkan saat jumlah berubah. Jika orang tua sudah telanjur membayar jumlah lama, pembayarannya
        muncul sebagai &ldquo;Perlu dicek&rdquo; dan perlu dikembalikan lewat dashboard DOKU.
      </AlertDescription>
    </Alert>
  );
}

function DiscountDialog({
  open,
  onClose,
  feeUrl,
  fee,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  feeUrl: string;
  fee: AdminFeeView;
  onDone: () => void;
}) {
  const formId = useId();
  const form = useZodForm(feeDiscountFormSchema, {
    defaultValues: { discountPercent: String(fee.discountPercent), reason: fee.discountReason ?? "" },
  });

  useEffect(() => {
    if (open) form.reset({ discountPercent: String(fee.discountPercent), reason: fee.discountReason ?? "" });
    // Reset only when the dialog opens; `form` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typed = form.watch("discountPercent");
  const percent = /^\d{1,3}$/.test(typed ?? "") ? Math.min(100, Number(typed)) : null;
  const preview = percent === null ? null : applyDiscount(fee.baseAmount, percent);

  const submit = form.handleSubmit(async (values) => {
    const discountPercent = Number(values.discountPercent);
    try {
      await sendJson(
        feeUrl,
        { method: "PATCH", body: { action: "DISCOUNT", discountPercent, reason: values.reason || undefined } },
        "Gagal menyimpan diskon. Coba lagi.",
      );
      toast.success(discountPercent >= 100 ? "Biaya pendaftaran dibebaskan" : "Diskon disimpan");
      onClose();
      onDone();
    } catch (err) {
      applyServerErrors(form, err, "Gagal menyimpan diskon. Coba lagi.");
      // Someone settled it first: applyServerErrors has toasted why; close the
      // dialog (its submit would only 409 again) and show what is true now.
      if (err instanceof ApiError && err.status === 409) {
        onClose();
        onDone();
      }
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => !o && !form.formState.isSubmitting && onClose()}
      title="Atur diskon"
      description="Diskon dihitung dari biaya normal, jadi mengubahnya tidak menumpuk."
      size="md"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={onClose}
          submitLabel="Simpan diskon"
        />
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <LiveLinkWarning fee={fee} />
        <FormField
          control={form.control}
          name="discountPercent"
          label="Diskon (%)"
          required
          id="enrollment-fee-discount"
          description={`Biaya normal ${formatRupiah(fee.baseAmount)}. Isi 0 untuk menghapus diskon, 100 untuk membebaskan biaya.`}
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} inputMode="numeric" autoComplete="off" className="max-w-32" />
          )}
        />
        <FormField
          control={form.control}
          name="reason"
          label="Alasan diskon"
          id="enrollment-fee-discount-reason"
          description="Wajib diisi jika ada diskon, misalnya early bird atau kakak-adik."
          render={({ field, controlProps }) => <Input {...field} {...controlProps} autoComplete="off" />}
        />
        {preview && (
          <p className="text-sm" aria-live="polite">
            Yang harus dibayar orang tua:{" "}
            <strong className="tabular-nums">{preview.amount === 0 ? "Bebas biaya" : formatRupiah(preview.amount)}</strong>
          </p>
        )}
      </form>
    </ResponsiveFormDialog>
  );
}

function MarkPaidDialog({
  open,
  onClose,
  feeUrl,
  fee,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  feeUrl: string;
  fee: AdminFeeView;
  onDone: () => void;
}) {
  const formId = useId();
  const form = useZodForm(feeMarkPaidFormSchema, {
    // The method is chosen on purpose: recording cash vs transfer wrongly is a ledger error.
    defaultValues: { method: undefined, note: "" },
  });

  useEffect(() => {
    if (open) form.reset({ method: undefined, note: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = form.handleSubmit(async (values) => {
    try {
      await sendJson(
        feeUrl,
        { method: "PATCH", body: { action: "MARK_PAID", method: values.method, note: values.note || undefined } },
        "Gagal mencatat pembayaran. Coba lagi.",
      );
      toast.success("Pembayaran dicatat");
      onClose();
      onDone();
    } catch (err) {
      applyServerErrors(form, err, "Gagal mencatat pembayaran. Coba lagi.");
      // Someone settled it first: applyServerErrors has toasted why; close the
      // dialog (its submit would only 409 again) and show what is true now.
      if (err instanceof ApiError && err.status === 409) {
        onClose();
        onDone();
      }
    }
  });

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => !o && !form.formState.isSubmitting && onClose()}
      title="Tandai sudah bayar"
      description={`Catat bahwa orang tua sudah membayar ${formatRupiah(fee.amount)} di luar DOKU.`}
      size="md"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={form.formState.isSubmitting}
          onCancel={onClose}
          submitLabel={`Catat ${formatRupiah(fee.amount)}`}
          pendingLabel="Mencatat..."
        />
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <LiveLinkWarning fee={fee} />
        <FormField
          control={form.control}
          name="method"
          label="Cara pembayaran"
          required
          id="enrollment-fee-method"
          render={({ field, controlProps }) => (
            <Select value={field.value ?? ""} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                <SelectValue placeholder="Pilih cara pembayaran" />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          label="Catatan"
          id="enrollment-fee-note"
          description="Opsional. Misalnya nomor bukti transfer."
          render={({ field, controlProps }) => <Input {...field} {...controlProps} autoComplete="off" />}
        />
      </form>
    </ResponsiveFormDialog>
  );
}
