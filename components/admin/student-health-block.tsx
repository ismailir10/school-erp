"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  KNOWN_FIELDS,
  GROUP_LABELS,
  GROUP_ORDER,
  type MetadataField,
  type MetadataGroup,
  type StudentSystemMetadata,
} from "@/lib/student/metadata";

/**
 * "Kesehatan & Kelahiran" — the typed view of the known `Student.metadata`
 * keys, in the same view/edit-toggle shape as the Data Anak card above it.
 *
 * Read mode omits empty fields (consistent with the rest of the detail page).
 * Edit mode renders every known field, including the empty ones, because
 * filling a blank is the main reason an admin opens the editor at all.
 */

function fieldsIn(group: MetadataGroup): MetadataField[] {
  return KNOWN_FIELDS.filter((f) => f.group === group);
}

function ReadField({ field, value }: { field: MetadataField; value: string }) {
  const isAlert = field.key === "foodAllergy" || field.key === "seriousIllness";
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{field.label}</p>
      <p
        className={
          isAlert
            ? "text-small font-semibold text-status-leave-text"
            : "text-small font-medium"
        }
      >
        {value}
        {field.unit ? <span className="ml-1 font-normal text-muted-foreground">{field.unit}</span> : null}
      </p>
    </div>
  );
}

function EditField({
  field,
  value,
  onChange,
}: {
  field: MetadataField;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `student-meta-${field.key}`;

  if (field.input === "select") {
    const options = field.options ?? [];
    // Metadata stores option *labels*, and a legacy or hand-edited row may hold
    // something outside the current list. Append it rather than silently
    // resetting the field to blank on first save.
    const all = value && !options.includes(value) ? [...options, value] : options;
    return (
      <Field>
        <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
        <Select value={value || undefined} onValueChange={(v) => onChange(v ?? "")}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Pilih" />
          </SelectTrigger>
          <SelectContent>
            {all.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {field.label}
        {field.unit ? <span className="ml-1 font-normal text-muted-foreground">({field.unit})</span> : null}
      </FieldLabel>
      <Input
        id={id}
        type={field.input === "number" ? "number" : "text"}
        inputMode={field.input === "number" ? "decimal" : undefined}
        min={field.input === "number" ? 0 : undefined}
        step={field.input === "number" ? "any" : undefined}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function StudentHealthBlock({
  known,
  system,
  editing,
  canEdit,
  onChange,
}: {
  known: Record<string, string>;
  system: StudentSystemMetadata;
  editing: boolean;
  canEdit: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const filled = KNOWN_FIELDS.filter((f) => (known[f.key] ?? "").trim() !== "");

  if (!editing && filled.length === 0 && system.priorFamilyAttendees.length === 0) {
    return (
      <p className="text-small text-muted-foreground">
        {canEdit
          ? <>Belum ada data kesehatan dan kelahiran. Klik &ldquo;Ubah&rdquo; untuk mengisi, atau data akan terisi otomatis saat formulir pendaftaran dikonversi.</>
          : "Belum ada data kesehatan dan kelahiran."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {GROUP_ORDER.map((group) => {
        const groupFields = fieldsIn(group);
        const visible = editing
          ? groupFields
          : groupFields.filter((f) => (known[f.key] ?? "").trim() !== "");
        if (visible.length === 0) return null;
        return (
          <div key={group}>
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {GROUP_LABELS[group]}
            </p>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              {visible.map((field) =>
                editing ? (
                  <EditField
                    key={field.key}
                    field={field}
                    value={known[field.key] ?? ""}
                    onChange={(v) => onChange(field.key, v)}
                  />
                ) : (
                  <ReadField key={field.key} field={field} value={known[field.key] ?? ""} />
                ),
              )}
            </div>
          </div>
        );
      })}

      {/* Machine-owned rows: shown so the data is not invisible, never edited
          here — the enrollment form is their source of truth. */}
      {(system.dcareAddon || system.priorFamilyAttendees.length > 0) && (
        <div className="border-t pt-4">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Dari Formulir Pendaftaran
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {system.dcareAddon && <Badge variant="outline" className="text-xs">Ambil Day Care</Badge>}
            {system.priorFamilyAttendees.map((a, i) => (
              <Badge key={`${a.name ?? "keluarga"}-${i}`} variant="outline" className="text-xs">
                Keluarga pernah bersekolah: {a.name || "—"}
                {a.yearEntered ? ` (${a.yearEntered})` : ""}
              </Badge>
            ))}
          </div>
          {system.fromEnrollmentApplication && (
            <p className="mt-2.5">
              <Link
                href={`/admin/enrollments/${system.fromEnrollmentApplication}`}
                className="text-small font-semibold text-primary-text hover:underline"
              >
                Lihat formulir pendaftaran lengkap →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
