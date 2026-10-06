"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { sendJson } from "@/lib/api/send-json";
import {
  DOCUMENT_ITEMS,
  isDocumentKey,
  type DocumentItem,
  type DocumentKey,
} from "@/lib/enrollment/documents";

const ITEMS = DOCUMENT_ITEMS as readonly DocumentItem[];

/** Keys in form order, dropping anything the client does not know. */
function normalize(keys: unknown): DocumentKey[] {
  const set = new Set(Array.isArray(keys) ? keys.filter(isDocumentKey) : []);
  return ITEMS.map((i) => i.key as DocumentKey).filter((k) => set.has(k));
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((k) => b.includes(k));

export default function EnrollmentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [saved, setSaved] = useState<DocumentKey[]>([]);
  const [selected, setSelected] = useState<DocumentKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const noteId = useId();

  const dirty = !sameSet(saved, selected);

  useUnsavedChangesGuard(dirty, "Perubahan berkas wajib yang belum disimpan akan hilang.");

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
      const keys = normalize(data.requiredDocuments);
      setSaved(keys);
      setSelected(keys);
    } catch (err) {
      console.error(err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(key: DocumentKey, checked: boolean) {
    setSelected((cur) =>
      normalize(checked ? [...cur, key] : cur.filter((k) => k !== key)),
    );
  }

  async function save() {
    setSaving(true);
    try {
      const data = await sendJson<{ requiredDocuments?: unknown }>(
        "/api/config/enrollment",
        { method: "PUT", body: { requiredDocuments: selected } },
        "Gagal menyimpan. Coba lagi.",
      );
      const keys = normalize(data?.requiredDocuments ?? selected);
      setSaved(keys);
      setSelected(keys);
      toast.success("Pengaturan disimpan.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Viewer without admissions.edit: show what is configured, lock the controls.
        setSelected(saved);
        setReadOnly(true);
        toast.error("Anda tidak memiliki akses untuk mengubah pengaturan ini.");
      } else {
        toast.error(userMessage(err, "Gagal menyimpan. Periksa koneksi lalu coba lagi."));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-xl" />;

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
          <form
            noValidate
            className="space-y-field"
            onSubmit={(e) => {
              e.preventDefault();
              if (!readOnly && dirty && !saving) void save();
            }}
          >
            <fieldset className="space-y-3" disabled={readOnly} aria-describedby={noteId}>
              <legend className="text-sm font-medium">Wajib diunggah sebelum formulir dikirim</legend>
              <p id={noteId} className="text-sm text-muted-foreground">
                Berkas yang dicentang wajib diunggah orang tua sebelum formulir bisa dikirim. Yang
                tidak dicentang tetap bisa dibawa langsung ke sekolah.
              </p>

              <ul className="divide-y rounded-lg border">
                {ITEMS.map((item) => {
                  const key = item.key as DocumentKey;
                  const checked = selected.includes(key);
                  return (
                    <li key={key}>
                      <label
                        className={`flex min-h-11 items-start gap-3 px-3 py-2.5 ${
                          readOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={readOnly}
                          onCheckedChange={(c) => toggle(key, c === true)}
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

            {readOnly ? (
              <p role="status" className="text-sm text-muted-foreground">
                Anda hanya bisa melihat pengaturan ini. Hubungi admin dengan izin edit pendaftaran
                untuk mengubahnya.
              </p>
            ) : (
              <div className="pt-2">
                <Button type="submit" disabled={!dirty || saving}>
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
