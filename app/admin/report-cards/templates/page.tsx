"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GuardedLink } from "@/components/admin/guarded-link";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { PageHeader } from "@/components/admin/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ApiError, userMessage } from "@/lib/api/client-errors";
import { toast } from "sonner";
import { AlertCircle, FileText, Copy } from "lucide-react";
import {
  BUCKETED_SECTIONS,
  CLOSING_SECTIONS,
  LEVEL_ORDER,
  LEVEL_LABELS,
  SECTION_LABELS,
  type RaportLevel,
} from "@/lib/raport/labels";
import { bucketKey, TOTAL_TEMPLATE_SLOTS } from "@/lib/raport/templates";

type Term = {
  id: string;
  number: number;
  semester: { number: number; academicYear: { name: string } };
};

type AgeGroup = "A" | "B";

function termLabel(t: Term) {
  return `Triwulan ${t.number} · Smt ${t.semester.number} ${t.semester.academicYear.name}`;
}

export default function RaportTemplatesPage() {
  const [terms, setTerms] = useState<Term[] | null>(null);
  const [termId, setTermId] = useState("");
  const [ageGroup, setAgeGroup] = useState<AgeGroup>("A");

  // Draft state for the whole grid; keys match the API's grid shape.
  const [bucketed, setBucketed] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestVersion = useRef(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState("");
  const [pendingContext, setPendingContext] = useState<{ termId: string; ageGroup: AgeGroup } | null>(null);
  const contextKey = `${termId}:${ageGroup}`;
  const ready = loadedKey === contextKey && !loading && !error;
  const dirty = ready && JSON.stringify({ bucketed, closing }) !== savedDraft;
  useUnsavedChangesGuard(dirty, "Perubahan narasi belum disimpan dan akan hilang jika Anda keluar.");

  const [cloneSourceTermId, setCloneSourceTermId] = useState("");
  const [cloneSourceAgeGroup, setCloneSourceAgeGroup] = useState<AgeGroup>("A");
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/terms");
        if (!res.ok) throw new Error("Gagal memuat daftar triwulan.");
        const body = (await res.json()) as { data?: Term[] };
        if (!alive) return;
        const rows = body.data ?? [];
        setTerms(rows);
        if (rows.length > 0) setTermId((cur) => cur || rows[0].id);
      } catch {
        if (alive) setTerms([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadGrid = useCallback(async () => {
    if (!termId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadedKey(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/report-cards/templates?termId=${encodeURIComponent(termId)}&ageGroup=${ageGroup}`,
      );
      const body = (await res.json()) as {
        data?: { bucketed: Record<string, string>; closing: Record<string, string> };
        error?: string;
      };
      if (!res.ok) throw new ApiError(body.error ?? "Gagal memuat bank narasi.");
      if (version !== requestVersion.current) return;
      const grid = { bucketed: body.data?.bucketed ?? {}, closing: body.data?.closing ?? {} };
      setBucketed(grid.bucketed);
      setClosing(grid.closing);
      setSavedDraft(JSON.stringify(grid));
      setLoadedKey(`${termId}:${ageGroup}`);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setError(userMessage(err, "Gagal memuat bank narasi. Coba lagi."));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [termId, ageGroup]);

  useEffect(() => {
    void loadGrid();
    const requests = requestVersion;
    return () => { requests.current++; };
  }, [loadGrid]);

  const filledCount = useMemo(
    () =>
      Object.values(bucketed).filter((v) => v.trim()).length +
      Object.values(closing).filter((v) => v.trim()).length,
    [bucketed, closing],
  );

  function switchContext(next: { termId: string; ageGroup: AgeGroup }) {
    requestVersion.current++;
    setLoadedKey(null);
    setTermId(next.termId);
    setAgeGroup(next.ageGroup);
  }

  function requestContext(next: { termId: string; ageGroup: AgeGroup }) {
    if (saving || cloning) return;
    if (dirty) setPendingContext(next);
    else switchContext(next);
  }

  async function handleSave() {
    if (!ready || saving || cloning) return;
    setSaving(true);
    try {
      const narratives = BUCKETED_SECTIONS.flatMap((section) =>
        LEVEL_ORDER.map((level) => ({
          section,
          level,
          content: bucketed[bucketKey(section, level)] ?? "",
        })),
      );
      const closings = CLOSING_SECTIONS.map((section) => ({
        section,
        content: closing[section] ?? "",
      }));
      const res = await fetch("/api/admin/report-cards/templates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId, ageGroup, narratives, closings }),
      });
      const body = (await res.json()) as {
        data?: { written: number; cleared: number };
        error?: string;
      };
      if (!res.ok) throw new ApiError(body.error ?? "Gagal menyimpan bank narasi.");
      const written = body.data?.written ?? 0;
      const cleared = body.data?.cleared ?? 0;
      toast.success(
        cleared > 0
          ? `Narasi tersimpan: ${written} terisi, ${cleared} dikosongkan.`
          : `Narasi tersimpan: ${written} terisi.`,
      );
      await loadGrid();
    } catch (err) {
      toast.error(userMessage(err, "Gagal menyimpan bank narasi."));
    } finally {
      setSaving(false);
    }
  }

  async function handleClone() {
    if (!ready || dirty || saving || cloning || !cloneSourceTermId) return;
    setCloning(true);
    try {
      const res = await fetch("/api/admin/report-cards/templates/clone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceTermId: cloneSourceTermId,
          sourceAgeGroup: cloneSourceAgeGroup,
          targetTermId: termId,
          targetAgeGroup: ageGroup,
        }),
      });
      const body = (await res.json()) as {
        data?: { copied: number; skipped: number };
        error?: string;
      };
      if (!res.ok) throw new ApiError(body.error ?? "Gagal menyalin bank narasi.");
      const copied = body.data?.copied ?? 0;
      const skipped = body.data?.skipped ?? 0;
      toast.success(
        skipped > 0
          ? `${copied} narasi disalin, ${skipped} dilewati karena sudah terisi.`
          : `${copied} narasi disalin.`,
      );
      await loadGrid();
    } catch (err) {
      toast.error(userMessage(err, "Gagal menyalin bank narasi."));
    } finally {
      setCloning(false);
    }
  }

  const otherTerms = (terms ?? []).filter(
    (t) => !(t.id === termId && cloneSourceAgeGroup === ageGroup),
  );

  return (
    <>
      <ConfirmDialog
        open={pendingContext !== null}
        onOpenChange={(open) => { if (!open) setPendingContext(null); }}
        title="Buang perubahan narasi?"
        description="Perubahan belum disimpan. Tetap di sini untuk menyimpan, atau buang perubahan untuk berpindah."
        confirmLabel="Buang perubahan"
        cancelLabel="Tetap di sini"
        destructive
        onConfirm={() => { if (pendingContext) switchContext(pendingContext); }}
      />
      <PageHeader
        title="Bank Narasi Rapor"
        description="Susun narasi sekali per triwulan dan kelompok usia. Saat menyusun rapor siswa, narasi ini terpakai otomatis sesuai capaian yang dipilih."
        actions={
          // Only shown once terms exist — when the list is empty, the
          // EmptyState below already offers the same "Susun Rapor" CTA, and
          // showing both reads as a duplicate action.
          terms === null || terms.length > 0 ? (
            <GuardedLink href="/admin/report-cards" className={cn(buttonVariants({ variant: "outline" }))}>
              Susun Rapor
            </GuardedLink>
          ) : undefined
        }
      />

      <div className="space-y-section">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <Field className="min-w-56">
            <FieldLabel htmlFor="tmpl-term">Triwulan</FieldLabel>
            <NativeSelect
              id="tmpl-term"
              value={termId}
              disabled={saving || cloning}
              onChange={(e) => requestContext({ termId: e.target.value, ageGroup })}
            >
              {(terms ?? []).map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {termLabel(t)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field className="min-w-40">
            <FieldLabel htmlFor="tmpl-age">Kelompok usia</FieldLabel>
            <NativeSelect
              id="tmpl-age"
              value={ageGroup}
              disabled={saving || cloning}
              onChange={(e) => requestContext({ termId, ageGroup: e.target.value as AgeGroup })}
            >
              <NativeSelectOption value="A">A (4–5 tahun)</NativeSelectOption>
              <NativeSelectOption value="B">B (5–6 tahun)</NativeSelectOption>
            </NativeSelect>
          </Field>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant={filledCount === TOTAL_TEMPLATE_SLOTS ? "default" : "secondary"}>
              <span className="font-currency">
                {filledCount}/{TOTAL_TEMPLATE_SLOTS}
              </span>{" "}
              terisi
            </Badge>
            <Button onClick={handleSave} disabled={!ready || saving || cloning}>
              {saving ? "Menyimpan…" : "Simpan semua"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {terms !== null && terms.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Belum ada triwulan"
          description="Buat triwulan terlebih dahulu di halaman Rapor sebelum menyusun narasi."
          actionLabel="Susun Rapor"
          actionHref="/admin/report-cards"
        />
      )}

      {error && (
        <EmptyState
          icon={AlertCircle}
          title="Gagal memuat bank narasi"
          description={error}
          actionLabel="Coba lagi"
          onAction={() => void loadGrid()}
        />
      )}

      {loading && (
        <div className="space-y-3" aria-busy aria-live="polite">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {ready && terms !== null && terms.length > 0 && (
        <>
          {BUCKETED_SECTIONS.map((section) => (
            <Card key={section}>
              <CardHeader>
                <CardTitle className="text-h2">{SECTION_LABELS[section]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {LEVEL_ORDER.map((level: RaportLevel) => {
                  const key = bucketKey(section, level);
                  const id = `tmpl-${section}-${level}`;
                  return (
                    <Field key={level}>
                      <FieldLabel htmlFor={id}>{LEVEL_LABELS[level]}</FieldLabel>
                      <Textarea
                        id={id}
                        rows={3}
                        disabled={saving || cloning}
                        value={bucketed[key] ?? ""}
                        placeholder={`Narasi untuk anak dengan capaian "${LEVEL_LABELS[level]}" pada ${SECTION_LABELS[section]}…`}
                        onChange={(e) =>
                          setBucketed((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                      />
                    </Field>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-h2">Penutup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {CLOSING_SECTIONS.map((section) => {
                const id = `tmpl-${section}`;
                return (
                  <Field key={section}>
                    <FieldLabel htmlFor={id}>{SECTION_LABELS[section]}</FieldLabel>
                    <Textarea
                      id={id}
                      rows={3}
                        disabled={saving || cloning}
                      value={closing[section] ?? ""}
                      placeholder={`${SECTION_LABELS[section]} — berlaku untuk semua anak di kelompok ini…`}
                      onChange={(e) =>
                        setClosing((prev) => ({ ...prev, [section]: e.target.value }))
                      }
                    />
                  </Field>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h2">Salin dari triwulan lain</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Simpan perubahan sebelum menyalin narasi dari triwulan lain ke triwulan ini. Bagian yang
                sudah terisi di sini <strong>tidak</strong> akan tertimpa.
              </p>
              <div className="flex flex-wrap items-end gap-4">
                <Field className="min-w-56">
                  <FieldLabel htmlFor="clone-term">Triwulan sumber</FieldLabel>
                  <NativeSelect
                    id="clone-term"
                    value={cloneSourceTermId}
                    onChange={(e) => setCloneSourceTermId(e.target.value)}
                  >
                    <NativeSelectOption value="">Pilih triwulan…</NativeSelectOption>
                    {otherTerms.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {termLabel(t)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field className="min-w-40">
                  <FieldLabel htmlFor="clone-age">Kelompok usia sumber</FieldLabel>
                  <NativeSelect
                    id="clone-age"
                    value={cloneSourceAgeGroup}
                    onChange={(e) => setCloneSourceAgeGroup(e.target.value as AgeGroup)}
                  >
                    <NativeSelectOption value="A">A (4–5 tahun)</NativeSelectOption>
                    <NativeSelectOption value="B">B (5–6 tahun)</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Button
                  variant="outline"
                  onClick={handleClone}
                  disabled={!ready || dirty || saving || cloning || !cloneSourceTermId}
                >
                  <Copy className="size-4" />
                  {cloning ? "Menyalin…" : "Salin ke sini"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      </div>
    </>
  );
}
