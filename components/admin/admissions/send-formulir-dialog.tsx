"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, MessageCircle, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";
import {
  FEE_SETTLE_TOAST,
  isSettledElsewhere,
  readEnrollmentFeeDetail,
  settleEnrollmentFee,
  settleErrorText,
  type FeePermissions,
  type SettleBody,
} from "@/lib/enrollment/fee-client";
import { inviteWaUrl } from "@/lib/enrollment/follow-up";
import { formatRupiah } from "@/lib/format";

/**
 * The "Formulir siap dikirim" card shown after Kirim formulir succeeds.
 *
 * Staff leave with one of three ways to get the link to the parent: WhatsApp,
 * copy, or open the real parent form on this device and fill it together (the
 * parent signs on the screen). Email, when the lead has one, already went out;
 * the status line says so, or says why the link has to be shared by hand.
 *
 * Pay-first: the card also says what the formulir costs and whether it is paid.
 * While the fee is unpaid the parent's link opens the pay screen, so staff who may
 * record money can settle it right here (cash or transfer, or waive) and the card
 * updates in place. The settle buttons only show for staff the fee route would
 * accept; the permissions come from `GET /api/enrollments/{id}` (`feePermissions`),
 * fetched only while there is something to settle. Settling asks for a confirm
 * INLINE in the card (no stacked dialog): it cannot be undone.
 *
 * The page owns the invite request (`KirimFormulirForm`) and hands the response in.
 */

export type SendFormulirResult = {
  /** The EnrollmentApplication id (what the fee route is addressed by). */
  id: string;
  formUrl: string;
  /** The invite email went out. */
  emailed: boolean;
  /** The lead has an email, whether or not the send worked. */
  hasEmail: boolean;
  /** True when this send created the formulir (a first send); false for a resend. */
  created: boolean;
  /** Staff view of the pendaftaran fee; null = no fee row (free program, or a formulir sent before pay-first). */
  fee: AdminFeeView | null;
  /** What a resend did to an existing fee: "repriced", "unchanged_paid", "unchanged_waived", ... */
  feeNote?: string;
};

export type SendFormulirDialogProps = {
  /** null = closed. */
  result: SendFormulirResult | null;
  /** The address the email went (or would have gone) to; only shown when the send worked. */
  email?: string | null;
  parentName: string;
  /** May be blank: a lead logged before the child was named. */
  childName?: string | null;
  /** A number WhatsApp can open (callers pick it with `resolveFollowUpPhone`), else null. */
  phone: string | null;
  schoolName?: string | null;
  onClose: () => void;
};

/** One line on what a resend did to the fee that already existed. */
const FEE_NOTE_TEXT: Record<string, string> = {
  repriced: "Biaya dihitung ulang sesuai pilihan baru.",
  unchanged_paid: "Biaya sudah lunas, jadi tidak diubah.",
  unchanged_waived: "Biaya sudah dibebaskan, jadi tidak diubah.",
  unchanged_inactive_program: "Program ini sudah tidak aktif, jadi biaya tidak diubah.",
};

const LEGACY_NOTE = "Tautan baru dikirim. Formulir ini memakai alur lama (isi dulu, bayar di akhir).";
const PAY_HINT = "Tandai lunas dulu supaya formulir terbuka, atau minta orang tua membayar lewat tautan.";
// For staff who cannot record money here: the only way forward is the parent paying.
const PAY_BY_PARENT_HINT = "Formulir terbuka setelah orang tua membayar lewat tautan.";
const TOGETHER_HINT = "Buka di perangkat ini supaya orang tua bisa mengisi dan tanda tangan di layar.";

/** What the inline confirm asks, per action. Settling cannot be undone, so the consequence is spelled out. */
type Pending = { kind: "CASH" } | { kind: "BANK_TRANSFER" } | { kind: "WAIVE" };

function confirmCopy(pending: Pending, fee: AdminFeeView | null) {
  const amount = fee ? formatRupiah(fee.amount) : "biaya ini";
  if (pending.kind === "WAIVE") {
    return {
      title: "Bebaskan biaya formulir?",
      body: "Orang tua tidak perlu membayar lagi dan formulir langsung terbuka. Tautan pembayaran yang sudah mereka pegang tidak berlaku.",
      action: "Bebaskan biaya",
    };
  }
  const how = pending.kind === "CASH" ? "tunai" : "lewat transfer bank";
  return {
    title: pending.kind === "CASH" ? "Tandai lunas (tunai)?" : "Tandai lunas (transfer)?",
    body: `Catat ${amount} sudah dibayar ${how}. Formulir langsung terbuka untuk orang tua dan pencatatan ini tidak bisa dibatalkan.`,
    action: "Tandai lunas",
  };
}

function statusLine(result: SendFormulirResult, email: string | null | undefined, hasPhone: boolean): string {
  if (result.emailed) return email ? `Email terkirim ke ${email}` : "Email terkirim";
  if (result.hasEmail) return "Email gagal terkirim — bagikan tautan";
  return hasPhone
    ? "Tidak ada email — bagikan lewat WhatsApp"
    : "Tidak ada email — salin tautan atau isi bersama orang tua";
}

export function SendFormulirDialog({
  result,
  email,
  parentName,
  childName,
  phone,
  schoolName,
  onClose,
}: SendFormulirDialogProps) {
  const waUrl = result
    ? inviteWaUrl({ phone, parentName, childName, formUrl: result.formUrl, schoolName })
    : null;

  return (
    <ResponsiveFormDialog
      open={result !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Formulir siap dikirim"
      description={result ? statusLine(result, email, waUrl !== null) : undefined}
      size="md"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Selesai
        </Button>
      }
    >
      {/* Keyed: a new result starts with its own fee, permissions and "Tersalin" state. */}
      {result ? <FormulirCard key={`${result.id}:${result.formUrl}`} result={result} waUrl={waUrl} /> : null}
    </ResponsiveFormDialog>
  );
}

function FormulirCard({ result, waUrl }: { result: SendFormulirResult; waUrl: string | null }) {
  const linkId = useId();
  const linkHintId = useId();
  const waHintId = useId();
  const togetherHintId = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Which settle button to give focus back to when the confirm is cancelled.
  const restoreKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  // Remembers which link the outcome belongs to, so a new result never shows a stale "Tersalin".
  const [copied, setCopied] = useState<{ url: string; outcome: "done" | "failed" } | null>(null);
  const copy = copied && copied.url === result.formUrl ? copied.outcome : "idle";

  const [fee, setFee] = useState<AdminFeeView | null>(result.fee);
  // Set once staff settle the fee here, so the line can say what just happened.
  const [settledHere, setSettledHere] = useState<"PAID" | "WAIVED" | null>(null);
  const [permissions, setPermissions] = useState<FeePermissions | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const unpaid = fee?.status === "UNPAID";
  const canSettle = unpaid && permissions !== null && (permissions.recordPayment || permissions.adjust);

  // "Tersalin" is a confirmation, not a state to keep: fall back after a moment.
  useEffect(() => {
    if (copied?.outcome !== "done") return;
    const id = window.setTimeout(() => setCopied(null), 3000);
    return () => window.clearTimeout(id);
  }, [copied]);

  // What may this staff member do to the fee? Asked only while there is something to settle;
  // the invite response carries no permissions, and the detail GET is the API's own answer.
  useEffect(() => {
    if (result.fee?.status !== "UNPAID") return;
    let alive = true;
    (async () => {
      const detail = await readEnrollmentFeeDetail(result.id);
      if (alive && detail?.feePermissions) setPermissions(detail.feePermissions);
    })();
    return () => {
      alive = false;
    };
  }, [result.id, result.fee?.status]);

  // The confirm opens on the safe choice; cancelling returns to the button that opened it.
  useEffect(() => {
    if (pending) {
      cancelRef.current?.focus();
      return;
    }
    const key = restoreKey.current;
    restoreKey.current = null;
    if (key) rootRef.current?.querySelector<HTMLElement>(`[data-settle="${key}"]`)?.focus();
  }, [pending]);

  // After settling, the buttons are gone: hand focus to the status that now says so.
  useEffect(() => {
    if (settledHere) statusRef.current?.focus();
  }, [settledHere]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.formUrl);
      setCopied({ url: result.formUrl, outcome: "done" });
    } catch {
      // Clipboard blocked (insecure origin, denied permission): leave the link selected for a manual copy.
      linkRef.current?.focus();
      linkRef.current?.select();
      setCopied({ url: result.formUrl, outcome: "failed" });
    }
  }

  function ask(next: Pending) {
    restoreKey.current = next.kind;
    setPending(next);
  }

  /** Run the confirmed action. On a failure other than "settled elsewhere" the confirm stays open for a retry. */
  async function settle() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const body: SettleBody =
      pending.kind === "WAIVE" ? { action: "WAIVE" } : { action: "MARK_PAID", method: pending.kind };
    const next = body.action === "MARK_PAID" ? "PAID" : "WAIVED";
    try {
      const updated = await settleEnrollmentFee(result.id, body);
      setFee((cur) => updated ?? (cur ? { ...cur, status: next } : cur));
      restoreKey.current = null;
      setSettledHere(next);
      setPending(null);
      toast.success(FEE_SETTLE_TOAST[body.action]);
    } catch (err) {
      toast.error(settleErrorText(err, body.action));
      if (isSettledElsewhere(err)) {
        // Someone settled it first: show what is true now instead of offering the same click again.
        const detail = await readEnrollmentFeeDetail(result.id);
        if (detail?.fee) setFee(detail.fee);
        restoreKey.current = null;
        setPending(null);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const feeNoteText = result.feeNote ? FEE_NOTE_TEXT[result.feeNote] : undefined;
  // `created` is what tells "free program" from "sent before pay-first": both have no fee row.
  const showFreeLine = !fee && result.created;
  const showLegacyNote = !fee && !result.created;
  const confirm = pending ? confirmCopy(pending, fee) : null;
  const hint = unpaid ? (canSettle ? PAY_HINT : PAY_BY_PARENT_HINT) : TOGETHER_HINT;

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={linkId}>Tautan formulir</Label>
        <Input
          id={linkId}
          ref={linkRef}
          readOnly
          value={result.formUrl}
          aria-describedby={linkHintId}
          onFocus={(e) => e.currentTarget.select()}
        />
        <p id={linkHintId} className="text-xs text-muted-foreground">
          Tautan ini khusus untuk satu keluarga.
        </p>
      </div>

      {/* Always mounted so assistive tech announces the change when staff settle the fee. */}
      <div
        ref={statusRef}
        role="status"
        tabIndex={-1}
        data-testid="formulir-fee"
        className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm outline-none empty:hidden"
      >
        {fee ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">Biaya formulir:</span>{" "}
            <span className="font-semibold tabular-nums">{formatRupiah(fee.amount)}</span>{" "}
            <StatusBadge status={fee.status} />
          </p>
        ) : null}
        {showFreeLine ? (
          <p>
            <span className="text-muted-foreground">Biaya formulir: </span>
            <span className="font-semibold">Tanpa biaya</span>
          </p>
        ) : null}
        {showLegacyNote ? <p>{LEGACY_NOTE}</p> : null}
        {feeNoteText ? <p className="text-muted-foreground">{feeNoteText}</p> : null}
        {settledHere === "PAID" ? <p className="text-muted-foreground">Sudah lunas. Formulir langsung terbuka untuk orang tua.</p> : null}
        {settledHere === "WAIVED" ? <p className="text-muted-foreground">Biaya dibebaskan. Formulir langsung terbuka untuk orang tua.</p> : null}
      </div>

      {canSettle && confirm ? (
        <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium">{confirm.title}</p>
            <p className="text-muted-foreground">{confirm.body}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button ref={cancelRef} type="button" variant="ghost" disabled={busy} onClick={() => setPending(null)}>
              Batal
            </Button>
            <Button
              type="button"
              variant={pending?.kind === "WAIVE" ? "destructive" : "default"}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void settle()}
            >
              {busy ? "Memproses..." : confirm.action}
            </Button>
          </div>
        </div>
      ) : null}

      {canSettle && !confirm ? (
        <div className="flex flex-col gap-2">
          {permissions?.recordPayment ? (
            <>
              <Button type="button" variant="outline" className="w-full" data-settle="CASH" onClick={() => ask({ kind: "CASH" })}>
                Tandai lunas (tunai)
              </Button>
              <Button type="button" variant="outline" className="w-full" data-settle="BANK_TRANSFER" onClick={() => ask({ kind: "BANK_TRANSFER" })}>
                Tandai lunas (transfer)
              </Button>
            </>
          ) : null}
          {permissions?.adjust ? (
            // Not a peer of "lunas": giving the money up is rarer and a different decision.
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full text-destructive hover:text-destructive"
              data-settle="WAIVE"
              onClick={() => ask({ kind: "WAIVE" })}
            >
              Bebaskan biaya
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "default", className: "w-full" })}
          >
            <MessageCircle aria-hidden />
            Kirim lewat WhatsApp{" "}
            <span className="sr-only">(tab baru)</span>
          </a>
        ) : (
          // aria-disabled, not disabled: it stays focusable so a keyboard or screen-reader
          // user reaches the hint that says why it is unavailable.
          <Button
            type="button"
            className="w-full cursor-not-allowed opacity-50"
            aria-disabled="true"
            aria-describedby={waHintId}
            onClick={(e) => e.preventDefault()}
          >
            <MessageCircle aria-hidden />
            Kirim lewat WhatsApp
          </Button>
        )}
        {waUrl ? null : (
          <p id={waHintId} className="text-xs text-muted-foreground">
            Belum ada nomor HP atau WhatsApp orang tua yang bisa dipakai.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Button type="button" variant="outline" className="w-full" onClick={copyLink}>
          {copy === "done" ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copy === "done" ? "Tersalin" : "Salin tautan"}
        </Button>
        {/* Always mounted so assistive tech announces the text when it changes. */}
        <p role="status" className="text-xs text-muted-foreground empty:hidden">
          {copy === "done" ? "Tautan formulir disalin." : null}
          {copy === "failed"
            ? "Tautan tidak bisa disalin otomatis. Tautan sudah dipilih di atas, salin secara manual."
            : null}
        </p>
      </div>

      <div className="space-y-1.5">
        <a
          href={result.formUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={togetherHintId}
          className={buttonVariants({ variant: "outline", className: "w-full" })}
        >
          <Users aria-hidden />
          Isi bersama orang tua{" "}
          <span className="sr-only">(tab baru)</span>
        </a>
        <p id={togetherHintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}
