"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormRootError } from "@/components/ui/form";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { ClassSectionCombobox, type ClassSection } from "@/components/admin/class-section-picker";
import { enrollStudentFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { ApiError } from "@/lib/api/client-errors";

/**
 * Enroll overlay for the student detail page.
 *
 * Extracted from the page for a concrete reason, not tidiness: the picker and
 * the override-reason textarea used to hold their state on the page component,
 * so every keystroke re-rendered the entire dossier — eight collapsible
 * sections, every wali card, the rail. Measured on the T7 test, typing a
 * 32-character reason went from 821 ms to over 5 s once the dossier layout
 * landed. Owning that state here confines a keystroke to this subtree.
 *
 * Behaviour is unchanged from the in-page version:
 *   picker → (409) advisory confirm step
 * AGE_OUT_OF_RANGE is overridable with a required reason; ALREADY_ENROLLED is
 * not. Three mutually-exclusive steps share one ResponsiveFormDialog instance
 * (Dialog on desktop, Sheet on mobile, per ui.md's Overlays Rule).
 */
export function StudentEnrollDialog({
  studentId,
  open,
  onOpenChange,
  onEnrolled,
}: {
  studentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful enroll so the page can refetch. */
  onEnrolled: () => void;
  /**
   * @deprecated No longer read. `ResponsiveFormDialog` now owns the
   * desktop/mobile breakpoint switch itself (frozen while open, same as
   * every other admin form dialog), so the caller no longer needs to
   * compute and forward this. Kept optional so an existing caller passing
   * it still type-checks without an unrelated prop-drop diff.
   */
  isMobile?: boolean;
}) {
  const formId = useId();
  const [sections, setSections] = useState<ClassSection[]>([]);
  const form = useZodForm(enrollStudentFormSchema, {
    defaultValues: { classSectionId: "", ageOverrideReason: "" },
  });
  // Populated from the 409 the server returns; cleared whenever the overlay
  // closes or a different class is picked, so a stale reason can never ride
  // along on an unrelated submit.
  const [enrollBlock, setEnrollBlock] = useState<
    | { code: "AGE_OUT_OF_RANGE"; message: string }
    | { code: "ALREADY_ENROLLED"; message: string }
    | null
  >(null);
  const ageOverrideReason = form.watch("ageOverrideReason");
  const enrollBannerRef = useRef<HTMLDivElement | null>(null);

  /**
   * Move focus to the 409 advisory once it exists. It replaces the picker in
   * place, so nothing else marks that the form changed.
   *
   * An effect, not `setTimeout(…, 0)` from the 409 handler: the macrotask can
   * run before React commits the banner, leaving the ref null and the focus
   * silently dropped with nothing to retry it. Same defect fixed in
   * `app/admin/classes/[id]/client.tsx` — see
   * `docs/cycles/2026-08-22-vitest-flake-fix.md`.
   */
  useEffect(() => {
    if (!enrollBlock) return;
    enrollBannerRef.current?.focus();
  }, [enrollBlock]);

  // Load the class list when the overlay opens, and reset every step at the
  // same time — the single choke point every open path routes through.
  useEffect(() => {
    if (!open) return;
    form.reset({ classSectionId: "", ageOverrideReason: "" });
    setEnrollBlock(null);
    let cancelled = false;
    (async () => {
      try {
        // Scope to the current + upcoming academic year — archived-year classes
        // are not valid enroll targets (server also 403s them as YEAR_ARCHIVED).
        const res = await fetch("/api/class-sections?yearStatus=ACTIVE,PLANNING");
        if (!res.ok) {
          if (!cancelled) toast.error(MESSAGES.loadFailed("Data kelas"));
          return;
        }
        const data = await res.json();
        if (!cancelled) setSections(data);
      } catch {
        if (!cancelled) toast.error(MESSAGES.generic);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `form` (react-hook-form's returned object) is referentially stable —
    // omitted the same way app/admin/settings/campuses/page.tsx omits it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Steps back from the confirm step to the picker without closing. */
  const cancelEnrollBlock = useCallback(() => {
    setEnrollBlock(null);
    form.setValue("ageOverrideReason", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnroll = form.handleSubmit(async (values) => {
    const overridingAge = enrollBlock?.code === "AGE_OUT_OF_RANGE";
    if (overridingAge && !values.ageOverrideReason?.trim()) return; // confirm button is disabled for this too — defensive only
    try {
      const res = await fetch(`/api/students/${studentId}/enroll`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classSectionId: values.classSectionId,
          ...(overridingAge ? { ageOverrideReason: values.ageOverrideReason } : {}),
        }),
      });
      if (res.ok) {
        toast.success("Didaftarkan ke kelas");
        onOpenChange(false);
        onEnrolled();
        return;
      }
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && (d.code === "AGE_OUT_OF_RANGE" || d.code === "ALREADY_ENROLLED")) {
        // Advisory step, not a toast — the server message already names the
        // age/band/reference date (AGE_OUT_OF_RANGE) or the conflicting
        // class (ALREADY_ENROLLED); render it verbatim rather than
        // rebuilding the sentence client-side.
        // Focus moves to the banner in the effect below, once React has
        // committed it.
        setEnrollBlock({ code: d.code, message: d.error });
        return;
      }
      // Every other failure (validation the server itself rejected, a 500,
      // a route the client didn't anticipate) goes through the same
      // field-error-or-FormRootError path every other migrated form uses,
      // instead of a bare toast.
      applyServerErrors(
        form,
        new ApiError(d.error || "Gagal mendaftarkan", {
          fieldErrors: Array.isArray(d.errors) ? d.errors : [],
          status: res.status,
        }),
        "Gagal mendaftarkan",
      );
    } catch (err) {
      applyServerErrors(form, err, MESSAGES.network);
    }
  });

  const enrolling = form.formState.isSubmitting;
  const overridingAge = enrollBlock?.code === "AGE_OUT_OF_RANGE";
  const alreadyEnrolled = enrollBlock?.code === "ALREADY_ENROLLED";
  const reasonEmpty = !(ageOverrideReason as string | undefined)?.trim();

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (alreadyEnrolled) {
    body = (
      <Alert ref={enrollBannerRef} tabIndex={-1} variant="destructive">
        <AlertTitle>Siswa sudah terdaftar</AlertTitle>
        <AlertDescription>{enrollBlock.message}</AlertDescription>
      </Alert>
    );
    footer = <Button type="button" variant="ghost" onClick={cancelEnrollBlock}>Pilih Kelas Lain</Button>;
  } else if (overridingAge) {
    body = (
      <div className="space-y-field">
        <Alert ref={enrollBannerRef} tabIndex={-1}>
          <AlertTitle>Usia di luar batas program</AlertTitle>
          <AlertDescription>{enrollBlock.message}</AlertDescription>
        </Alert>
        <FormField
          control={form.control}
          name="ageOverrideReason"
          label="Alasan"
          required
          id="enroll-age-override-reason"
          description="Alasan wajib diisi sebelum melanjutkan."
          render={({ field, controlProps }) => (
            <Textarea
              {...field}
              {...controlProps}
              value={(field.value as string | undefined) ?? ""}
              placeholder="Contoh: penempatan sesuai kemampuan anak, atau anak telat masuk sekolah"
              rows={3}
            />
          )}
        />
      </div>
    );
    footer = (
      <>
        <Button type="button" variant="ghost" onClick={cancelEnrollBlock} disabled={enrolling}>Batal</Button>
        <Button type="submit" form={formId} disabled={enrolling || reasonEmpty}>{enrolling ? "Mendaftarkan..." : "Tetap Daftarkan"}</Button>
      </>
    );
  } else {
    body = (
      <FormField
        control={form.control}
        name="classSectionId"
        label="Pilih Kelas"
        required
        id="enroll-class-section"
        render={({ field, controlProps }) => (
          <ClassSectionCombobox
            id={controlProps.id}
            sections={sections}
            value={(field.value as string | undefined) ?? ""}
            onChange={(v) => { field.onChange(v); setEnrollBlock(null); form.setValue("ageOverrideReason", ""); }}
            placeholder="Pilih kelas..."
          />
        )}
      />
    );
    footer = (
      <>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={enrolling}>Batal</Button>
        <Button type="submit" form={formId} disabled={enrolling}>{enrolling ? "Mendaftarkan..." : "Daftarkan"}</Button>
      </>
    );
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={(o) => !enrolling && onOpenChange(o)}
      title="Daftarkan ke Kelas"
      size="lg"
      footer={footer}
    >
      <form id={formId} onSubmit={handleEnroll} noValidate className="space-y-field">
        <FormRootError formState={form.formState} />
        {body}
      </form>
    </ResponsiveFormDialog>
  );
}
