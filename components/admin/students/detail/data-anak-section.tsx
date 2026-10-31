"use client";

import { MESSAGES } from "@/lib/feedback";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useEffect, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { DossierSubsection } from "@/components/admin/dossier-section";
import { MaskedValue } from "@/components/admin/masked-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FormField, FormRootError } from "@/components/ui/form";
import { SectionHeading } from "@/components/ui/section-heading";
import { User, MapPin, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { formatDateShort } from "@/lib/format";
import { LIVING_WITH_OPTIONS, LIVING_WITH_LABELS } from "@/lib/constants/parent-options";
import type * as z4 from "zod/v4/core";
import type { studentDetailEditFormSchema } from "@/lib/validations/student";
import type { Student } from "./types";

type FormValues = z4.input<typeof studentDetailEditFormSchema>;
type FormOutput = z4.output<typeof studentDetailEditFormSchema>;

/**
 * "Data Anak" — the dossier's first section: photo, core identity fields
 * (edit-in-place, RHF), and Identitas Resmi (NIS/NISN/NIK/No. KK/birth
 * place/tinggal dengan).
 *
 * `editing`/`form` are owned by the page, not this component: starting an
 * edit has to check Informasi Tambahan's dirty state (a sibling section) and
 * the unsaved-changes guard hangs off the same form, so the page passes
 * `onEdit`. The "Edit" button itself sits here, in the section's `actions`,
 * next to the data it edits. Photo upload has no such cross-component reason
 * to live on the page, so it stays local to this component.
 *
 * Starting an edit unmounts the focused Edit button and finishing one unmounts
 * the form, so focus moves with the change: into the first field when editing
 * starts, back to Edit when it ends.
 */
export function DataAnakSection({
  student,
  age,
  canEdit,
  editing,
  form,
  formId,
  onEdit,
  onSave,
  onCancel,
  onSaved,
}: {
  student: Student;
  age: string | null;
  canEdit: boolean;
  editing: boolean;
  form: UseFormReturn<FormValues, unknown, FormOutput>;
  formId: string;
  /** Starts the edit; the page may refuse (unsaved Informasi Tambahan) and then `editing` stays false. */
  onEdit: () => void;
  onSave: (e?: React.BaseSyntheticEvent) => Promise<void>;
  onCancel: () => void;
  /** Called after a successful photo upload/delete so the page can refetch. */
  onSaved: () => void;
}) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Cache-bust the auth-proxied photo URL after upload/delete so <img> reloads.
  const [photoVersion, setPhotoVersion] = useState(0);

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file fires onChange again.
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 2 MB");
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      toast.error("Format foto harus JPG atau PNG");
      return;
    }
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch(`/api/students/${student.id}/photo`, { method: "POST", body: fd });
      if (res.ok) {
        toast.success("Foto diperbarui");
        setPhotoVersion((v) => v + 1);
        onSaved();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Gagal mengunggah foto");
      }
    } catch {
      toast.error(MESSAGES.network);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handlePhotoDelete() {
    setUploadingPhoto(true);
    try {
      const res = await fetch(`/api/students/${student.id}/photo`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Foto dihapus");
        setPhotoVersion((v) => v + 1);
        onSaved();
      } else {
        toast.error("Gagal menghapus foto");
      }
    } catch {
      toast.error(MESSAGES.network);
    } finally {
      setUploadingPhoto(false);
    }
  }

  const saving = form.formState.isSubmitting;

  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      document.getElementById(formId)?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    } else if (wasEditing.current) {
      editButtonRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing, formId]);

  return (
    <DossierSubsection
      id="data-anak"
      label="Data Anak"
      actions={
        editing ? (
          <>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
              <X size={14} className="mr-1" aria-hidden="true" /> Batal
            </Button>
            <Button size="sm" type="submit" form={formId} disabled={saving}>
              <Save size={14} className="mr-1" aria-hidden="true" /> {saving ? "Menyimpan..." : "Simpan Perubahan"}
            </Button>
          </>
        ) : canEdit ? (
          // Named for what it edits: Kesehatan and Riwayat Status carry their own
          // "Ubah", so a bare "Edit" would not say which data this changes.
          <Button ref={editButtonRef} size="sm" variant="outline" onClick={onEdit} aria-label="Edit data anak">
            <Pencil size={14} className="mr-1" aria-hidden="true" /> Edit
          </Button>
        ) : undefined
      }
    >
      {/* Photo — auth-proxied; src never references a public filesystem path */}
      <div className="mb-4 flex items-center gap-4">
        <UserAvatar
          name={student.name}
          size="lg"
          src={student.photoUrl ? `/api/students/${student.id}/photo?v=${photoVersion}` : null}
          className="size-20 shrink-0"
        />
        {student.canEdit === true && <div className="flex gap-2">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={handlePhotoFile}
          />
          <Button size="sm" variant="outline" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>
            {uploadingPhoto ? "Mengunggah..." : "Ganti Foto"}
          </Button>
          {student.photoUrl && (
            <Button size="sm" variant="ghost" onClick={handlePhotoDelete} disabled={uploadingPhoto}>
              Hapus
            </Button>
          )}
        </div>}
      </div>

      {editing ? (
        <form id={formId} onSubmit={onSave} noValidate className="space-y-field">
          <FormRootError formState={form.formState} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="name"
              label="Nama Lengkap"
              required
              id="student-detail-name"
              render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
            />
            <FormField
              control={form.control}
              name="nickname"
              label="Nama Panggilan"
              id="student-detail-nickname"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} />
              )}
            />
            <FormField
              control={form.control}
              name="dateOfBirth"
              label="Tanggal Lahir"
              id="student-detail-dob"
              render={({ field, controlProps }) => (
                <DatePicker {...controlProps} value={(field.value as string | undefined) ?? ""} onChange={field.onChange} />
              )}
            />
            <FormField
              control={form.control}
              name="gender"
              label="Jenis Kelamin"
              id="student-detail-gender"
              render={({ field, controlProps }) => (
                <Select
                  value={(field.value as string | undefined) ?? undefined}
                  onValueChange={(v) => v != null && field.onChange(v)}
                  items={{ L: "Laki-laki", P: "Perempuan" }}
                >
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="L">Laki-laki</SelectItem>
                    <SelectItem value="P">Perempuan</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              label="Alamat"
              id="student-detail-address"
              className="sm:col-span-2"
              render={({ field, controlProps }) => (
                <Textarea {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} rows={2} />
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              label="Catatan"
              id="student-detail-notes"
              className="sm:col-span-2"
              render={({ field, controlProps }) => (
                <Textarea {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} rows={2} />
              )}
            />

            <div className="mt-2 sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identitas Resmi</p></div>
            <FormField
              control={form.control}
              name="nis"
              label="NIS"
              id="student-detail-nis"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nomor Induk Siswa" />
              )}
            />
            <FormField
              control={form.control}
              name="nisn"
              label="NISN"
              id="student-detail-nisn"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nomor Induk Siswa Nasional" />
              )}
            />
            <FormField
              control={form.control}
              name="birthPlace"
              label="Tempat Lahir"
              id="student-detail-birth-place"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Kota kelahiran" />
              )}
            />
            <FormField
              control={form.control}
              name="nik"
              label="NIK"
              id="student-detail-nik"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nomor Induk Kependudukan" />
              )}
            />
            <FormField
              control={form.control}
              name="kkNumber"
              label="No. KK"
              id="student-detail-kk-number"
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} value={(field.value as string | undefined) ?? ""} placeholder="Nomor Kartu Keluarga" />
              )}
            />
            <FormField
              control={form.control}
              name="livingWith"
              label="Tinggal Dengan"
              id="student-detail-living-with"
              render={({ field, controlProps }) => (
                <Select
                  value={(field.value as string | undefined) ?? undefined}
                  onValueChange={(v) => v != null && field.onChange(v)}
                  items={LIVING_WITH_LABELS}
                >
                  <SelectTrigger {...controlProps} onBlur={field.onBlur}><SelectValue placeholder="Pilih" /></SelectTrigger>
                  <SelectContent>
                    {LIVING_WITH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </form>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-3">
              <User size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0"><p className="text-xs text-muted-foreground">Nama Lengkap</p><p className="text-sm font-medium break-words">{student.name}</p></div>
            </div>
            {student.nickname && <div><p className="text-xs text-muted-foreground">Nama Panggilan</p><p className="text-sm font-medium">{student.nickname}</p></div>}
            {student.dateOfBirth && <div><p className="text-xs text-muted-foreground">Tanggal Lahir</p><p className="text-sm font-medium">{formatDateShort(student.dateOfBirth)}{age ? ` · ${age}` : ""}</p></div>}
            {student.gender && <div><p className="text-xs text-muted-foreground">Jenis Kelamin</p><p className="text-sm font-medium">{student.gender === "L" ? "Laki-laki" : student.gender === "P" ? "Perempuan" : "—"}</p></div>}
            {student.address && (
              <div className="flex items-start gap-3 sm:col-span-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div><p className="text-xs text-muted-foreground">Alamat</p><p className="text-sm">{student.address}</p></div>
              </div>
            )}
            {student.notes && <div className="sm:col-span-3"><p className="text-xs text-muted-foreground">Catatan</p><p className="text-sm">{student.notes}</p></div>}
          </div>

          {(student.nis || student.nisn || student.nik || student.birthPlace || student.kkNumber || student.livingWith) && (
            <>
              <div className="mt-6"><SectionHeading label="Identitas Resmi" /></div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {student.nis && <div className="min-w-0"><p className="text-xs text-muted-foreground">NIS</p><p className="font-currency text-sm font-medium break-all">{student.nis}</p></div>}
                {student.nisn && <div className="min-w-0"><p className="text-xs text-muted-foreground">NISN</p><p className="font-currency text-sm font-medium break-all">{student.nisn}</p></div>}
                {student.birthPlace && <div><p className="text-xs text-muted-foreground">Tempat Lahir</p><p className="text-sm">{student.birthPlace}</p></div>}
                {/* NIK and No. KK are specific personal data under UU PDP
                    27/2022 — masked by default now that they share a
                    screen with every other family document. */}
                {student.nik && <div><p className="text-xs text-muted-foreground">NIK</p><div className="text-sm"><MaskedValue value={student.nik} label="NIK siswa" /></div></div>}
                {student.kkNumber && <div><p className="text-xs text-muted-foreground">No. KK</p><div className="text-sm"><MaskedValue value={student.kkNumber} label="No. KK" /></div></div>}
                {student.livingWith && <div><p className="text-xs text-muted-foreground">Tinggal Dengan</p><p className="text-sm">{LIVING_WITH_LABELS[student.livingWith] ?? student.livingWith}</p></div>}
              </div>
            </>
          )}
        </>
      )}
    </DossierSubsection>
  );
}

// Re-exported so the page can build the RHF instance with the exact same
// input/output typing this section renders against.
export type { FormValues as DataAnakFormValues, FormOutput as DataAnakFormOutput };
