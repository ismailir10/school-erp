"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import { FormDialogFooter, FormField, FormRootError } from "@/components/ui/form";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, readApiError } from "@/lib/api/client-errors";
import { computeEnrollmentFee, isDayCareProgram, type FeeProgram } from "@/lib/enrollment/fee";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { formatRupiah } from "@/lib/format";
import type { Admission } from "./types";
import type { SendFormulirResult } from "./send-formulir-dialog";

/**
 * "Kirim formulir": the small question staff answer BEFORE a formulir goes out.
 *
 * Program and Day Care set the price of the pendaftaran fee, which the server
 * creates in the same request (pay-first, cycle 2026-10-11-pendaftaran-simplify),
 * so they are asked here, with the amount shown as it will be charged. On success
 * the page opens the result card (`SendFormulirDialog`) with the invite response.
 *
 * Owns the invite request; the page only decides which lead it is for.
 */

const formSchema = z.object({
  programId: z.string().trim().min(1, "Pilih program dulu."),
  dcareAddon: z.boolean(),
});

type ConfigProgram = FeeProgram & { name: string };

/** null = the list could not be loaded. */
type LoadedPrograms = { leadId: string; programs: ConfigProgram[] | null };

type InviteResponse = {
  id?: string;
  formUrl?: string;
  emailed?: boolean;
  hasEmail?: boolean;
  created?: boolean;
  fee?: AdminFeeView | null;
  feeNote?: string;
};

export type KirimFormulirFormProps = {
  /** The lead the formulir is for; null = closed. */
  admission: Admission | null;
  /**
   * What the lead's formulir already holds, when the caller knows it (a resend).
   * Without it the form starts from the lead's own program and no Day Care.
   */
  current?: { programId: string | null; dcareAddon: boolean } | null;
  /**
   * The lead already has a formulir (the caller knows, the invite route decides). Without `current`
   * the fields start from the lead, but an untouched choice is not sent and the server keeps the
   * formulir's own, so the amount is then only an estimate and says so.
   */
  resend?: boolean;
  onClose: () => void;
  onSent: (admission: Admission, result: SendFormulirResult) => void;
  /** The server says the lead can no longer get a formulir (closed, or already filled): refresh the list. */
  onStale?: () => void;
};

const FALLBACK = "Gagal mengirim formulir. Coba lagi.";

export function KirimFormulirForm({ admission, current, resend = false, onClose, onSent, onStale }: KirimFormulirFormProps) {
  const formId = useId();
  const open = admission !== null;
  const leadId = admission?.id ?? null;
  const form = useZodForm(formSchema, { defaultValues: { programId: "", dcareAddon: false } });
  const [loaded, setLoaded] = useState<LoadedPrograms | null>(null);
  // A double click must not post twice: `isSubmitting` only flips after the next render.
  const inFlight = useRef(false);

  const fetched = loaded && loaded.leadId === leadId ? loaded : null;
  const programs = fetched?.programs ?? null;
  const status: "loading" | "ready" | "failed" = !fetched ? "loading" : programs === null ? "failed" : "ready";

  // Fresh prices and a fresh form every time the dialog opens for a lead.
  useEffect(() => {
    if (!admission) return;
    const initial = current ?? { programId: admission.programId, dcareAddon: false };
    form.reset({ programId: initial.programId ?? "", dcareAddon: initial.dcareAddon });
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/config/enrollment");
        if (!res.ok) throw new Error("config");
        const body = (await res.json()) as { programs?: unknown };
        const list = Array.isArray(body.programs) ? (body.programs as ConfigProgram[]) : [];
        if (!alive) return;
        // A lead's program that was retired since is not offered: staff pick another.
        if (!list.some((p) => p.id === form.getValues("programId"))) form.setValue("programId", "");
        setLoaded({ leadId: admission.id, programs: list });
      } catch {
        if (alive) setLoaded({ leadId: admission.id, programs: null });
      }
    })();
    return () => {
      alive = false;
    };
    // Only when a different lead is opened; `form` is stable and `current` is read once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const programId = form.watch("programId");
  const dcareAddon = form.watch("dcareAddon");
  // Only what staff changed is sent: an untouched field lets the server keep what the
  // formulir already holds (a resend) or fall back to the lead's own (a first send).
  const { dirtyFields } = form.formState;
  const untouched = !dirtyFields.programId && !dirtyFields.dcareAddon;
  const estimate = resend && !current && untouched;

  const breakdown = useMemo(
    () => (programs && programs.some((p) => p.id === programId) ? computeEnrollmentFee({ programs, programId, dcareAddon }) : null),
    [programs, programId, dcareAddon],
  );

  // Day Care as a program already includes it: the add-on is meaningless there, so it is not asked.
  const chosenIsDayCare = isDayCareProgram(programs?.find((p) => p.id === programId)?.code);

  // Without the list, the lead's own program is still a valid, if unpriced, choice.
  const options = useMemo(() => {
    if (programs) return programs.map((p) => ({ value: p.id, label: p.name }));
    return admission?.programId && admission.program ? [{ value: admission.programId, label: admission.program.name }] : [];
  }, [programs, admission?.programId, admission?.program]);

  const submit = form.handleSubmit(async (values) => {
    if (!admission || inFlight.current) return;
    inFlight.current = true;
    const payload: Record<string, unknown> = { admissionId: admission.id };
    if (dirtyFields.programId) payload.programId = values.programId;
    if (dirtyFields.dcareAddon && !chosenIsDayCare) payload.dcareAddon = values.dcareAddon;
    try {
      const res = await fetch("/api/enrollments/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (res.status === 409) {
          // LEAD_CLOSED / ALREADY_IN_PROGRESS: nothing to fix here, so say why and step out.
          const d = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error(d.message || "Formulir tidak bisa dikirim untuk calon siswa ini.");
          onClose();
          onStale?.();
          return;
        }
        if (res.status === 429) throw new ApiError("Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.", { status: 429 });
        throw await readApiError(res, FALLBACK);
      }
      const d = (await res.json().catch(() => ({}))) as InviteResponse;
      if (!d.formUrl || !d.id) {
        toast.error("Formulir disiapkan, tetapi tautannya tidak terbaca. Muat ulang lalu coba lagi.");
        onClose();
        onStale?.();
        return;
      }
      onSent(admission, {
        id: d.id,
        formUrl: d.formUrl,
        emailed: !!d.emailed,
        hasEmail: !!d.hasEmail,
        created: d.created === true,
        fee: d.fee ?? null,
        feeNote: d.feeNote,
      });
    } catch (err) {
      applyServerErrors(form, err, FALLBACK);
    } finally {
      inFlight.current = false;
    }
  });

  const pending = form.formState.isSubmitting;
  const email = admission?.parentEmail?.trim() || null;

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !pending) onClose();
      }}
      title="Kirim formulir"
      description={admission ? `Untuk orang tua ${admission.parentName}` : undefined}
      size="md"
      footer={
        <FormDialogFooter
          formId={formId}
          pending={pending}
          disabled={status === "loading"}
          onCancel={onClose}
          submitLabel="Kirim formulir"
          pendingLabel="Mengirim..."
        />
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        <FormField
          control={form.control}
          name="programId"
          label="Program"
          required
          id="kirim-formulir-program"
          description="Program menentukan biaya formulir."
          render={({ field, controlProps }) => (
            <Select
              // Nothing to show until the list is here: the lead's program may have been retired.
              value={status === "loading" ? "" : field.value}
              onValueChange={(v) => v != null && field.onChange(v)}
              items={options}
              disabled={status === "loading"}
            >
              <SelectTrigger {...controlProps} onBlur={field.onBlur}>
                <SelectValue placeholder={status === "loading" ? "Memuat program…" : "Pilih program"} />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {/* Always mounted, so the message is announced when it appears. */}
        <p role="alert" className="text-sm text-destructive empty:hidden">
          {status === "failed" ? "Daftar program belum bisa dimuat. Tutup lalu buka lagi untuk mencoba ulang." : null}
        </p>
        {chosenIsDayCare ? null : (
          <FormField
            control={form.control}
            name="dcareAddon"
            label="Tambahan Day Care (penitipan)"
            orientation="horizontal"
            id="kirim-formulir-dcare"
            render={({ field, controlProps }) => (
              <Checkbox
                {...controlProps}
                name={field.name}
                checked={field.value === true}
                onCheckedChange={(c) => field.onChange(c === true)}
                onBlur={field.onBlur}
              />
            )}
          />
        )}
        <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite" data-testid="kirim-formulir-fee">
          <FeeLine status={status} programId={programId} breakdown={breakdown} estimate={estimate} />
          {breakdown && breakdown.programFee > 0 && breakdown.dcareAddonFee > 0 && (
            <p className="text-muted-foreground tabular-nums">
              Program {formatRupiah(breakdown.programFee)} + Day Care {formatRupiah(breakdown.dcareAddonFee)}
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {email ? `Dikirim ke ${email}` : "Tidak ada email — bagikan lewat WhatsApp atau isi bersama orang tua"}
        </p>
      </form>
    </ResponsiveFormDialog>
  );
}

function FeeLine({
  status,
  programId,
  breakdown,
  estimate,
}: {
  status: "loading" | "ready" | "failed";
  programId: string;
  breakdown: ReturnType<typeof computeEnrollmentFee> | null;
  /** The server will keep the formulir's own choice, so this amount may not be what applies. */
  estimate: boolean;
}) {
  if (status === "loading") return <p className="text-muted-foreground">Memuat biaya…</p>;
  // Never claim "free" for something we could not price.
  if (status === "failed") return <p className="text-muted-foreground">Biaya dihitung otomatis saat formulir dikirim.</p>;
  if (!programId) return <p className="text-muted-foreground">Pilih program untuk melihat biaya.</p>;
  if (!breakdown) return <p className="text-muted-foreground">Biaya dihitung otomatis saat formulir dikirim.</p>;
  const amount = breakdown.baseAmount <= 0 ? "Tanpa biaya" : formatRupiah(breakdown.amount);
  if (estimate) {
    return (
      <>
        <p>
          <span className="text-muted-foreground">Perkiraan biaya: </span>
          <span className="font-semibold tabular-nums">{amount}</span>
        </p>
        <p className="text-muted-foreground">Perkiraan; nominal mengikuti formulir yang sudah dikirim.</p>
      </>
    );
  }
  return (
    <p>
      <span className="text-muted-foreground">Biaya formulir: </span>
      <span className="font-semibold tabular-nums">{amount}</span>
    </p>
  );
}
