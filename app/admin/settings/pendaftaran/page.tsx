"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { FormField, FormRootError } from "@/components/ui/form";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { ApiError } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { enrollmentConfigSchema } from "@/lib/validations/enrollment-config";
import { DOCUMENT_ITEMS, isDocumentKey, type DocumentItem } from "@/lib/enrollment/documents";

const ITEMS = DOCUMENT_ITEMS as readonly DocumentItem[];
const SAVE_FALLBACK = "Gagal menyimpan. Coba lagi.";

/** Keys in form order, dropping anything the client does not know. */
function normalize(keys: unknown): string[] {
  const set = new Set<string>(Array.isArray(keys) ? keys.filter(isDocumentKey) : []);
  return ITEMS.map((i) => i.key).filter((k) => set.has(k));
}

export default function EnrollmentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const formId = useId();
  const noteId = useId();
  const form = useZodForm(enrollmentConfigSchema, { defaultValues: { requiredDocuments: [] } });
  const { reset } = form;

  useUnsavedChangesGuard(
    form.formState.isDirty,
    "Perubahan berkas wajib yang belum disimpan akan hilang.",
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setNoAccess(false);
    try {
      const res = await fetch("/api/config/enrollment");
      if (res.status === 403) {
        setNoAccess(true);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { requiredDocuments?: unknown; canEdit?: unknown };
      // Only an explicit `false` locks up front; PUT 403 stays as the fallback.
      setReadOnly(data.canEdit === false);
      reset({ requiredDocuments: normalize(data.requiredDocuments) });
    } catch (err) {
      console.error(err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = form.handleSubmit(async (values) => {
    try {
      const data = await sendJson<{ requiredDocuments?: unknown }>(
        "/api/config/enrollment",
        { method: "PUT", body: values },
        SAVE_FALLBACK,
      );
      form.reset({ requiredDocuments: normalize(data?.requiredDocuments ?? values.requiredDocuments) });
      toast.success("Pengaturan disimpan.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Viewer without admissions.edit: roll back to what is stored, lock the controls.
        form.reset();
        setReadOnly(true);
        toast.error("Anda tidak memiliki akses untuk mengubah pengaturan ini.");
        return;
      }
      applyServerErrors(form, err, SAVE_FALLBACK);
    }
  });

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;

  const saving = form.formState.isSubmitting;

  return (
    <>
      <PageHeader
        title="Berkas wajib pendaftaran"
        description="Pilih berkas yang wajib diunggah orang tua sebelum formulir pendaftaran dikirim."
      />

      <Card className="p-card max-w-2xl">
        {noAccess ? (
          <p role="status" className="text-sm text-muted-foreground">
            Anda tidak memiliki akses ke pengaturan ini.
          </p>
        ) : loadFailed ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Gagal memuat pengaturan.</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              Coba lagi
            </Button>
          </div>
        ) : (
          <form id={formId} noValidate className="space-y-field" onSubmit={handleSave}>
            <FormRootError formState={form.formState} />

            <FormField
              control={form.control}
              name="requiredDocuments"
              id="enrollment-required-documents"
              render={({ field, controlProps }) => (
                <fieldset
                  id={controlProps.id}
                  className="space-y-3"
                  disabled={readOnly}
                  aria-invalid={controlProps["aria-invalid"]}
                  aria-describedby={
                    [noteId, controlProps["aria-describedby"]].filter(Boolean).join(" ") || undefined
                  }
                >
                  <legend className="text-sm font-medium">Wajib diunggah sebelum formulir dikirim</legend>
                  <p id={noteId} className="text-sm text-muted-foreground">
                    Berkas yang dicentang wajib diunggah orang tua sebelum formulir bisa dikirim.
                    Yang tidak dicentang tetap bisa dibawa langsung ke sekolah.
                  </p>

                  <ul className="divide-y rounded-lg border">
                    {ITEMS.map((item) => {
                      const checked = field.value.includes(item.key);
                      return (
                        <li key={item.key}>
                          <label
                            className={`flex min-h-11 items-start gap-3 px-3 py-2.5 ${
                              readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                            }`}
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              disabled={readOnly}
                              onCheckedChange={(c) =>
                                field.onChange(
                                  normalize(
                                    c === true
                                      ? [...field.value, item.key]
                                      : field.value.filter((k) => k !== item.key),
                                  ),
                                )
                              }
                              onBlur={field.onBlur}
                              aria-label={item.label}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium" aria-hidden>
                                {item.label}
                              </span>
                              {item.note && (
                                <span className="block text-xs text-muted-foreground">{item.note}</span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}
            />

            {readOnly ? (
              <p role="status" className="text-sm text-muted-foreground">
                Anda hanya bisa melihat pengaturan ini. Hubungi admin dengan izin edit pendaftaran
                untuk mengubahnya.
              </p>
            ) : (
              <div className="pt-2">
                <Button type="submit" disabled={!form.formState.isDirty || saving}>
                  {saving ? "Menyimpan..." : "Simpan Pengaturan"}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Berlaku untuk formulir yang dikirim setelah ini, termasuk yang sudah dibagikan
                  tautannya.
                </p>
              </div>
            )}
          </form>
        )}
      </Card>
    </>
  );
}
