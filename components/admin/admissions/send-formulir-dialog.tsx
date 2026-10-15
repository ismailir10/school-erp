"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, MessageCircle, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { inviteWaUrl } from "@/lib/enrollment/follow-up";

/**
 * The "Formulir siap dikirim" card shown after Kirim Formulir succeeds.
 *
 * Staff leave with one of three ways to get the link to the parent: WhatsApp,
 * copy, or open the real parent form on this device and fill it together (the
 * parent signs on the screen). Email, when the lead has one, already went out;
 * the status line says so, or says why the link has to be shared by hand.
 *
 * Pay-after: there is no fee yet. The parent chooses the program, fills the form and
 * pays the pendaftaran fee after sending it, so the card only says that. Staff settle
 * a walk-in's fee from the formulir's own fee card once it is submitted.
 *
 * The page owns the invite request and hands the response in.
 */

export type SendFormulirResult = {
  /** The EnrollmentApplication id. */
  id: string;
  formUrl: string;
  /** The invite email went out. */
  emailed: boolean;
  /** The lead has an email, whether or not the send worked. */
  hasEmail: boolean;
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
  /** The lead already had a link and this send replaced it: the old one no longer opens. */
  resend?: boolean;
  onClose: () => void;
};

const RESEND_NOTE = "Tautan lama tidak berlaku lagi; kirim tautan baru ini ke orang tua.";
const PAY_AFTER_NOTE = "Biaya pendaftaran dibayar orang tua setelah mengisi dan mengirim formulir.";
const TOGETHER_HINT = "Buka di perangkat ini supaya orang tua bisa mengisi dan tanda tangan di layar.";

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
  resend = false,
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
      {/* Keyed: a new result starts with its own "Tersalin" state. */}
      {result ? <FormulirCard key={`${result.id}:${result.formUrl}`} result={result} waUrl={waUrl} resend={resend} /> : null}
    </ResponsiveFormDialog>
  );
}

function FormulirCard({ result, waUrl, resend }: { result: SendFormulirResult; waUrl: string | null; resend: boolean }) {
  const linkId = useId();
  const linkHintId = useId();
  const waHintId = useId();
  const togetherHintId = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  // Remembers which link the outcome belongs to, so a new result never shows a stale "Tersalin".
  const [copied, setCopied] = useState<{ url: string; outcome: "done" | "failed" } | null>(null);
  const copy = copied && copied.url === result.formUrl ? copied.outcome : "idle";

  // "Tersalin" is a confirmation, not a state to keep: fall back after a moment.
  useEffect(() => {
    if (copied?.outcome !== "done") return;
    const id = window.setTimeout(() => setCopied(null), 3000);
    return () => window.clearTimeout(id);
  }, [copied]);

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

  return (
    <div className="space-y-4">
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
          {TOGETHER_HINT}
        </p>
      </div>

      {resend ? <p className="text-xs text-muted-foreground">{RESEND_NOTE}</p> : null}
      <p className="text-xs text-muted-foreground">{PAY_AFTER_NOTE}</p>
    </div>
  );
}
