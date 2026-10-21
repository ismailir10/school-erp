"use client";

import { useEffect, useId, useRef } from "react";
import { useFieldArray } from "react-hook-form";
import { toast } from "sonner";
import { DossierSubsection } from "@/components/admin/dossier-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormRootError } from "@/components/ui/form";
import { FieldError } from "@/components/ui/field";
import { Plus, Save, Trash2 } from "lucide-react";
import { studentExtraMetadataFormSchema } from "@/lib/validations/student";
import { useZodForm } from "@/lib/forms/use-zod-form";
import type { MetadataExtraRow } from "@/lib/student/metadata";

/**
 * "Informasi Tambahan" — the free-form key/value rows left over once the
 * known metadata keys are rendered in Kesehatan & Kelahiran (`useFieldArray`
 * over `studentExtraMetadataFormSchema`).
 *
 * Reports its live rows + dirty state up to the page on every change (a ref,
 * not state — see the page's `getExtraRows`/`isTambahanDirty` comment) so
 * Kesehatan's save can still fold in whatever is currently typed here (the
 * pre-split page's `saveHealth` read the same shared `metadataRows` state),
 * and so the page's "Edit" button can refuse to start a Data Anak edit while
 * this section holds unsaved rows.
 */
export function InformasiTambahanSection({
  extra,
  known,
  persistMetadata,
  onSaved,
  canEdit,
  onStateChange,
}: {
  extra: MetadataExtraRow[];
  known: Record<string, string>;
  persistMetadata: (next: { known: Record<string, string>; extra: MetadataExtraRow[] }) => Promise<boolean>;
  onSaved: () => void;
  canEdit: boolean;
  onStateChange: (state: { dirty: boolean; rows: MetadataExtraRow[] }) => void;
}) {
  const formId = useId();
  const form = useZodForm(studentExtraMetadataFormSchema, {
    defaultValues: { rows: extra },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rows" });
  const rows = form.watch("rows");
  const dirty = form.formState.isDirty;

  // Re-seed the form whenever the page hands us a fresh `extra` (post-fetch)
  // and nothing here is unsaved — mirrors `buildStudentMetadata`'s own
  // "blank rows are omitted" contract, so a freshly-saved row order survives
  // a refetch without looking like a spurious dirty state.
  const prevExtraRef = useRef(extra);
  useEffect(() => {
    if (prevExtraRef.current !== extra && !dirty) {
      form.reset({ rows: extra });
    }
    prevExtraRef.current = extra;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra, dirty]);

  // Ref-only mirror to the page — see this file's doc comment. `rows`/`dirty`
  // changing (every keystroke) must not re-render the whole dossier, only
  // update what the page reads at save time.
  useEffect(() => {
    onStateChange({ dirty, rows: rows.map((r) => ({ key: r.key, value: r.value })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dirty]);

  function addRow() {
    append({ key: "", value: "" });
  }

  const handleSave = form.handleSubmit(async (values) => {
    const trimmed = values.rows.map((r) => ({ key: r.key.trim(), value: r.value }));
    // persistMetadata toasts its own failure.
    if (!(await persistMetadata({ known, extra: trimmed }))) return;
    toast.success("Informasi tambahan disimpan");
    // Clear the dirty state with what was saved, so the refetched `extra`
    // is adopted by the re-seed effect above and the Save action goes away.
    form.reset({ rows: trimmed });
    onSaved();
  });

  return (
    <DossierSubsection
      id="informasi-tambahan"
      label="Informasi Tambahan"
      actions={canEdit &&
        <>
          <Button size="sm" variant="ghost" onClick={addRow}>
            <Plus size={12} className="mr-1" aria-hidden="true" /> Tambah Field
          </Button>
          {dirty && (
            <Button size="sm" type="submit" form={formId} disabled={form.formState.isSubmitting}>
              <Save size={12} className="mr-1" aria-hidden="true" /> {form.formState.isSubmitting ? "Menyimpan..." : "Simpan"}
            </Button>
          )}
        </>
      }
    >
      <form id={formId} onSubmit={handleSave} noValidate>
        <FormRootError formState={form.formState} />
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada field tambahan.{canEdit && <> Klik &ldquo;Tambah Field&rdquo; untuk menambahkan.</>}</p>
        ) : (
          <div className="space-y-2">
            {fields.map((rowField, index) => {
              const keyError = form.formState.errors.rows?.[index]?.key;
              return (
                <div key={rowField.id} className="grid grid-cols-[1fr_2fr_auto] items-start gap-2">
                  <div>
                    <Input
                      {...form.register(`rows.${index}.key`)}
                      placeholder="Nama field"
                      disabled={!canEdit}
                      aria-label="Nama field"
                      aria-invalid={!!keyError || undefined}
                    />
                    <FieldError errors={[keyError]} />
                  </div>
                  <Input
                    {...form.register(`rows.${index}.value`)}
                    placeholder="Nilai"
                    disabled={!canEdit}
                    aria-label="Nilai field"
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={!canEdit}
                    onClick={() => remove(index)}
                    aria-label={`Hapus field ${rows[index]?.key || "tanpa nama"}`}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </form>
    </DossierSubsection>
  );
}
