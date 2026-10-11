"use client";

import { useState } from "react";
import { useFormState, useWatch, type Control } from "react-hook-form";
import type * as z4 from "zod/v4/core";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import type { ControllerRenderProps } from "react-hook-form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { buttonVariants } from "@/components/ui/button";
import { FormField, type FormControlProps } from "@/components/ui/form";
import { formatAgeFromDob } from "@/lib/admission/age";
import { createAdmissionSchema } from "@/lib/validations/admission";
import type { Program } from "./types";

// ------------------------------------------------------------------
// Form body (shared between Dialog on desktop and Sheet on mobile, and
// between "Catat Pertanyaan" and edit). A lead is who + how to reach them;
// the child's details sit in a collapsed section and are all optional
// (cycle 2026-10-11-pendaftaran-simplify).
// ------------------------------------------------------------------

export type AdmissionFormValues = z4.input<typeof createAdmissionSchema>;
export type AdmissionFormOutput = z4.output<typeof createAdmissionSchema>;

export const EMPTY_ADMISSION_FORM: AdmissionFormValues = {
  parentName: "",
  parentRelationship: "",
  parentPhone: "",
  parentWhatsapp: "",
  parentEmail: "",
  childName: "",
  dateOfBirth: "",
  childGender: "",
  programId: "",
  notes: "",
};

/** Sentinel for the "no choice" row of an optional Select, so a chosen value can be cleared. */
const NO_CHOICE = "__none";

// Ayah / Ibu / Wali, as the lead form offers them. `OTHER` is still accepted by the API.
const RELATIONSHIPS = [
  { value: "AYAH", label: "Ayah" },
  { value: "IBU", label: "Ibu" },
  { value: "WALI", label: "Wali" },
] as const;

/**
 * An optional single-choice field: a "Belum dipilih" row on top lets a chosen
 * value be cleared again (the form stores "" for it).
 */
function OptionalSelect({
  field,
  controlProps,
  options,
}: {
  field: Pick<ControllerRenderProps, "value" | "onChange" | "onBlur">;
  controlProps: FormControlProps;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <Select
      value={(field.value as string | undefined) || NO_CHOICE}
      onValueChange={(v) => v != null && field.onChange(v === NO_CHOICE ? "" : v)}
      items={[{ value: NO_CHOICE, label: "Belum dipilih" }, ...options]}
    >
      <SelectTrigger {...controlProps} onBlur={field.onBlur}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CHOICE}>Belum dipilih</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const CHILD_FIELDS = ["childName", "dateOfBirth", "childGender", "programId"] as const;

export type AdmissionFormBodyProps = {
  control: Control<AdmissionFormValues, unknown, AdmissionFormOutput>;
  programs: Program[];
};

export function AdmissionFormBody({ control, programs }: AdmissionFormBodyProps) {
  const dateOfBirth = useWatch({ control, name: "dateOfBirth" }) as string | undefined;
  const childValues = useWatch({ control, name: [...CHILD_FIELDS] });
  const { errors } = useFormState({ control });
  const hasChildData = childValues.some((v) => typeof v === "string" && v.trim() !== "");
  const hasChildError = CHILD_FIELDS.some((f) => errors[f]);
  // Starts open for a lead that already has child data (edit); opens when a child field fails
  // validation, but the user can still close it afterwards.
  const [childOpen, setChildOpen] = useState(hasChildData);
  // Adjust during render (not in an effect) when an error appears, so the user can still close it after.
  const [sawChildError, setSawChildError] = useState(hasChildError);
  if (hasChildError !== sawChildError) {
    setSawChildError(hasChildError);
    if (hasChildError) setChildOpen(true);
  }

  return (
    <>
      <FormField
        control={control}
        name="parentName"
        label="Nama orang tua"
        required
        id="admission-parentName"
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} placeholder="Ibu Fatimah" />
        )}
      />
      <FormField
        control={control}
        name="parentRelationship"
        label="Hubungan dengan anak"
        id="admission-parentRelationship"
        render={({ field, controlProps }) => (
          <OptionalSelect
            field={field}
            controlProps={controlProps}
            // `OTHER` is still valid for the API; offer it only when the lead already has it.
            options={(field.value as string | undefined) === "OTHER" ? [...RELATIONSHIPS, { value: "OTHER", label: "Lainnya" }] : RELATIONSHIPS}
          />
        )}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={control}
          name="parentPhone"
          label="No. HP"
          id="admission-parentPhone"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              type="tel"
              inputMode="tel"
              value={(field.value as string | undefined) ?? ""}
              placeholder="081234567890"
            />
          )}
        />
        <FormField
          control={control}
          name="parentWhatsapp"
          label="WhatsApp"
          id="admission-parentWhatsapp"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              type="tel"
              inputMode="tel"
              value={(field.value as string | undefined) ?? ""}
              placeholder="081234567890"
            />
          )}
        />
      </div>
      <FormField
        control={control}
        name="parentEmail"
        label="Email"
        id="admission-parentEmail"
        description="Isi minimal satu kontak: No. HP, WhatsApp atau Email."
        render={({ field, controlProps }) => (
          <Input
            {...field}
            {...controlProps}
            type="email"
            value={(field.value as string | undefined) ?? ""}
            placeholder="email@contoh.com"
          />
        )}
      />
      <Collapsible open={childOpen} onOpenChange={setChildOpen} className="rounded-lg border border-border">
        <CollapsibleTrigger
          className={buttonVariants({ variant: "ghost", className: "group min-h-11 w-full justify-between rounded-lg px-3" })}
        >
          Data anak (opsional)
          <ChevronRight aria-hidden="true" className="size-4 group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted className="space-y-field px-3 pb-3 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={control}
              name="childName"
              label="Nama anak"
              id="admission-childName"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Aisyah" />
              )}
            />
            <FormField
              control={control}
              name="dateOfBirth"
              label="Tanggal lahir"
              id="admission-dateOfBirth"
              description={dateOfBirth ? `Usia: ${formatAgeFromDob(dateOfBirth) ?? "—"}` : undefined}
              render={({ field, controlProps }) => (
                <DatePicker
                  {...controlProps}
                  value={(field.value as string | undefined) ?? ""}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={control}
              name="childGender"
              label="Jenis kelamin"
              id="admission-childGender"
              render={({ field, controlProps }) => (
                <OptionalSelect
                  field={field}
                  controlProps={controlProps}
                  options={[{ value: "L", label: "Laki-laki" }, { value: "P", label: "Perempuan" }]}
                />
              )}
            />
            <FormField
              control={control}
              name="programId"
              label="Program diminati"
              id="admission-programId"
              render={({ field, controlProps }) => (
                <OptionalSelect
                  field={field}
                  controlProps={controlProps}
                  options={programs.map((p) => ({ value: p.id, label: p.name }))}
                />
              )}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      <FormField
        control={control}
        name="notes"
        label="Catatan"
        id="admission-notes"
        render={({ field, controlProps }) => (
          <Input
            {...field}
            {...controlProps}
            value={(field.value as string | undefined) ?? ""}
            placeholder="Catatan tambahan..."
          />
        )}
      />
    </>
  );
}
