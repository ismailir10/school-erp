"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RupiahInput } from "@/components/ui/rupiah-input";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldError } from "@/components/ui/field";
import { FormField, FormRootError } from "@/components/ui/form";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { ApiError } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import { applyServerErrors } from "@/lib/forms/server-errors";
import { useZodForm } from "@/lib/forms/use-zod-form";
import { enrollmentConfigSchema } from "@/lib/validations/enrollment-config";
import { DOCUMENT_ITEMS, isDocumentKey, type DocumentItem } from "@/lib/enrollment/documents";

const ITEMS = DOCUMENT_ITEMS as readonly DocumentItem[];
const SAVE_FALLBACK = MESSAGES.saveFailed;

/** Keys in form order, dropping anything the client does not know. */
function normalize(keys: unknown): string[] {
  const set = new Set<string>(Array.isArray(keys) ? keys.filter(isDocumentKey) : []);
  return ITEMS.map((i) => i.key).filter((k) => set.has(k));
}

type ProgramRow = { id: string; code: string; name: string; enrollmentFee: number };

/** `programs` from the API, tolerating a missing or malformed field. */
function toPrograms(raw: unknown): ProgramRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p): ProgramRow[] => {
    const r = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") return [];
    return [
      {
        id: r.id,
        code: typeof r.code === "string" ? r.code : "",
        name: r.name,
        enrollmentFee: typeof r.enrollmentFee === "number" && r.enrollmentFee > 0 ? r.enrollmentFee : 0,
      },
    ];
  });
}

const toFeeValues = (programs: ProgramRow[]) =>
  programs.map((p) => ({ programId: p.id, fee: p.enrollmentFee }));

export default function EnrollmentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const formId = useId();
  const noteId = useId();
  const feeNoteId = useId();
  const form = useZodForm(enrollmentConfigSchema, {
    defaultValues: { requiredDocuments: [], programFees: [] },
  });
  const { reset } = form;

  useUnsavedChangesGuard(
    form.formState.isDirty,
    "Perubahan pengaturan pendaftaran yang belum disimpan akan hilang.",
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
      const data = (await res.json()) as { requiredDocuments?: unknown; programs?: unknown; canEdit?: unknown };
      // Only an explicit `false` locks up front; PUT 403 stays as the fallback.
      setReadOnly(data.canEdit === false);
      const rows = toPrograms(data.programs);
      setPrograms(rows);
      reset({ requiredDocuments: normalize(data.requiredDocuments), programFees: toFeeValues(rows) });
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
      const data = await sendJson<{ requiredDocuments?: unknown; programs?: unknown }>(
        "/api/config/enrollment",
        { method: "PUT", body: values },
        SAVE_FALLBACK,
      );
      // The server's view wins: it re-reads the stored fees after the write.
      const rows = data?.programs === undefined ? programs : toPrograms(data.programs);
      setPrograms(rows);
      form.reset({
        requiredDocuments: normalize(data?.requiredDocuments ?? values.requiredDocuments),
        programFees: data?.programs === undefined ? (values.programFees ?? []) : toFeeValues(rows),
      });
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
        title="Pengaturan pendaftaran"
        description="Atur biaya pendaftaran tiap program dan berkas yang wajib diunggah orang tua."
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
              name="programFees"
              id="enrollment-program-fees"
              render={({ field, controlProps }) => (
                <fieldset
                  id={controlProps.id}
                  className="space-y-3"
                  disabled={readOnly}
                  aria-invalid={controlProps["aria-invalid"]}
                  aria-describedby={
                    [feeNoteId, controlProps["aria-describedby"]].filter(Boolean).join(" ") || undefined
                  }
                >
                  <legend className="text-sm font-medium">Biaya pendaftaran per program</legend>
                  <p id={feeNoteId} className="text-sm text-muted-foreground">
                    Orang tua membayar biaya ini lewat DOKU setelah formulir dikirim. Isi 0 bila
                    program tidak dikenai biaya. Orang tua yang menambah Day Care membayar biaya
                    program pilihan ditambah biaya Day Care.
                  </p>

                  {programs.length === 0 ? (
                    <p role="status" className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">
                      Belum ada program aktif. Tambahkan program lebih dulu untuk mengatur biayanya.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {programs.map((program) => {
                        const index = (field.value ?? []).findIndex((r) => r.programId === program.id);
                        const row = index >= 0 ? field.value?.[index] : undefined;
                        const inputId = `${controlProps.id}-${program.id}`;
                        // A bad fee surfaces at `programFees.<i>.fee` (client resolver
                        // and server 400 alike), which the group-level error cannot show.
                        const feeError = index >= 0 ? form.formState.errors.programFees?.[index]?.fee?.message : undefined;
                        const errorId = `${inputId}-err`;
                        return (
                          <li key={program.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                            <label htmlFor={inputId} className="min-w-0 text-sm font-medium">
                              {program.name}
                              {program.code && (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">{program.code}</span>
                              )}
                            </label>
                            <div className="w-full sm:w-52">
                              <RupiahInput
                                id={inputId}
                                value={row?.fee ?? 0}
                                disabled={readOnly}
                                aria-label={`Biaya pendaftaran ${program.name}`}
                                aria-invalid={feeError ? true : undefined}
                                aria-describedby={feeError ? errorId : undefined}
                                onBlur={field.onBlur}
                                onChange={(value) =>
                                  field.onChange(
                                    (field.value ?? []).map((r) =>
                                      r.programId === program.id ? { ...r, fee: value ?? 0 } : r,
                                    ),
                                  )
                                }
                              />
                              {feeError && <FieldError id={errorId}>{feeError}</FieldError>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </fieldset>
              )}
            />

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
