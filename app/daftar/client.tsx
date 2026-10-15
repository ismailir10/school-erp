"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PHONE_FORMAT_ERROR, admissionDobBounds, admissionDobError } from "@/lib/validations/admission";
import { CONTACT_REQUIRED_ERROR, PHONE_REGEX } from "@/lib/admission/submit-validation";
import { clearDraft, formatAdmissionRef, loadDraft, saveDraft, type DraftForm } from "./draft";

type Program = { id: string; name: string };
type FieldErrors = Record<string, string>;
type FormState = DraftForm;

const EMPTY_FORM: FormState = {
  parentName: "",
  parentRelationship: "",
  parentPhone: "",
  parentEmail: "",
  childName: "",
  dateOfBirth: "",
  childGender: "",
  programId: "",
  notes: "",
};

// The optional child block opens by itself when it holds data or an error.
const CHILD_KEYS = ["childName", "dateOfBirth", "childGender", "programId"] as const;

// Phone uses the server's own regex (PHONE_REGEX). The email check is a looser
// UX convenience; the trust boundary remains the server schema.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public-form controls: 44px tall, 16px text (also stops iOS zooming on focus).
// Scoped here via className — the shared Input/NativeSelect stay at h-8 for the
// dense admin screens.
// Placeholders are dimmed below entered text so an example never reads as an
// already-typed value (cn/tailwind-merge lets this beat the shared default).
const PLACEHOLDER_CLASS = "placeholder:text-muted-foreground/70";
const INPUT_CLASS = cn("h-11 px-3 text-base md:text-base", PLACEHOLDER_CLASS);
const SELECT_CLASS = "h-11 pl-3 text-base";
// Primary CTA: --primary (#5DB4B8) is a fill colour that reads pale/disabled
// with dark text; --primary-text (#2F7A7D) carries white text at >= 4.5:1.
const CTA_CLASS = "h-12 w-full bg-primary-text px-5 text-base text-white hover:bg-primary-text/90";

type SubmitOk = { id: string };
type SubmitErr =
  | { error: "validation_failed"; fields: FieldErrors }
  | { error: "rate_limited" }
  | { error: "submit_failed" };

// Top-to-bottom order of the fields, and the input each error key points at
// (the contact error sits on the phone field, the first of the two).
const FOCUS_ORDER = [
  "parentName",
  "parentRelationship",
  "parentPhone",
  "parentEmail",
  "contact",
  "childName",
  "dateOfBirth",
  "childGender",
  "programId",
  "notes",
] as const;
const FOCUS_TARGET: Record<(typeof FOCUS_ORDER)[number], string> = {
  parentName: "parentName",
  parentRelationship: "parentRelationship",
  parentPhone: "parentPhone",
  parentEmail: "parentEmail",
  contact: "parentPhone",
  childName: "childName",
  dateOfBirth: "dateOfBirth",
  childGender: "childGender-L",
  programId: "programId",
  notes: "notes",
};

const hasChildData = (f: FormState) => CHILD_KEYS.some((key) => f[key] !== "");

export default function DaftarClient({ programs }: { programs: Program[] }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [childOpen, setChildOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    parentName: string;
    emailed: boolean;
  } | null>(null);
  // Draft restore runs after mount (sessionStorage is client-only); persisting
  // waits for it so the empty first render can't overwrite a stored draft.
  const [draftReady, setDraftReady] = useState(false);
  const [dobBounds] = useState(() => admissionDobBounds());
  // Field to focus once the next render has put it (and the child block) in the DOM.
  const focusAfterRender = useRef<string | null>(null);

  useEffect(() => {
    const draft = loadDraft(EMPTY_FORM);
    if (draft) {
      setForm(draft.form);
      if (hasChildData(draft.form)) setChildOpen(true);
    }
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady || confirmation) return;
    saveDraft({ form });
  }, [draftReady, confirmation, form]);

  // aria-describedby for a field: its own error (when shown) plus any extra ids.
  function describedBy(key: string, ...extra: string[]) {
    return [errors[key] ? `${key}-error` : null, ...extra].filter(Boolean).join(" ") || undefined;
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // Editing either contact field clears the shared "pick one" error too.
    const cleared = key === "parentPhone" || key === "parentEmail" ? [key, "contact"] : [key];
    if (cleared.some((k) => errors[k])) {
      setErrors((e) => {
        const next = { ...e };
        for (const k of cleared) delete next[k];
        return next;
      });
    }
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    const phone = form.parentPhone.trim();
    const email = form.parentEmail.trim();
    if (!form.parentName.trim()) errs.parentName = "Nama orang tua wajib diisi";
    if (phone && !PHONE_REGEX.test(phone)) errs.parentPhone = PHONE_FORMAT_ERROR;
    if (email && !EMAIL_RE.test(email)) errs.parentEmail = "Email tidak valid";
    if (!phone && !email) errs.contact = CONTACT_REQUIRED_ERROR;
    if (form.dateOfBirth) {
      const dobError = admissionDobError(form.dateOfBirth);
      if (dobError) errs.dateOfBirth = dobError;
    }
    return errs;
  }

  function showErrors(errs: FieldErrors) {
    setErrors(errs);
    if (CHILD_KEYS.some((key) => errs[key])) setChildOpen(true);
    const first = FOCUS_ORDER.find((key) => errs[key]);
    if (first) focusAfterRender.current = FOCUS_TARGET[first];
  }

  // Runs after the render that shows the errors (and opens the child block).
  useEffect(() => {
    const id = focusAfterRender.current;
    if (!id) return;
    focusAfterRender.current = null;
    // The child block mounts its content a frame late, so retry briefly.
    let tries = 0;
    let raf = 0;
    const tryFocus = () => {
      const el = document.getElementById(id);
      if (el) el.focus();
      else if (tries++ < 10) raf = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(raf);
  }, [errors]);

  async function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length) {
      showErrors(errs);
      return;
    }
    setErrors({});

    setSubmitting(true);
    setGlobalError(null);

    // Only what the family filled in — the server treats "" as absent anyway.
    const payload = {
      parentName: form.parentName,
      ...(form.parentRelationship ? { parentRelationship: form.parentRelationship } : {}),
      ...(form.parentPhone.trim() ? { parentPhone: form.parentPhone } : {}),
      ...(form.parentEmail.trim() ? { parentEmail: form.parentEmail } : {}),
      ...(form.childName.trim() ? { childName: form.childName } : {}),
      ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
      ...(form.childGender ? { childGender: form.childGender } : {}),
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
        setConfirmation({
          id: ok.id,
          parentName: form.parentName.trim(),
          emailed: form.parentEmail.trim() !== "",
        });
        return;
      }

      const body = (await res.json().catch(() => null)) as SubmitErr | null;

      if (res.status === 400 && body?.error === "validation_failed") {
        showErrors(body.fields ?? {});
        setGlobalError("Mohon periksa kembali isian yang ditandai.");
        return;
      }

      if (res.status === 429) {
        setGlobalError(
          "Terlalu banyak permintaan dari jaringan ini. Silakan coba lagi dalam satu menit.",
        );
        return;
      }

      setGlobalError("Data belum terkirim. Silakan coba kembali.");
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
    setChildOpen(false);
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
          Terima kasih,{" "}
          <span data-testid="confirmation-parent-name">{confirmation.parentName}</span>
        </h2>
        <p className="mt-3 text-sm text-muted-foreground sm:text-base">
          Data Bapak/Ibu sudah tercatat. Insya Allah tim kami akan menghubungi dalam 1–3 hari kerja
          untuk menjadwalkan kunjungan.
          {confirmation.emailed ? " Konfirmasi juga kami kirim ke email Bapak/Ibu." : ""}
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
        handleSubmit();
      }}
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8"
    >
      <div className="space-y-5">
        <Field>
          <FieldLabel htmlFor="parentName" required>Nama orang tua</FieldLabel>
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
            aria-describedby={describedBy("parentName")}
            data-testid="field-parent-name"
            placeholder="Ibu Fatimah Az-Zahra"
          />
          {errors.parentName && <FieldError id="parentName-error">{errors.parentName}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor="parentRelationship">
            Hubungan dengan anak{" "}
            <span className="font-normal text-muted-foreground">(opsional)</span>
          </FieldLabel>
          <NativeSelect
            id="parentRelationship"
            name="parentRelationship"
            value={form.parentRelationship}
            onChange={(e) => update("parentRelationship", e.target.value as FormState["parentRelationship"])}
            className="w-full"
            selectClassName={cn(SELECT_CLASS, form.parentRelationship === "" && "text-muted-foreground/70")}
            aria-invalid={!!errors.parentRelationship}
            aria-describedby={describedBy("parentRelationship")}
            data-testid="field-parent-relationship"
          >
            <NativeSelectOption value="">— Pilih —</NativeSelectOption>
            <NativeSelectOption value="AYAH">Ayah</NativeSelectOption>
            <NativeSelectOption value="IBU">Ibu</NativeSelectOption>
            <NativeSelectOption value="WALI">Wali</NativeSelectOption>
          </NativeSelect>
          {errors.parentRelationship && (
            <FieldError id="parentRelationship-error">{errors.parentRelationship}</FieldError>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="parentPhone">No. HP/WhatsApp</FieldLabel>
          <Input
            id="parentPhone"
            name="parentPhone"
            type="tel"
            autoComplete="tel"
            maxLength={20}
            className={INPUT_CLASS}
            value={form.parentPhone}
            onChange={(e) => update("parentPhone", e.target.value)}
            aria-invalid={!!errors.parentPhone || !!errors.contact}
            aria-describedby={describedBy("parentPhone", ...(errors.contact ? ["contact-error"] : []), "contact-hint")}
            data-testid="field-parent-phone"
            placeholder="0812-3456-7890"
          />
          {errors.parentPhone && <FieldError id="parentPhone-error">{errors.parentPhone}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor="parentEmail">Email</FieldLabel>
          <Input
            id="parentEmail"
            name="parentEmail"
            type="email"
            autoComplete="email"
            className={INPUT_CLASS}
            value={form.parentEmail}
            onChange={(e) => update("parentEmail", e.target.value)}
            maxLength={254}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={!!errors.parentEmail || !!errors.contact}
            aria-describedby={describedBy("parentEmail", ...(errors.contact ? ["contact-error"] : []), "contact-hint")}
            data-testid="field-parent-email"
            placeholder="nama@contoh.com"
          />
          {errors.parentEmail && <FieldError id="parentEmail-error">{errors.parentEmail}</FieldError>}
          <FieldDescription id="contact-hint" data-testid="daftar-contact-hint">
            Isi salah satu atau keduanya. Dengan email, formulir pendaftaran bisa langsung kami
            kirimkan.
          </FieldDescription>
          {errors.contact && (
            <FieldError id="contact-error" data-testid="error-contact">{errors.contact}</FieldError>
          )}
        </Field>

        <Collapsible open={childOpen} onOpenChange={setChildOpen}>
          <CollapsibleTrigger
            data-testid="daftar-child-toggle"
            className="flex min-h-12 w-full items-center justify-between rounded-lg border border-border bg-background px-4 text-left text-base font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>
              Data anak{" "}
              <span className="font-normal text-muted-foreground">(opsional)</span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn("size-4 transition-transform", childOpen && "rotate-90")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent data-testid="daftar-child-section" className="space-y-5 pt-5">
            <Field>
              <FieldLabel htmlFor="childName">Nama anak</FieldLabel>
              <Input
                id="childName"
                name="childName"
                autoComplete="off"
                maxLength={80}
                className={INPUT_CLASS}
                value={form.childName}
                onChange={(e) => update("childName", e.target.value)}
                aria-invalid={!!errors.childName}
                aria-describedby={describedBy("childName")}
                data-testid="field-child-name"
                placeholder="Aisyah Putri"
              />
              {errors.childName && <FieldError id="childName-error">{errors.childName}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="dateOfBirth">Tanggal lahir</FieldLabel>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                min={dobBounds.min}
                max={dobBounds.max}
                className={INPUT_CLASS}
                value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)}
                aria-invalid={!!errors.dateOfBirth}
                aria-describedby={describedBy("dateOfBirth")}
                data-testid="field-date-of-birth"
              />
              {errors.dateOfBirth && <FieldError id="dateOfBirth-error">{errors.dateOfBirth}</FieldError>}
            </Field>

            <Field>
              <FieldLabel id="childGender-label">Jenis kelamin</FieldLabel>
              <RadioGroup
                value={form.childGender}
                onValueChange={(value) => update("childGender", value as "L" | "P")}
                aria-labelledby="childGender-label"
                aria-invalid={!!errors.childGender}
                aria-describedby={describedBy("childGender")}
                className="grid grid-cols-2 gap-3"
              >
                {[
                  { value: "L", label: "Laki-laki" },
                  { value: "P", label: "Perempuan" },
                ].map((opt) => (
                  <FieldLabel
                    key={opt.value}
                    htmlFor={`childGender-${opt.value}`}
                    className={cn(
                      "flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-base font-medium transition-colors",
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
              {errors.childGender && <FieldError id="childGender-error">{errors.childGender}</FieldError>}
            </Field>

            {programs.length > 0 && (
              <Field>
                <FieldLabel htmlFor="programId">Program yang diminati</FieldLabel>
                <NativeSelect
                  id="programId"
                  name="programId"
                  value={form.programId}
                  onChange={(e) => update("programId", e.target.value)}
                  className="w-full"
                  selectClassName={cn(SELECT_CLASS, form.programId === "" && "text-muted-foreground/70")}
                  aria-invalid={!!errors.programId}
                  aria-describedby={describedBy("programId")}
                  data-testid="field-program-id"
                >
                  <NativeSelectOption value="">— Pilih program —</NativeSelectOption>
                  {programs.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {errors.programId && <FieldError id="programId-error">{errors.programId}</FieldError>}
              </Field>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Field>
          <FieldLabel htmlFor="notes">
            Catatan untuk sekolah{" "}
            <span className="font-normal text-muted-foreground">(opsional)</span>
          </FieldLabel>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            maxLength={500}
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            aria-invalid={!!errors.notes}
            aria-describedby={describedBy("notes")}
            className={cn("px-3 py-2.5 text-base md:text-base", PLACEHOLDER_CLASS)}
            data-testid="field-notes"
            placeholder="Misal: ingin tahu biaya, atau saudara sudah bersekolah di sini."
          />
          <FieldDescription>
            {form.notes.length}/500 karakter
          </FieldDescription>
          {errors.notes && <FieldError id="notes-error">{errors.notes}</FieldError>}
        </Field>
      </div>

      {globalError && (
        <p
          role="alert"
          data-testid="daftar-global-error"
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {globalError}
        </p>
      )}

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

      <div className="mt-6">
        <Button
          type="submit"
          disabled={submitting}
          className={CTA_CLASS}
          data-testid="daftar-submit"
        >
          {submitting ? "Mengirim..." : "Kirim Pertanyaan"}
        </Button>
      </div>
    </form>
  );
}
