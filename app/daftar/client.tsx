"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Check, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { admissionDobBounds, admissionDobError } from "@/lib/validations/admission";
import { clearDraft, formatAdmissionRef, loadDraft, saveDraft } from "./draft";

type Program = { id: string; name: string };
type Step = 1 | 2 | 3;
type FieldErrors = Record<string, string>;

type FormState = {
  childName: string;
  dateOfBirth: string;
  childGender: "" | "L" | "P";
  parentName: string;
  parentPhone: string;
  parentWhatsapp: string;
  parentEmail: string;
  programId: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  childName: "",
  dateOfBirth: "",
  childGender: "",
  parentName: "",
  parentPhone: "",
  parentWhatsapp: "",
  parentEmail: "",
  programId: "",
  notes: "",
};

// Indonesian phone shape — mirrors the server-side regex in
// lib/admission/submit-validation.ts (PHONE_REGEX). Client-side check is a
// UX convenience; trust boundary remains the server.
const PHONE_RE = /^[+\d\s\-()]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public-form controls: 44px tall, 16px text (also stops iOS zooming on focus).
// Scoped here via className — the shared Input/NativeSelect stay at h-8 for the
// dense admin screens.
const INPUT_CLASS = "h-11 px-3 text-base md:text-base";
const SELECT_CLASS = "h-11 pl-3 text-base";

type SubmitOk = { id: string };
type SubmitErr =
  | { error: "validation_failed"; fields: FieldErrors }
  | { error: "rate_limited" }
  | { error: "submit_failed" };

export default function DaftarClient({ programs }: { programs: Program[] }) {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ id: string; childName: string } | null>(
    null,
  );
  // Draft restore runs after mount (sessionStorage is client-only); persisting
  // waits for it so the empty first render can't overwrite a stored draft.
  const [draftReady, setDraftReady] = useState(false);
  const [dobBounds] = useState(() => admissionDobBounds());

  useEffect(() => {
    const draft = loadDraft(EMPTY_FORM);
    if (draft) {
      setForm(draft.form);
      setStep(draft.step);
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady || confirmation) return;
    saveDraft({ step, form });
  }, [draftReady, confirmation, step, form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  }

  function validateStep(target: Step): FieldErrors {
    const errs: FieldErrors = {};
    if (target === 1) {
      if (!form.childName.trim()) errs.childName = "Nama anak wajib diisi";
      if (!form.dateOfBirth) errs.dateOfBirth = "Tanggal lahir wajib diisi";
      else {
        const dobError = admissionDobError(form.dateOfBirth);
        if (dobError) errs.dateOfBirth = dobError;
      }
      if (form.childGender !== "L" && form.childGender !== "P") {
        errs.childGender = "Pilih jenis kelamin";
      }
    }
    if (target === 2) {
      if (!form.parentName.trim()) errs.parentName = "Nama orang tua wajib diisi";
      if (!form.parentPhone.trim()) {
        errs.parentPhone = "Nomor telepon wajib diisi";
      } else if (!PHONE_RE.test(form.parentPhone.trim())) {
        errs.parentPhone = "Nomor telepon tidak valid";
      }
      if (form.parentWhatsapp.trim() && !PHONE_RE.test(form.parentWhatsapp.trim())) {
        errs.parentWhatsapp = "Nomor WhatsApp tidak valid";
      }
      if (form.parentEmail.trim() && !EMAIL_RE.test(form.parentEmail.trim())) {
        errs.parentEmail = "Email tidak valid";
      }
    }
    if (target === 3) {
      if (form.notes.length > 500) errs.notes = "Catatan terlalu panjang (maksimal 500 karakter)";
    }
    return errs;
  }

  function nextStep() {
    const errs = validateStep(step);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep((s) => (Math.min(s + 1, 3) as Step));
  }

  function prevStep() {
    setErrors({});
    setStep((s) => (Math.max(s - 1, 1) as Step));
  }

  async function handleSubmit() {
    // Final validation across all steps before sending.
    const all = { ...validateStep(1), ...validateStep(2), ...validateStep(3) };
    if (Object.keys(all).length) {
      setErrors(all);
      // Return to first failing step.
      if (all.childName || all.dateOfBirth || all.childGender) setStep(1);
      else if (all.parentName || all.parentPhone || all.parentWhatsapp || all.parentEmail) setStep(2);
      return;
    }

    setSubmitting(true);
    setGlobalError(null);

    const payload = {
      childName: form.childName,
      dateOfBirth: form.dateOfBirth,
      childGender: form.childGender,
      parentName: form.parentName,
      parentPhone: form.parentPhone,
      ...(form.parentWhatsapp.trim() ? { parentWhatsapp: form.parentWhatsapp } : {}),
      ...(form.parentEmail.trim() ? { parentEmail: form.parentEmail } : {}),
      ...(form.programId ? { programId: form.programId } : {}),
      ...(form.notes.trim() ? { notes: form.notes } : {}),
    };

    try {
      const res = await fetch("/api/admission/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        const ok = (await res.json()) as SubmitOk;
        clearDraft();
        setConfirmation({ id: ok.id, childName: form.childName });
        return;
      }

      const body = (await res.json().catch(() => null)) as SubmitErr | null;

      if (res.status === 400 && body?.error === "validation_failed") {
        setErrors(body.fields ?? {});
        if (body.fields?.childName || body.fields?.dateOfBirth || body.fields?.childGender) setStep(1);
        else if (
          body.fields?.parentName ||
          body.fields?.parentPhone ||
          body.fields?.parentWhatsapp ||
          body.fields?.parentEmail
        )
          setStep(2);
        setGlobalError("Mohon periksa kembali isian yang ditandai.");
        return;
      }

      if (res.status === 429) {
        setGlobalError(
          "Terlalu banyak permintaan dari jaringan ini. Silakan coba lagi dalam satu menit.",
        );
        return;
      }

      setGlobalError("Pendaftaran tidak terkirim. Silakan coba kembali.");
    } catch {
      setGlobalError("Tidak dapat terhubung ke server. Periksa koneksi internet Bapak/Ibu.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    clearDraft();
    setForm(EMPTY_FORM);
    setErrors({});
    setGlobalError(null);
    setStep(1);
    setConfirmation(null);
  }

  if (confirmation) {
    return (
      <section
        data-testid="daftar-confirmation"
        className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-10"
      >
        <CheckCircle2
          className="mx-auto mb-4 size-12 text-primary"
          aria-hidden
          strokeWidth={1.5}
        />
        <h2 className="text-xl font-semibold text-foreground sm:text-2xl">
          Pendaftaran ananda{" "}
          <span data-testid="confirmation-child-name">{confirmation.childName}</span> tercatat
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Insya Allah tim kami akan menghubungi Bapak/Ibu dalam 1–3 hari kerja untuk menjadwalkan
          kunjungan.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Nomor pendaftaran:{" "}
          <span className="font-mono" data-testid="confirmation-reference">
            {formatAdmissionRef(confirmation.id)}
          </span>
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={resetForm}
          className="mt-6 h-11 px-5 text-base"
          data-testid="daftar-confirmation-reset"
        >
          Selesai
        </Button>
      </section>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (step < 3) nextStep();
        else handleSubmit();
      }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
    >
      <Stepper step={step} />

      {step === 1 && (
        <div data-testid="daftar-step-1" className="space-y-5">
          <Field>
            <FieldLabel htmlFor="childName" required>Nama Lengkap Anak</FieldLabel>
            <Input
              id="childName"
              name="childName"
              autoComplete="off"
              required
              maxLength={80}
              className={INPUT_CLASS}
              value={form.childName}
              onChange={(e) => update("childName", e.target.value)}
              aria-invalid={!!errors.childName}
              data-testid="field-child-name"
              placeholder="Aisyah Putri"
            />
            {errors.childName && <FieldError>{errors.childName}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="dateOfBirth" required>Tanggal Lahir</FieldLabel>
            <Input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              required
              min={dobBounds.min}
              max={dobBounds.max}
              className={INPUT_CLASS}
              value={form.dateOfBirth}
              onChange={(e) => update("dateOfBirth", e.target.value)}
              aria-invalid={!!errors.dateOfBirth}
              data-testid="field-date-of-birth"
            />
            {errors.dateOfBirth && <FieldError>{errors.dateOfBirth}</FieldError>}
          </Field>

          <Field>
            <FieldLabel id="childGender-label" required>Jenis Kelamin</FieldLabel>
            <RadioGroup
              value={form.childGender}
              onValueChange={(value) => update("childGender", value as "L" | "P")}
              aria-labelledby="childGender-label"
              aria-invalid={!!errors.childGender}
              aria-required="true"
              required
              className="grid grid-cols-2 gap-2"
            >
              {[
                { value: "L", label: "Laki-laki" },
                { value: "P", label: "Perempuan" },
              ].map((opt) => (
                <FieldLabel
                  key={opt.value}
                  htmlFor={`childGender-${opt.value}`}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-base font-medium transition-colors",
                    form.childGender === opt.value
                      ? "border-2 border-primary bg-primary/10 text-primary-text"
                      : "border-border bg-background text-foreground hover:bg-accent",
                  )}
                >
                  {/* Visible circle + dot (PAR-5): the control keeps its own
                      focus-visible ring for keyboard users. */}
                  <RadioGroupItem
                    id={`childGender-${opt.value}`}
                    value={opt.value}
                    className="size-5 border-2 border-muted-foreground/60 bg-background data-checked:border-primary"
                    data-testid={`field-child-gender-${opt.value.toLowerCase()}`}
                  />
                  {opt.label}
                </FieldLabel>
              ))}
            </RadioGroup>
            {errors.childGender && <FieldError>{errors.childGender}</FieldError>}
          </Field>
        </div>
      )}

      {step === 2 && (
        <div data-testid="daftar-step-2" className="space-y-5">
          <Field>
            <FieldLabel htmlFor="parentName" required>Nama Lengkap Orang Tua</FieldLabel>
            <Input
              id="parentName"
              name="parentName"
              autoComplete="name"
              required
              maxLength={80}
              className={INPUT_CLASS}
              value={form.parentName}
              onChange={(e) => update("parentName", e.target.value)}
              aria-invalid={!!errors.parentName}
              data-testid="field-parent-name"
              placeholder="Ibu Fatimah Az-Zahra"
            />
            {errors.parentName && <FieldError>{errors.parentName}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="parentPhone" required>Nomor Telepon</FieldLabel>
            <Input
              id="parentPhone"
              name="parentPhone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              maxLength={20}
              className={INPUT_CLASS}
              value={form.parentPhone}
              onChange={(e) => update("parentPhone", e.target.value)}
              aria-invalid={!!errors.parentPhone}
              data-testid="field-parent-phone"
              placeholder="0812-3456-7890"
            />
            {errors.parentPhone && <FieldError>{errors.parentPhone}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="parentWhatsapp">
              Nomor WhatsApp{" "}
              <span className="font-normal text-muted-foreground">(opsional)</span>
            </FieldLabel>
            <Input
              id="parentWhatsapp"
              name="parentWhatsapp"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={20}
              className={INPUT_CLASS}
              value={form.parentWhatsapp}
              onChange={(e) => update("parentWhatsapp", e.target.value)}
              aria-invalid={!!errors.parentWhatsapp}
              data-testid="field-parent-whatsapp"
              placeholder="Sama dengan nomor telepon jika WhatsApp aktif di nomor yang sama"
            />
            <FieldDescription>
              Tim kami biasanya menghubungi melalui WhatsApp.
            </FieldDescription>
            {errors.parentWhatsapp && <FieldError>{errors.parentWhatsapp}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="parentEmail">
              Email <span className="font-normal text-muted-foreground">(opsional)</span>
            </FieldLabel>
            <Input
              id="parentEmail"
              name="parentEmail"
              type="email"
              autoComplete="email"
              inputMode="email"
              className={INPUT_CLASS}
              value={form.parentEmail}
              onChange={(e) => update("parentEmail", e.target.value)}
              aria-invalid={!!errors.parentEmail}
              data-testid="field-parent-email"
              placeholder="nama@contoh.com"
            />
            <FieldDescription>
              Isi email agar formulir pendaftaran lengkap bisa kami kirimkan.
              Konfirmasi pendaftaran juga dikirim ke sini.
            </FieldDescription>
            {errors.parentEmail && <FieldError>{errors.parentEmail}</FieldError>}
          </Field>
        </div>
      )}

      {step === 3 && (
        <div data-testid="daftar-step-3" className="space-y-5">
          {programs.length > 0 && (
            <Field>
              <FieldLabel htmlFor="programId">
                Program yang Diminati{" "}
                <span className="font-normal text-muted-foreground">(opsional)</span>
              </FieldLabel>
              <NativeSelect
                id="programId"
                name="programId"
                value={form.programId}
                onChange={(e) => update("programId", e.target.value)}
                className="w-full"
                selectClassName={SELECT_CLASS}
                data-testid="field-program-id"
              >
                <NativeSelectOption value="">— Pilih program —</NativeSelectOption>
                {programs.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="notes">
              Catatan untuk Sekolah{" "}
              <span className="font-normal text-muted-foreground">(opsional)</span>
            </FieldLabel>
            <Textarea
              id="notes"
              name="notes"
              rows={4}
              maxLength={500}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              aria-invalid={!!errors.notes}
              className="px-3 py-2.5 text-base md:text-base"
              data-testid="field-notes"
              placeholder="Misal: ananda sudah pernah ikut kelas trial, atau saudara sudah bersekolah di sini."
            />
            <FieldDescription>
              {form.notes.length}/500 karakter
            </FieldDescription>
            {errors.notes && <FieldError>{errors.notes}</FieldError>}
          </Field>
        </div>
      )}

      {globalError && (
        <p
          role="alert"
          data-testid="daftar-global-error"
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {globalError}
        </p>
      )}

      {step === 3 && (
        <p className="mt-5 text-sm text-muted-foreground" data-testid="daftar-consent">
          Dengan mengirim, Anda menyetujui{" "}
          <Link href="/legal/privacy" className="text-primary-text underline underline-offset-2">
            Kebijakan Privasi
          </Link>{" "}
          dan{" "}
          <Link href="/legal/terms" className="text-primary-text underline underline-offset-2">
            Syarat &amp; Ketentuan
          </Link>
          .
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {step > 1 ? (
          <Button
            type="button"
            variant="outline"
            onClick={prevStep}
            className="h-11 px-5 text-base"
            data-testid="daftar-back"
            disabled={submitting}
          >
            Kembali
          </Button>
        ) : (
          <span />
        )}

        {step < 3 ? (
          <Button type="submit" className="h-11 px-5 text-base" data-testid="daftar-next">
            Lanjut
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={submitting}
            className="h-11 px-5 text-base"
            data-testid="daftar-submit"
          >
            {submitting ? "Mengirim..." : "Kirim Pendaftaran"}
          </Button>
        )}
      </div>
    </form>
  );
}

function Stepper({ step }: { step: Step }) {
  const items: { step: Step; label: string }[] = [
    { step: 1, label: "Data Anak" },
    { step: 2, label: "Data Orang Tua" },
    { step: 3, label: "Preferensi" },
  ];
  const pct = ((step - 1) / (items.length - 1)) * 100;
  return (
    <div className="mb-6 space-y-2">
      <Progress value={pct} aria-label={`Langkah ${step} dari ${items.length}`} />
      <ol
        aria-label="Langkah pendaftaran"
        className="flex items-center justify-between text-xs"
      >
        {items.map((item) => {
          const active = item.step === step;
          const done = item.step < step;
          return (
            <li key={item.step} className="flex items-center gap-1.5">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                  done
                    ? "bg-primary text-primary-foreground"
                    : active
                      ? "border border-primary text-primary"
                      : "border border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : item.step}
              </span>
              <span
                className={cn(
                  "truncate",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
