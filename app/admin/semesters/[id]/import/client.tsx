"use client";

import { BackLink } from "@/components/portal/back-link";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";
import { FileUp, RefreshCcw } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { userMessage } from "@/lib/api/client-errors";

type Semester = {
  id: string;
  number: 1 | 2;
  academicYearName: string;
  status: string;
};

type AgeGroup = "A" | "B";

type CurriculumElement =
  | "RELIGIOUS_MORAL"
  | "IDENTITY"
  | "STEAM"
  | "MOTOR_SKILLS"
  | "ART";

type PreviewIndicator = {
  order: number;
  content: string;
  themeNames: string[];
};
type PreviewObjective = {
  number: number;
  competencyText: string;
  content: string;
  indicators: PreviewIndicator[];
};
type ActiveConflict = {
  ageGroup: AgeGroup;
  element: CurriculumElement;
  number: number;
  existingContent: string;
};
type InactiveConflict = ActiveConflict & { existingId: string };

type Preview = {
  semesterId: string;
  ageGroup: AgeGroup;
  inferredAgeGroup: AgeGroup | null;
  filename: string;
  byElement: Partial<Record<CurriculumElement, PreviewObjective[]>>;
  counts: { objectives: number; indicators: number };
  themeLinks: { matched: number; unmatched: string[] };
  conflicts: {
    active: ActiveConflict[];
    inactive: InactiveConflict[];
  };
};

type ConflictPolicy = "block" | "skip" | "reactivate";

const ELEMENT_LABELS: Record<CurriculumElement, string> = {
  RELIGIOUS_MORAL: "Nilai Agama dan Budi Pekerti",
  IDENTITY: "Jati Diri",
  STEAM: "STEAM / Literasi",
  MOTOR_SKILLS: "Motorik",
  ART: "Seni",
};

const ELEMENT_ORDER: CurriculumElement[] = [
  "RELIGIOUS_MORAL",
  "IDENTITY",
  "STEAM",
  "MOTOR_SKILLS",
  "ART",
];

function ageGroupFromFilename(name: string): AgeGroup | null {
  const upper = name.toUpperCase();
  if (/\bTK\s*A\b/.test(upper)) return "A";
  if (/\bTK\s*B\b/.test(upper)) return "B";
  return null;
}

export function ImportPromesClient({ semester }: { semester: Semester }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(null);
  const [stage, setStage] = useState<"upload" | "preview">("upload");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Ref-based race guard. The `disabled` prop on the commit button trails
  // a render tick behind `setCommitting(true)`, so a fast double-click
  // could otherwise queue two parallel commits before React disables the
  // affordance. The ref turns the second invocation into a no-op the
  // instant the first one starts.
  const committingRef = useRef(false);
  // Conflict-alert focus target. After the upload resolves with
  // `conflicts.length > 0` we move screen-reader focus here so the
  // destructive warning is announced instead of silently appearing at
  // the bottom of the preview.
  const conflictAlertRef = useRef<HTMLDivElement>(null);

  // Filename heuristic. Pre-selects the radio without locking it — admin
  // can override before submit.
  const filenameHint = file ? ageGroupFromFilename(file.name) : null;
  const effectiveAgeGroup = ageGroup ?? filenameHint;

  const activeConflicts = preview?.conflicts.active ?? [];
  const inactiveConflicts = preview?.conflicts.inactive ?? [];
  const hasActiveConflicts = activeConflicts.length > 0;
  const hasInactiveConflicts = inactiveConflicts.length > 0;
  const themeLinks = preview?.themeLinks ?? { matched: 0, unmatched: [] };
  const unmatchedThemes = themeLinks.unmatched;
  const mismatchInferred = useMemo(() => {
    if (!preview || !preview.inferredAgeGroup) return false;
    return preview.inferredAgeGroup !== preview.ageGroup;
  }, [preview]);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError("Pilih berkas xlsx terlebih dahulu.");
      return;
    }
    if (!effectiveAgeGroup) {
      setFormError("Pilih Kelompok Usia (TK A atau TK B).");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("semesterId", semester.id);
      form.append("ageGroup", effectiveAgeGroup);
      const res = await fetch("/api/admin/curriculum/import-promes", {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as Partial<Preview> & {
        error?: string;
        duplicates?: Array<{ element: CurriculumElement; number: number }>;
      };
      if (!res.ok && res.status !== 409) {
        const msg =
          body.error ??
          "Gagal mengunggah berkas PROMES. Periksa format berkas lalu coba lagi.";
        setFormError(msg);
        setSubmitting(false);
        return;
      }
      // 200 OR 409 → both carry preview shape; we keep the admin on the
      // preview stage so they can see conflicts (if any).
      const previewBody = body as Preview;
      setPreview(previewBody);
      setStage("preview");
      // If conflicts surfaced, move keyboard + screen-reader focus to
      // the destructive alert so an SR user is not stranded at the top
      // of the page with silently appended danger content.
      const conflictCount =
        (previewBody.conflicts?.active?.length ?? 0) +
        (previewBody.conflicts?.inactive?.length ?? 0);
      if (conflictCount > 0) {
        // Defer to the next tick so the Alert has mounted.
        setTimeout(() => conflictAlertRef.current?.focus(), 0);
      }
    } catch (err) {
      setFormError(userMessage(err, "Gangguan jaringan saat unggah."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCommit(policy: ConflictPolicy = "block") {
    if (committingRef.current || !file || !preview) return;
    committingRef.current = true;
    setFormError(null);
    setCommitting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("semesterId", semester.id);
      form.append("ageGroup", preview.ageGroup);
      const res = await fetch(
        `/api/admin/curriculum/import-promes?commit=true&conflictPolicy=${policy}`,
        { method: "POST", body: form },
      );
      const body = (await res.json()) as {
        error?: string;
        counts?: { objectives: number; indicators: number };
        applied?: {
          created: number;
          reactivated: number;
          skipped: number;
          indicators: number;
          themeLinks: number;
          themeLinksUnmatched: string[];
        };
      };
      if (!res.ok) {
        setFormError(body.error ?? "Gagal menyimpan. Coba lagi sebentar ya.");
        setCommitting(false);
        committingRef.current = false;
        return;
      }
      const applied = body.applied;
      if (applied && (applied.reactivated > 0 || applied.skipped > 0)) {
        const parts = [`${applied.created} tujuan pembelajaran dibuat`];
        if (applied.reactivated > 0) parts.push(`${applied.reactivated} diaktifkan ulang`);
        if (applied.skipped > 0) parts.push(`${applied.skipped} dilewati`);
        parts.push(`${applied.indicators} indikator`);
        parts.push(`${applied.themeLinks} kaitan tema`);
        toast.success(`PROMES tersimpan: ${parts.join(", ")}.`);
      } else {
        const objectives = body.counts?.objectives ?? 0;
        const indicators = body.counts?.indicators ?? 0;
        const links = applied?.themeLinks ?? 0;
        toast.success(
          `PROMES berhasil diimpor: ${objectives} tujuan pembelajaran, ${indicators} indikator, ${links} kaitan tema.`,
        );
      }
      const unmatchedAfterCommit = applied?.themeLinksUnmatched ?? [];
      if (unmatchedAfterCommit.length > 0) {
        // Warn, don't block — the objectives/indicators did save.
        toast.warning(
          `${unmatchedAfterCommit.length} tema pada berkas belum ada di semester ini, jadi indikatornya belum terkait: ${unmatchedAfterCommit.slice(0, 3).join(", ")}${unmatchedAfterCommit.length > 3 ? ", …" : ""}`,
        );
      }
      router.push(`/admin/semesters/${semester.id}/themes`);
      router.refresh();
    } catch (err) {
      setFormError(userMessage(err, "Gangguan jaringan saat simpan."));
      setCommitting(false);
      committingRef.current = false;
    }
  }

  function handleReset() {
    setFile(null);
    setAgeGroup(null);
    setPreview(null);
    setStage("upload");
    setFormError(null);
  }

  return (
    <div className="space-y-section">
      <div>
        <BackLink
          href={`/admin/semesters/${semester.id}/themes`}
          label={`Kembali ke ${semester.academicYearName} · Semester ${semester.number}`}
        />
      </div>

      <PageHeader
        title="Impor PROMES (Program Semester)"
        description={`Unggah berkas PROMES per Kelompok Usia untuk semester ${semester.academicYearName} · Semester ${semester.number}. Sistem akan menampilkan pratinjau Tujuan Pembelajaran (TP) dan Indikator Ketercapaian (IKTP) sebelum menyimpan.`}
      />

      {stage === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Unggah berkas PROMES</CardTitle>
            <CardDescription>
              Format berkas <code>.xlsx</code>, maksimum 5 MB. Pratinjau
              tidak akan menyimpan apa pun ke basis data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="space-y-6">
              <Field>
                <FieldLabel htmlFor="promes-file">Berkas xlsx</FieldLabel>
                <Input
                  id="promes-file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) =>
                    setFile(e.currentTarget.files?.[0] ?? null)
                  }
                  required
                />
                {file && filenameHint && !ageGroup && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Kelompok usia terdeteksi dari nama berkas:{" "}
                    <strong>TK {filenameHint}</strong>. Anda dapat mengubahnya
                    di bawah.
                  </p>
                )}
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium leading-none">
                  Kelompok Usia
                </legend>
                <RadioGroup
                  value={effectiveAgeGroup ?? ""}
                  onValueChange={(v) => setAgeGroup(v as AgeGroup)}
                  aria-label="Kelompok Usia"
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="A" id="age-a" />
                    <FieldLabel htmlFor="age-a" className="cursor-pointer">
                      TK A (4–5 tahun)
                    </FieldLabel>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="B" id="age-b" />
                    <FieldLabel htmlFor="age-b" className="cursor-pointer">
                      TK B (5–6 tahun)
                    </FieldLabel>
                  </div>
                </RadioGroup>
              </fieldset>

              {formError && (
                <Alert variant="destructive">
                  <AlertTitle>Tidak bisa melanjutkan</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={submitting}>
                <FileUp className="size-4" />
                {submitting ? "Mengunggah…" : "Pratinjau PROMES"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {stage === "preview" && preview && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle>Pratinjau {preview.filename}</CardTitle>
                  <CardDescription>
                    Kelompok Usia <strong>TK {preview.ageGroup}</strong> ·{" "}
                    {preview.counts.objectives} tujuan pembelajaran ·{" "}
                    {preview.counts.indicators} indikator.
                    {mismatchInferred && (
                      <>
                        {" "}
                        Sistem mendeteksi{" "}
                        <strong>TK {preview.inferredAgeGroup}</strong> dari isi
                        berkas — pastikan pilihan Anda benar.
                      </>
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={committing}
                >
                  <RefreshCcw className="size-4" /> Mulai ulang
                </Button>
              </div>
            </CardHeader>
          </Card>

          {hasActiveConflicts && (
            <Alert
              ref={conflictAlertRef}
              tabIndex={-1}
              role="alert"
              variant="destructive"
            >
              <AlertTitle>
                {activeConflicts.length} konflik dengan tujuan pembelajaran
                aktif
              </AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Berkas ini tidak bisa disimpan apa adanya — baris di
                  semester ini sudah dipakai. Hapus baris bermasalah dari
                  berkas atau pilih semester lain, lalu unggah ulang.
                </p>
                <ul className="list-disc list-inside text-sm">
                  {activeConflicts.slice(0, 10).map((c) => (
                    <li key={`${c.element}-${c.number}`}>
                      TK {c.ageGroup} · {ELEMENT_LABELS[c.element]} · TP{" "}
                      {c.number}: <em>{c.existingContent}</em>
                    </li>
                  ))}
                  {activeConflicts.length > 10 && (
                    <li>
                      … dan {activeConflicts.length - 10} konflik lainnya
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {hasInactiveConflicts && !hasActiveConflicts && (
            <Alert
              ref={hasActiveConflicts ? undefined : conflictAlertRef}
              tabIndex={-1}
              role="alert"
            >
              <AlertTitle>
                {inactiveConflicts.length} tujuan pembelajaran nonaktif
                tertabrak
              </AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Baris di bawah ini sudah ada di semester ini dengan status
                  nonaktif (mungkin sisa dari penghapusan IKTP sebelumnya).
                  Pilih <strong>Lewati</strong> untuk membiarkan baris lama
                  tetap nonaktif, atau <strong>Aktifkan ulang</strong> untuk
                  menghidupkan kembali baris lama tanpa membuat duplikat.
                </p>
                <ul className="list-disc list-inside text-sm">
                  {inactiveConflicts.slice(0, 10).map((c) => (
                    <li key={`${c.element}-${c.number}`}>
                      TK {c.ageGroup} · {ELEMENT_LABELS[c.element]} · TP{" "}
                      {c.number}: <em>{c.existingContent}</em>
                    </li>
                  ))}
                  {inactiveConflicts.length > 10 && (
                    <li>
                      … dan {inactiveConflicts.length - 10} baris lainnya
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {ELEMENT_ORDER.map((element) => {
            const objectives = preview.byElement[element] ?? [];
            if (objectives.length === 0) return null;
            const visible = objectives.slice(0, 5);
            const remaining = objectives.length - visible.length;
            return (
              <Card key={element}>
                <CardHeader>
                  <CardTitle>{ELEMENT_LABELS[element]}</CardTitle>
                  <CardDescription>
                    {objectives.length} tujuan pembelajaran (TP) ·{" "}
                    {objectives.reduce(
                      (sum, o) => sum + o.indicators.length,
                      0,
                    )}{" "}
                    indikator
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {visible.map((o) => (
                    <div
                      key={`${element}-${o.number}`}
                      className="border-l-2 border-muted pl-3"
                    >
                      <p className="text-sm font-medium">
                        TP {o.number}: {o.competencyText}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {o.content}
                      </p>
                      <ol className="mt-1 list-decimal list-inside text-xs space-y-0.5">
                        {o.indicators.map((i) => (
                          <li key={`${element}-${o.number}-${i.order}`}>
                            {i.content}
                            {i.themeNames.length > 0 && (
                              <span className="text-muted-foreground">
                                {" "}
                                · tema: {i.themeNames.join(", ")}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  {remaining > 0 && (
                    <p className="text-xs text-muted-foreground">
                      … dan {remaining} TP lainnya akan ikut disimpan.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* IKTP×Tema resolution. Non-blocking by design: the import still
              runs, but an IKTP with no theme link never appears in the walas
              Penilaian Pekanan picker (it filters purely on theme link), so
              the admin needs to see this before confirming. */}
          {unmatchedThemes.length > 0 && (
            <Alert role="status">
              <AlertTitle>
                {unmatchedThemes.length} tema pada berkas belum ada di semester
                ini
              </AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  Tema berikut belum ada di semester ini — buat tema dulu di
                  halaman Tema, atau perbaiki nama kolomnya di berkas. Impor
                  tetap bisa dilanjutkan, tetapi indikator untuk tema ini tidak
                  akan muncul di Penilaian Pekanan walas.
                </p>
                <ul className="list-disc list-inside text-sm">
                  {unmatchedThemes.slice(0, 10).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                  {unmatchedThemes.length > 10 && (
                    <li>… dan {unmatchedThemes.length - 10} tema lainnya</li>
                  )}
                </ul>
                {themeLinks.matched > 0 && (
                  <p className="mt-2 text-sm">
                    {themeLinks.matched} kaitan IKTP×Tema lain sudah cocok dan
                    akan tersimpan.
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {unmatchedThemes.length === 0 && themeLinks.matched > 0 && (
            <Alert role="status">
              <AlertTitle>
                {themeLinks.matched} kaitan IKTP×Tema siap disimpan
              </AlertTitle>
              <AlertDescription>
                Semua nama tema pada berkas cocok dengan tema di semester ini.
                Indikator akan langsung muncul di Penilaian Pekanan walas pada
                pekan yang memakai tema tersebut.
              </AlertDescription>
            </Alert>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Gagal menyimpan</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {!hasActiveConflicts && !hasInactiveConflicts && (
              <Button
                onClick={() => handleCommit("block")}
                disabled={committing}
              >
                {committing ? "Menyimpan…" : "Konfirmasi & simpan"}
              </Button>
            )}
            {!hasActiveConflicts && hasInactiveConflicts && (
              <>
                <Button
                  onClick={() => handleCommit("reactivate")}
                  disabled={committing}
                >
                  {committing
                    ? "Menyimpan…"
                    : `Aktifkan ulang ${inactiveConflicts.length} & simpan`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleCommit("skip")}
                  disabled={committing}
                >
                  {committing ? "Menyimpan…" : "Lewati & simpan sisanya"}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={committing}
            >
              Batal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
