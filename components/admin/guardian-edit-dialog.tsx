/**
 * Shared guardian / parent edit form body.
 *
 * Three admin surfaces edit the same Parent record from different entry points:
 *
 *   1. app/admin/students/[id]/page.tsx     (Student detail → guardian dialog)
 *   2. app/admin/guardians/page.tsx         (Guardians list → row edit dialog)
 *   3. app/admin/guardians/[id]/page.tsx    (Guardian detail → inline edit)
 *
 * Before T7 each surface shipped its own form body with subtly different
 * field sets — most notably `childrenTotal` and `address` were absent from
 * the student-detail guardian dialog, so any edit from that surface SILENTLY
 * DROPPED both fields even though the schema accepts them. This component is
 * the single source of truth for the field set + section layout.
 *
 * T3 (2026-09-27, admin-finish-standard): moved off a `form`/`setForm` prop
 * contract onto react-hook-form. `GuardianFormBody` now takes an RHF
 * `control`, generic over whatever form-values type the caller's schema
 * produces, and renders every field with `FormField` (inline errors, ids
 * unchanged). All three callers pass their own `useZodForm(...).control`.
 *
 * Responsibility split:
 *   - This component owns the form fields, the section break (Data Pekerjaan),
 *     and the canonical Select option sources.
 *   - The page owns the Dialog/Sheet shell, open/close state, save handler,
 *     and the desktop-vs-mobile shell switch via useIsMobile.
 *
 * `showRelationship` toggles the StudentGuardian junction fields (Hubungan,
 * Anak ke-, Wali Utama) — set only on the student-detail entry point, which
 * owns the student↔guardian link. Parent-level entry points (guardians list,
 * guardian detail) render `showRelationship={false}`: the same parent can
 * hold a different relationship/position across siblings, so those fields
 * belong to the link, not the Parent record this form body edits.
 */

import { useWatch, type Control, type FieldValues } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FormField } from "@/components/ui/form";
import {
  EDUCATION_OPTIONS,
  OCCUPATION_OPTIONS,
  INCOME_OPTIONS,
  RELATIONSHIP_OPTIONS,
  REL_LABELS,
} from "@/lib/constants/parent-options";

export type GuardianForm = {
  name: string;
  relationship: string;
  phone: string;
  whatsapp: string;
  email: string;
  parentNik: string;
  education: string;
  occupation: string;
  incomeRange: string;
  employer: string;
  employerAddress: string;
  employerCity: string;
  childrenTotal: string;
  address: string;
  // Per-StudentGuardian junction fields. Editable only on entry points that
  // own the student↔guardian link (student detail). On Parent-level entry
  // points (guardians list, guardian detail) these stay out of the form via
  // `showRelationship={false}`, which also hides the junction row.
  childOrder: string;
  isPrimary: boolean;
};

export const EMPTY_GUARDIAN_FORM: GuardianForm = {
  name: "",
  relationship: "WALI",
  phone: "",
  whatsapp: "",
  email: "",
  parentNik: "",
  education: "",
  occupation: "",
  incomeRange: "",
  employer: "",
  employerAddress: "",
  employerCity: "",
  childrenTotal: "",
  address: "",
  childOrder: "",
  isPrimary: false,
};

/**
 * FIND-010: the server only defaults isPrimary from the sibling count
 * (`resolvedIsPrimary = isPrimary ?? priorGuardianCount === 0` in
 * app/api/students/[id]/guardians/route.ts) when the key is absent from the
 * body. A CREATE form's `isPrimary` display state starts `false` for the
 * Switch, so sending the parsed form straight through on CREATE always sent
 * an explicit `false` and defeated that default — a student's first guardian
 * landed non-primary. CREATE call sites must use this helper instead of
 * spreading the parsed values directly; the EDIT (PUT) path is unaffected
 * and keeps sending isPrimary as-is since demoting via the Switch is
 * legitimate there.
 *
 * Generic over any object carrying `isPrimary?: boolean` — not just the
 * legacy `GuardianForm` shape — so the RHF-parsed output of
 * `guardianCreateFormSchema` (students/[id]'s create step) can reuse it too.
 */
export function guardianCreatePayload<T extends { isPrimary?: boolean }>(
  form: T,
): Omit<T, "isPrimary"> & { isPrimary?: true } {
  const { isPrimary, ...rest } = form;
  return isPrimary ? { ...rest, isPrimary: true } : rest;
}

/**
 * The field set every caller's form-values type must carry (as optional —
 * different schemas parse each into slightly different runtime types: a
 * string while still un-submitted, a coerced number/null once parsed).
 * `relationship`/`childOrder`/`isPrimary` are the StudentGuardian junction
 * fields, only ever populated (and only ever rendered) when the caller's
 * schema/control includes them and `showRelationship` is true.
 */
export type GuardianFieldValues = {
  name?: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  parentNik?: string | null;
  education?: string | null;
  occupation?: string | null;
  incomeRange?: string | null;
  employer?: string | null;
  employerAddress?: string | null;
  employerCity?: string | null;
  childrenTotal?: string | number | null;
  relationship?: string;
  childOrder?: string | number | null;
  isPrimary?: boolean;
};

export function GuardianFormBody<
  TValues extends GuardianFieldValues & FieldValues,
  TTransformed extends FieldValues = TValues,
>({
  control,
  showRelationship = true,
}: {
  // Threaded the same way `FormField` (components/ui/form.tsx) declares its
  // own `control` prop: `useZodForm`'s `Control` carries a real
  // `TTransformedValues` (the schema's parsed output), and defaulting it away
  // (as a bare `Control<TValues>` would) stops a caller's control type from
  // structurally matching what this component hands to `FormField` below.
  control: Control<TValues, unknown, TTransformed>;
  /**
   * Relationship belongs to the StudentGuardian junction, not the Parent. Set
   * to false on Parent-level entry points (guardians list, guardian detail)
   * where the same parent can hold different relationships across siblings.
   */
  showRelationship?: boolean;
}) {
  // One boundary cast: the generic constraint above guarantees every field
  // referenced below exists on TValues, but react-hook-form's `Path<T>` (used
  // by `FormField`'s `name` prop) can't be resolved against a naked type
  // parameter — only a concrete type. Narrowing here means every `name="x"`
  // below type-checks as a literal keyof set instead of an abstract generic.
  const c = control as unknown as Control<GuardianFieldValues, unknown, GuardianFieldValues>;

  // The email hint only makes sense when blanking the field would drop an
  // email that is already saved. Edit flows `reset()` the form with the
  // stored guardian, create flows with EMPTY_GUARDIAN_FORM, so the form's
  // default email tells the two apart without a mode prop. `useWatch` keeps
  // this re-rendering after a `reset()` swaps the defaults.
  useWatch({ control: c, name: "email" });
  const hasStoredEmail = Boolean(c._defaultValues?.email?.trim());

  return (
    <div className="space-y-field">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={c}
          name="name"
          label="Nama"
          required
          id="guardian-name"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nama wali" />
          )}
        />
        {showRelationship ? (
          <FormField
            control={c}
            name="relationship"
            label="Hubungan"
            id="guardian-relationship"
            render={({ field, controlProps }) => (
              <Select value={field.value as string | undefined} onValueChange={(v) => v && field.onChange(v)} items={REL_LABELS}>
                <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        ) : (
          <FormField
            control={c}
            name="parentNik"
            label="NIK"
            id="guardian-nik"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="NIK orang tua" />
            )}
          />
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={c}
          name="phone"
          label="No. HP"
          id="guardian-phone"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="081234567890" />
          )}
        />
        <FormField
          control={c}
          name="whatsapp"
          label="WhatsApp"
          id="guardian-whatsapp"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="081234567890" />
          )}
        />
      </div>
      <FormField
        control={c}
        name="email"
        label="Email"
        id="guardian-email"
        description={
          hasStoredEmail
            ? "Kosongkan untuk mempertahankan email yang tersimpan — email menautkan wali ke akun masuk portal."
            : undefined
        }
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} type="email" value={(field.value as string | undefined) ?? ""} placeholder="email@example.com" />
        )}
      />
      <FormField
        control={c}
        name="address"
        label="Alamat"
        id="guardian-address"
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Alamat tempat tinggal" />
        )}
      />

      <div className="pt-2 border-t">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Data Pekerjaan</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={c}
          name="education"
          label="Pendidikan"
          id="guardian-education"
          render={({ field, controlProps }) => (
            <Select value={(field.value as string | undefined) || undefined} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
              <SelectContent>
                {EDUCATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormField
          control={c}
          name="occupation"
          label="Pekerjaan"
          id="guardian-occupation"
          render={({ field, controlProps }) => (
            <Select value={(field.value as string | undefined) || undefined} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
              <SelectContent>
                {OCCUPATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={c}
          name="incomeRange"
          label="Penghasilan"
          id="guardian-income"
          render={({ field, controlProps }) => (
            <Select value={(field.value as string | undefined) || undefined} onValueChange={(v) => v && field.onChange(v)}>
              <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
              <SelectContent>
                {INCOME_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {showRelationship ? (
          <FormField
            control={c}
            name="parentNik"
            label="NIK"
            id="guardian-nik"
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="NIK orang tua" />
            )}
          />
        ) : (
          <FormField
            control={c}
            name="childrenTotal"
            label="Jumlah Anak"
            id="guardian-children-total"
            render={({ field, controlProps }) => (
              <Input
                {...field}
                {...controlProps}
                type="number"
                min={0}
                value={(field.value as string | number | undefined) ?? ""}
                placeholder="0"
              />
            )}
          />
        )}
      </div>
      {showRelationship && (
        <FormField
          control={c}
          name="childrenTotal"
          label="Jumlah Anak"
          id="guardian-children-total"
          render={({ field, controlProps }) => (
            <Input
              {...field}
              {...controlProps}
              type="number"
              min={0}
              value={(field.value as string | number | undefined) ?? ""}
              placeholder="0"
            />
          )}
        />
      )}
      <FormField
        control={c}
        name="employer"
        label="Tempat Kerja"
        id="guardian-employer"
        render={({ field, controlProps }) => (
          <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nama perusahaan / instansi" />
        )}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField
          control={c}
          name="employerAddress"
          label="Alamat Kantor"
          id="guardian-employer-address"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Alamat kantor" />
          )}
        />
        <FormField
          control={c}
          name="employerCity"
          label="Kota/Kab"
          id="guardian-employer-city"
          render={({ field, controlProps }) => (
            <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Kota / Kabupaten" />
          )}
        />
      </div>

      {/* Junction fields (childOrder + isPrimary) only render on entry points
          that own the student↔guardian link. Server enforces the
          single-primary invariant in a serializable transaction. */}
      {showRelationship && (
        <>
          <div className="pt-2 border-t">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Data Anak</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={c}
              name="childOrder"
              label="Anak ke-"
              id="guardian-child-order"
              render={({ field, controlProps }) => (
                <Input
                  {...field}
                  {...controlProps}
                  type="number"
                  min={1}
                  value={(field.value as string | number | undefined) ?? ""}
                  placeholder="1"
                />
              )}
            />
            <FormField
              control={c}
              name="isPrimary"
              label="Wali Utama"
              id="guardian-primary"
              render={({ field, controlProps }) => (
                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    {...controlProps}
                    checked={!!field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                    aria-label="Tandai sebagai wali utama"
                  />
                  <span className="text-sm text-muted-foreground">
                    {field.value ? "Ya — wali utama" : "Bukan wali utama"}
                  </span>
                </div>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
