"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Control, Path } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField, FormRootError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ApplicationSection } from "@/components/admin/enrollment-application-view";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import {
  AGAMA_OPTIONS,
  BIRTH_DELIVERY_OPTIONS,
  BIRTH_TERM_OPTIONS,
  BLOOD_TYPE_OPTIONS,
  EDUCATION_OPTIONS,
  GENDER_OPTIONS,
  INCOME_OPTIONS,
  KEWARGANEGARAAN_OPTIONS,
  LIVING_WITH_OPTIONS,
  MAX_PRIOR_FAMILY_ATTENDEES,
  OCCUPATION_OPTIONS,
  type Option,
} from "@/lib/enrollment/constants";
import { computeEnrollmentFee, type FeeProgram } from "@/lib/enrollment/fee";
import type { AdminFeeView } from "@/lib/enrollment/fee-admin-view";
import { ApiError } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { formatRupiah } from "@/lib/format";
import {
  buildPatchBody,
  editorSchemaFor,
  feeNoteLine,
  toEditorValues,
  type EditorValues,
  type FeeNote,
} from "./enrollment-application-editor-logic";

/**
 * "Ubah data" — staff edit every section of a pendaftaran formulir on the
 * parent's behalf (crud.md "Edit Toggle"). The detail page swaps its read-only
 * view for this and hands back control through `onDone`.
 *
 * Format is validated (the same rules the API uses, derived from its staff
 * schemas); completeness is not: any field may be left blank, and a blank clears
 * the stored value. Save sends only the fields that changed. Server field errors
 * land on the inputs; a 409 means the application was converted meanwhile.
 */

export type EditorApplication = {
  id: string;
  studentData: unknown;
  ayahData: unknown;
  ibuData: unknown;
  consentData: unknown;
  program: { id: string; name: string } | null;
  dcareAddon: boolean;
  /** Drives the repricing note; null = no fee row yet. */
  fee: AdminFeeView | null;
  /** `fees.edit`: changing program / Day Care reprices an unpaid fee, so it needs the finance key. */
  canAdjustFee: boolean;
};

export type EditorDoneReason = "saved" | "cancelled" | "locked";

type ConfigProgram = FeeProgram & { name: string };
type Ctl = Control<EditorValues, unknown, EditorValues>;
type Name = Path<EditorValues>;

const SAVE_FALLBACK = "Gagal menyimpan. Periksa koneksi, lalu coba lagi.";
const INPUT_CLASS = "h-11 text-base md:text-base";

// ── Field controls (one FormField each, so label ↔ control ↔ error stay wired) ──

function TextInput({
  control, name, label, type = "text", className, description, integer,
}: {
  control: Ctl; name: Name; label: string; type?: string; className?: string; description?: string;
  /** Whole-number field: numeric keypad instead of the decimal one. */
  integer?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      className={className}
      render={({ field, controlProps }) => (
        <Input
          {...field}
          {...controlProps}
          type={type}
          inputMode={type === "number" ? (integer ? "numeric" : "decimal") : undefined}
          min={type === "number" ? 0 : undefined}
          value={(field.value as string | undefined) ?? ""}
          className={INPUT_CLASS}
        />
      )}
    />
  );
}

function TextAreaInput({ control, name, label, className }: { control: Ctl; name: Name; label: string; className?: string }) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      className={className}
      render={({ field, controlProps }) => (
        <Textarea {...field} {...controlProps} rows={2} value={(field.value as string | undefined) ?? ""} />
      )}
    />
  );
}

function SelectInput({
  control, name, label, options, className, placeholder = "Belum dipilih", description, disabled,
}: {
  control: Ctl; name: Name; label: string; options: Option[]; className?: string; placeholder?: string; description?: string;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      label={label}
      description={description}
      className={className}
      render={({ field, controlProps }) => {
        const value = (field.value as string | undefined) ?? "";
        // A value stored outside the option list (older submission) stays selectable
        // instead of silently showing the placeholder.
        const unknown = value !== "" && !options.some((o) => o.value === value);
        return (
          <NativeSelect {...field} {...controlProps} value={value} disabled={disabled} className="w-full" selectClassName={INPUT_CLASS}>
            <NativeSelectOption value="">{placeholder}</NativeSelectOption>
            {unknown && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
            {options.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        );
      }}
    />
  );
}

function AddressInputs({ control, prefix }: { control: Ctl; prefix: "studentData" | "ayahData" | "ibuData" }) {
  const n = (k: string) => `${prefix}.address.${k}` as Name;
  return (
    <div className="grid gap-field sm:grid-cols-2">
      <TextInput control={control} name={n("perumahan")} label="Perumahan / Jalan" className="sm:col-span-2" />
      <TextInput control={control} name={n("blokCluster")} label="Blok / Cluster" />
      <TextInput control={control} name={n("rtRw")} label="RT / RW" />
      <TextInput control={control} name={n("kodePos")} label="Kode pos" />
      <TextInput control={control} name={n("kelurahan")} label="Kelurahan / Desa" />
      <TextInput control={control} name={n("kecamatan")} label="Kecamatan" />
      <TextInput control={control} name={n("kotaKab")} label="Kota / Kabupaten" />
      <TextInput control={control} name={n("provinsi")} label="Provinsi" />
    </div>
  );
}

/** A labelled sub-group inside a section (Alamat, Jumlah saudara…), named for screen readers. */
function SubGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-field">
      <h4 id={id} className="text-sm font-semibold">
        {title}
      </h4>
      {children}
    </div>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

function StudentSection({ control, family, onAddFamily, onRemoveFamily }: {
  control: Ctl;
  family: number;
  onAddFamily: () => void;
  onRemoveFamily: (i: number) => void;
}) {
  const n = (k: string) => `studentData.${k}` as Name;
  return (
    <ApplicationSection title="Data anak">
      <div className="space-y-section">
        <div className="grid gap-field sm:grid-cols-2">
          <TextInput control={control} name={n("childName")} label="Nama lengkap" />
          <TextInput control={control} name={n("nickname")} label="Nama panggilan" />
          <SelectInput control={control} name={n("childGender")} label="Jenis kelamin" options={GENDER_OPTIONS} />
          <TextInput control={control} name={n("birthPlace")} label="Tempat lahir" />
          <TextInput control={control} name={n("dateOfBirth")} label="Tanggal lahir" type="date" />
          <SelectInput control={control} name={n("agama")} label="Agama" options={AGAMA_OPTIONS} />
          <SelectInput control={control} name={n("kewarganegaraan")} label="Kewarganegaraan" options={KEWARGANEGARAAN_OPTIONS} />
          <SelectInput control={control} name={n("livingWith")} label="Tinggal bersama" options={LIVING_WITH_OPTIONS} />
          <TextInput control={control} name={n("homeLanguage")} label="Bahasa sehari-hari di rumah" className="sm:col-span-2" />
        </div>

        <Separator />
        <SubGroup title="Jumlah saudara">
          <div className="grid grid-cols-2 gap-field sm:grid-cols-3">
            <TextInput control={control} name={n("siblingsKandung")} label="Saudara kandung" type="number" integer />
            <TextInput control={control} name={n("siblingsTiri")} label="Saudara tiri" type="number" integer />
            <TextInput control={control} name={n("siblingsAngkat")} label="Saudara angkat" type="number" integer />
            <TextInput control={control} name={n("childOrder")} label="Anak ke-" type="number" integer />
            <TextInput control={control} name={n("siblingsTotal")} label="Dari (jumlah bersaudara)" type="number" integer />
          </div>
        </SubGroup>

        <Separator />
        <SubGroup title="Alamat">
          <AddressInputs control={control} prefix="studentData" />
        </SubGroup>

        <Separator />
        <SubGroup title="Kelahiran dan kesehatan">
          <div className="grid gap-field sm:grid-cols-2">
            <SelectInput control={control} name={n("birthDelivery")} label="Jalan lahir" options={BIRTH_DELIVERY_OPTIONS} />
            <SelectInput control={control} name={n("birthTerm")} label="Bulan lahir" options={BIRTH_TERM_OPTIONS} />
            <TextInput control={control} name={n("weightKg")} label="Berat badan (kg)" type="number" />
            <TextInput control={control} name={n("heightCm")} label="Tinggi badan (cm)" type="number" />
            <TextInput control={control} name={n("headCircumferenceCm")} label="Lingkar kepala (cm)" type="number" />
            <SelectInput control={control} name={n("bloodType")} label="Golongan darah" options={BLOOD_TYPE_OPTIONS} />
          </div>
          <TextAreaInput control={control} name={n("foodAllergy")} label="Alergi makanan" />
          <TextAreaInput control={control} name={n("seriousIllness")} label="Penyakit berat yang pernah diderita" />
        </SubGroup>

        <Separator />
        <SubGroup title="Keluarga yang pernah bersekolah di sini">
          <Button type="button" variant="outline" size="sm" onClick={onAddFamily} disabled={family >= MAX_PRIOR_FAMILY_ATTENDEES}>
            Tambah
          </Button>
          {Array.from({ length: family }, (_, i) => (
            <div key={i} className="grid items-end gap-field sm:grid-cols-[1fr_1fr_auto]">
              <TextInput control={control} name={n(`priorFamilyAttendees.${i}.name`)} label={`Nama (${i + 1})`} />
              <TextInput control={control} name={n(`priorFamilyAttendees.${i}.yearEntered`)} label={`Tahun masuk (${i + 1})`} />
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveFamily(i)} aria-label={`Hapus keluarga ${i + 1}`}>
                Hapus
              </Button>
            </div>
          ))}
        </SubGroup>
      </div>
    </ApplicationSection>
  );
}

function ParentSection({ control, side, title }: { control: Ctl; side: "ayahData" | "ibuData"; title: string }) {
  const n = (k: string) => `${side}.${k}` as Name;
  return (
    <ApplicationSection title={title}>
      <div className="space-y-section">
        <div className="grid gap-field sm:grid-cols-2">
          <TextInput control={control} name={n("name")} label="Nama" />
          <TextInput control={control} name={n("birthPlace")} label="Tempat lahir" />
          <TextInput control={control} name={n("dateOfBirth")} label="Tanggal lahir" type="date" />
          <SelectInput control={control} name={n("agama")} label="Agama" options={AGAMA_OPTIONS} />
          <TextInput control={control} name={n("phone")} label="No. HP" type="tel" />
          <TextInput control={control} name={n("email")} label="Email" type="email" />
          <SelectInput control={control} name={n("education")} label="Pendidikan terakhir" options={EDUCATION_OPTIONS} />
          <SelectInput control={control} name={n("occupation")} label="Pekerjaan" options={OCCUPATION_OPTIONS} />
          <SelectInput control={control} name={n("income")} label="Penghasilan" options={INCOME_OPTIONS} className="sm:col-span-2" />
        </div>
        <Separator />
        <SubGroup title="Alamat">
          <AddressInputs control={control} prefix={side} />
        </SubGroup>
        <Separator />
        <SubGroup title="Pekerjaan">
          <div className="grid gap-field sm:grid-cols-2">
            <TextInput control={control} name={n("employerName")} label="Nama kantor" />
            <TextInput control={control} name={n("employerPhone")} label="Telepon kantor" type="tel" />
          </div>
          <TextAreaInput control={control} name={n("employerAddress")} label="Alamat kantor" />
        </SubGroup>
      </div>
    </ApplicationSection>
  );
}

const ONLY_PARENT_OPTIONS: Option[] = [
  { value: "ayah", label: "Hanya Ayah / wali (data Ibu boleh kosong)" },
  { value: "ibu", label: "Hanya Ibu / wali (data Ayah boleh kosong)" },
];

const AUTO_WAIVED_NOTE = "Program tanpa biaya pendaftaran";

function FeeNoteText({ fee }: { fee: AdminFeeView | null }) {
  if (!fee) return null;
  let text: string;
  if (fee.status === "UNPAID") text = "Biaya belum lunas akan dihitung ulang.";
  else if (fee.status === "PAID") text = "Biaya sudah lunas, nominal tidak berubah.";
  else if (fee.note === AUTO_WAIVED_NOTE) {
    text = "Biaya dibebaskan karena program gratis; akan dihitung ulang jika Anda memilih program berbiaya.";
  } else text = "Biaya sudah dibebaskan, nominal tidak berubah.";
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

function ProgramSection({
  control, programs, currentProgram, programId, dcareAddon, fee, loadFailed, canAdjustFee,
}: {
  control: Ctl;
  programs: ConfigProgram[] | null;
  currentProgram: { id: string; name: string } | null;
  programId: string;
  dcareAddon: boolean;
  fee: AdminFeeView | null;
  loadFailed: boolean;
  canAdjustFee: boolean;
}) {
  const options: Option[] = (programs ?? []).map((p) => ({ value: p.id, label: p.name }));
  // The stored program may have been retired since: keep it visible so it is not silently dropped.
  if (currentProgram && !options.some((o) => o.value === currentProgram.id)) {
    options.unshift({ value: currentProgram.id, label: `${currentProgram.name} (tidak aktif)` });
  }

  // Auto-waived (free program) is still settled for repricing purposes only on the server side; here it
  // is not "a recorded amount", so it gets its own copy and no amount line.
  const autoWaived = fee?.status === "WAIVED" && fee.note === AUTO_WAIVED_NOTE;
  const settled = fee !== null && fee.status !== "UNPAID" && !autoWaived;
  // An unpaid fee moves with the program; without the finance key the server refuses that, so say so up front.
  const locked = fee?.status === "UNPAID" && !canAdjustFee;
  const chosen = programs && programId ? programs.find((p) => p.id === programId) : undefined;
  const preview = useMemo(
    () =>
      programs && chosen
        ? computeEnrollmentFee({ programs, programId, dcareAddon, discountPercent: fee?.discountPercent ?? 0 })
        : null,
    [programs, chosen, programId, dcareAddon, fee?.discountPercent],
  );

  let summary: ReactNode;
  if (settled) {
    summary = (
      <p>
        <span className="text-muted-foreground">Biaya pendaftaran tercatat: </span>
        <span className="font-semibold tabular-nums">{formatRupiah(fee.amount)}</span>
      </p>
    );
  } else if (programs === null) {
    summary = <p className="text-muted-foreground">Memuat biaya…</p>;
  } else if (!programId) {
    summary = <p className="text-muted-foreground">Pilih program untuk melihat perkiraan biaya.</p>;
  } else if (loadFailed || !preview) {
    // Never claim "free" for a program we could not price (list failed, or the program is retired).
    summary = <p className="text-muted-foreground">Perkiraan biaya belum tersedia.</p>;
  } else if (preview.baseAmount <= 0) {
    summary = <p className="text-muted-foreground">Program ini tanpa biaya pendaftaran.</p>;
  } else {
    summary = (
      <>
        <p>
          <span className="text-muted-foreground">Perkiraan biaya pendaftaran: </span>
          <span className="font-semibold tabular-nums">{formatRupiah(preview.amount)}</span>
        </p>
        {preview.dcareAddonFee > 0 && (
          <p className="text-muted-foreground tabular-nums">
            Program {formatRupiah(preview.programFee)} + Day Care {formatRupiah(preview.dcareAddonFee)}
          </p>
        )}
        {preview.discountPercent > 0 && <p className="text-muted-foreground tabular-nums">Termasuk potongan {preview.discountPercent}%</p>}
      </>
    );
  }

  return (
    <ApplicationSection title="Program & Day Care">
      <div className="space-y-field">
        <SelectInput control={control} name="programId" label="Program" options={options} placeholder="Belum dipilih" disabled={locked} />
        {loadFailed && (
          <p role="status" className="text-sm text-destructive">
            Daftar program belum bisa dimuat. Muat ulang halaman untuk mengganti program.
          </p>
        )}
        <FormField
          control={control}
          name="dcareAddon"
          label="Tambahan Day Care (penitipan)"
          orientation="horizontal"
          render={({ field, controlProps }) => (
            <Checkbox
              {...controlProps}
              name={field.name}
              checked={field.value === true}
              disabled={locked}
              onCheckedChange={(c) => field.onChange(c === true)}
              onBlur={field.onBlur}
            />
          )}
        />
        {locked && <p className="text-sm text-muted-foreground">Mengubah program mengubah biaya; butuh izin keuangan.</p>}
        <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite" data-testid="fee-summary">
          {summary}
          <FeeNoteText fee={fee} />
        </div>
      </div>
    </ApplicationSection>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

export function EnrollmentApplicationEditor({
  application,
  onDone,
}: {
  application: EditorApplication;
  onDone: (reason: EditorDoneReason) => void | Promise<void>;
}) {
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Snapshot at mount: the diff is against what staff SAW when they opened the editor.
  const initial = useMemo(
    () =>
      toEditorValues({
        studentData: application.studentData,
        ayahData: application.ayahData,
        ibuData: application.ibuData,
        consentData: application.consentData,
        programId: application.program?.id ?? null,
        dcareAddon: application.dcareAddon,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately frozen at mount
    [],
  );
  // Only the fields staff changed are validated (see `maskUnchanged`).
  const schema = useMemo(() => editorSchemaFor(initial), [initial]);
  const form = useZodForm(schema, { defaultValues: initial });
  const [programs, setPrograms] = useState<ConfigProgram[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const dirty = form.formState.isDirty;
  useUnsavedChangesGuard(dirty, "Perubahan data formulir yang belum disimpan akan hilang.");

  // Land on the editor's heading so a screen reader announces where it is.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/config/enrollment");
        if (!res.ok) throw new Error("config");
        const body = (await res.json()) as { programs?: unknown };
        if (alive) setPrograms(Array.isArray(body.programs) ? (body.programs as ConfigProgram[]) : []);
      } catch {
        if (alive) {
          setPrograms([]);
          setLoadFailed(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const programId = form.watch("programId");
  const dcareAddon = form.watch("dcareAddon");
  const family = form.watch("studentData.priorFamilyAttendees")?.length ?? 0;

  function addFamily() {
    const rows = form.getValues("studentData.priorFamilyAttendees");
    if (rows.length >= MAX_PRIOR_FAMILY_ATTENDEES) return;
    form.setValue("studentData.priorFamilyAttendees", [...rows, { name: "", yearEntered: "" }], { shouldDirty: true });
  }
  function removeFamily(i: number) {
    const rows = form.getValues("studentData.priorFamilyAttendees");
    form.setValue("studentData.priorFamilyAttendees", rows.filter((_, j) => j !== i), { shouldDirty: true });
  }

  const save = form.handleSubmit(async () => {
    const body = buildPatchBody(initial, form.getValues());
    if (Object.keys(body).length === 0) {
      toast.info("Tidak ada perubahan untuk disimpan.");
      await onDone("cancelled");
      return;
    }
    try {
      const res = await sendJson<{ feeNote?: FeeNote; fee?: AdminFeeView | null } | null>(
        `/api/enrollments/${application.id}`,
        { method: "PATCH", body },
        SAVE_FALLBACK,
      );
      const line = feeNoteLine(res?.feeNote, res?.fee?.amount, formatRupiah);
      toast.success("Data formulir disimpan.", line ? { description: line } : undefined);
      await onDone("saved");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Converted (or otherwise closed) while open: show why and step out of edit mode.
        toast.error(err.message);
        await onDone("locked");
        return;
      }
      applyServerErrors(form, err, SAVE_FALLBACK);
    }
  });

  function cancel() {
    if (dirty) setDiscardOpen(true);
    else onDone("cancelled");
  }

  const saving = form.formState.isSubmitting;

  return (
    <>
      <form id={formId} onSubmit={save} noValidate className="space-y-section" aria-labelledby={`${formId}-title`}>
        <div>
          <h2 id={`${formId}-title`} ref={headingRef} tabIndex={-1} className="text-h2 font-semibold outline-none">
            Ubah data formulir
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Semua kolom boleh dikosongkan. Kolom yang dikosongkan akan dihapus dari formulir.
          </p>
        </div>
        <FormRootError formState={form.formState} />

        <div className="space-y-section">
          <StudentSection control={form.control} family={family} onAddFamily={addFamily} onRemoveFamily={removeFamily} />

          <ApplicationSection title="Orang tua yang mengisi">
            <SelectInput
              control={form.control}
              name="consentData.onlyParent"
              label="Pengisi formulir"
              options={ONLY_PARENT_OPTIONS}
              placeholder="Ayah dan Ibu"
              description="Pilih bila hanya satu orang tua atau wali yang mengisi. Tanda tangan tidak bisa diubah dari sini."
            />
          </ApplicationSection>

          <div className="grid gap-section lg:grid-cols-2">
            <ParentSection control={form.control} side="ayahData" title="Data Ayah" />
            <ParentSection control={form.control} side="ibuData" title="Data Ibu" />
          </div>

          <ProgramSection
            control={form.control}
            programs={programs}
            currentProgram={application.program}
            programId={programId}
            dcareAddon={dcareAddon}
            fee={application.fee}
            loadFailed={loadFailed}
            canAdjustFee={application.canAdjustFee}
          />
        </div>

        {/* Sticky so Simpan stays reachable on a long form, thumb-height on a phone. */}
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 border-t bg-background/95 px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <Button type="button" variant="ghost" onClick={cancel} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Buang perubahan?"
        description="Perubahan data formulir yang belum disimpan akan hilang."
        confirmLabel="Buang perubahan"
        cancelLabel="Lanjut mengubah"
        destructive
        onConfirm={() => onDone("cancelled")}
      />
    </>
  );
}
