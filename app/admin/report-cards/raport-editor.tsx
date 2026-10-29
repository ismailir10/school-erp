"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes-provider";
import { templateFor } from "@/lib/raport/templates";
import { raportAttendanceSchema, raportMeasurementSchema } from "@/lib/validations/raport";
import { toast } from "sonner";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { attendanceDrifted, describeAttendance } from "@/lib/raport/attendance-drift";
import {
  BUCKETED_SECTIONS,
  CLOSING_SECTIONS,
  SECTION_LABELS,
  SECTION_HAS_SUGGESTION,
  LEVEL_LABELS,
  LEVEL_ORDER,
  LEVEL_SHORT,
  type BucketedSection,
  type ReportSectionKey,
  type RaportLevel,
} from "@/lib/raport/labels";

type ElementCounts = {
  CONSISTENT: number;
  EMERGING: number;
  NEEDS_REINFORCEMENT: number;
  total: number;
};
type Draft = {
  sections: Record<BucketedSection, { suggested: RaportLevel | null; counts: ElementCounts }>;
  attendance: {
    permittedAbsenceDays: number;
    sickDays: number;
    unexcusedAbsenceDays: number;
    totalSchoolDays: number;
  };
};
type Saved = {
  sectionLevels: Record<string, RaportLevel>;
  sectionNarratives: Record<string, string>;
  permittedAbsenceDays: number;
  sickDays: number;
  unexcusedAbsenceDays: number;
  totalSchoolDays: number;
  memorizationNotes: string | null;
  status: string;
  publishedAt: string | null;
} | null;
type TemplateGridPayload = {
  bucketed: Record<string, string>;
  closing: Record<string, string>;
  filledCount: number;
  totalSlots: number;
};
type AttKey = "permitted" | "sick" | "unexcused" | "total";
type AttErrors = Partial<Record<AttKey, string>>;
type MeasurementErrors = { height?: string; weight?: string };

// API/schema field name -> editor measurement key (ADM-14).
const MEASUREMENT_KEY_BY_FIELD: Record<string, keyof MeasurementErrors> = {
  heightCm: "height",
  weightKg: "weight",
};

// API/schema field name -> editor state key, for mapping field errors back.
const ATT_KEY_BY_FIELD: Record<string, AttKey> = {
  permittedAbsenceDays: "permitted",
  sickDays: "sick",
  unexcusedAbsenceDays: "unexcused",
  totalSchoolDays: "total",
};

type Payload = {
  student: { id: string; name: string; nickname: string | null };
  term: { id: string; number: number; semesterNumber: number; academicYear: string };
  ageGroup: "A" | "B" | null;
  /** Bank narasi for this student's cohort; null when no active enrolment. */
  templates: TemplateGridPayload | null;
  saved: Saved;
  measurement: { heightCm: string | null; weightKg: string | null } | null;
  draft: Draft;
};

/** Every field the admin can edit — snapshotted on load and after save so
 * dirty-state comparison covers narratives, capaian levels, attendance,
 * hafalan and measurements alike. */
type EditableSnapshot = {
  levels: Record<string, string>;
  narratives: Record<string, string>;
  att: { permitted: string; sick: string; unexcused: string; total: string };
  hafalan: string;
  height: string;
  weight: string;
};

export function RaportEditor({
  studentId,
  termId,
  onBack,
}: {
  studentId: string;
  termId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [att, setAtt] = useState({ permitted: "0", sick: "0", unexcused: "0", total: "0" });
  const [attErrors, setAttErrors] = useState<AttErrors>({});
  const [hafalan, setHafalan] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [measurementErrors, setMeasurementErrors] = useState<MeasurementErrors>({});
  const [status, setStatus] = useState("NONE");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [syncingAttendance, setSyncingAttendance] = useState(false);
  // Snapshot of the last-loaded (or last-saved) values. `null` until the
  // first load resolves, so the editor is never dirty before there's
  // anything to compare against.
  const [baseline, setBaseline] = useState<EditableSnapshot | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Structural comparison against the snapshot — every field is a string or
  // a flat record of strings, so JSON equality is exact and order-stable
  // (the records are always built by iterating the same fixed section/field
  // lists, in load() and here alike).
  const isDirty = useMemo(() => {
    if (!baseline) return false;
    const current: EditableSnapshot = { levels, narratives, att, hafalan, height, weight };
    return JSON.stringify(current) !== JSON.stringify(baseline);
  }, [baseline, levels, narratives, att, hafalan, height, weight]);

  // Guards app-shell navigation (sidebar/breadcrumb clicks) via
  // GuardedLink — independent of, and never in conflict with, this
  // editor's own in-editor back-button guard (handleBack/confirmLeave
  // below) or the beforeunload handler (reload/close) just below.
  useUnsavedChangesGuard(
    isDirty,
    "Narasi, capaian, kehadiran, hafalan, atau data lain yang belum disimpan akan hilang.",
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom strings but `returnValue` is still the
      // canonical signal that a confirm dialog should fire.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleBack = useCallback(() => {
    if (isDirty) {
      setConfirmLeave(true);
      return;
    }
    onBack();
  }, [isDirty, onBack]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/report-cards/${studentId}/${termId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Gagal memuat rapor.");
        return;
      }
      const json = (await res.json()) as { data: Payload };
      const p = json.data;
      setData(p);

      const initLevels: Record<string, string> = {};
      for (const s of BUCKETED_SECTIONS) {
        if (!SECTION_HAS_SUGGESTION[s]) continue;
        initLevels[s] = p.saved?.sectionLevels?.[s] ?? p.draft.sections[s]?.suggested ?? "";
      }
      setLevels(initLevels);

      // Narratives: saved text wins; otherwise fall back to the cohort's
      // bank narasi for the level we just initialised. Only ever fills an EMPTY
      // field, so re-opening a saved raport never rewrites authored text.
      const initNarr: Record<string, string> = {};
      for (const s of [...BUCKETED_SECTIONS, ...CLOSING_SECTIONS]) {
        const savedText = p.saved?.sectionNarratives?.[s] ?? "";
        initNarr[s] =
          savedText ||
          (p.templates ? (templateFor(p.templates, s, initLevels[s]) ?? "") : "");
      }
      setNarratives(initNarr);

      const a = p.saved ?? p.draft.attendance;
      const initAtt = {
        permitted: String(a.permittedAbsenceDays ?? 0),
        sick: String(a.sickDays ?? 0),
        unexcused: String(a.unexcusedAbsenceDays ?? 0),
        total: String(a.totalSchoolDays ?? 0),
      };
      setAtt(initAtt);
      const initHafalan = p.saved?.memorizationNotes ?? "";
      const initHeight = p.measurement?.heightCm ?? "";
      const initWeight = p.measurement?.weightKg ?? "";
      setHafalan(initHafalan);
      setHeight(initHeight);
      setWeight(initWeight);
      setStatus(p.saved?.status ?? "NONE");
      setBaseline({
        levels: initLevels,
        narratives: initNarr,
        att: initAtt,
        hafalan: initHafalan,
        height: initHeight,
        weight: initWeight,
      });
    } catch {
      setError("Gagal memuat rapor.");
    }
  }, [studentId, termId]);

  useEffect(() => {
    load();
  }, [load]);

  const setAttField = (key: AttKey, value: string) => {
    setAtt((p) => ({ ...p, [key]: value }));
    // A stale message would keep claiming the old value is wrong (FIN-2 class).
    setAttErrors({});
  };

  const save = async (): Promise<boolean> => {
    // ACAD-1: Sakit / Izin / Alpa and their sum must fit inside Hari sekolah.
    // Same schema the PUT route enforces, so the message is identical.
    const attCheck = raportAttendanceSchema.safeParse({
      permittedAbsenceDays: Number(att.permitted) || 0,
      sickDays: Number(att.sick) || 0,
      unexcusedAbsenceDays: Number(att.unexcused) || 0,
      totalSchoolDays: Number(att.total) || 0,
    });
    if (!attCheck.success) {
      const next: AttErrors = {};
      for (const issue of attCheck.error.issues) {
        const key = ATT_KEY_BY_FIELD[String(issue.path[0])];
        if (key && !next[key]) next[key] = issue.message;
      }
      setAttErrors(next);
      toast.error("Periksa kolom kehadiran yang ditandai.");
      return false;
    }
    setAttErrors({});

    // ADM-14: height / weight within a human range, and never NaN on the wire.
    // Same schema the PUT route enforces, so the message is identical.
    const measurementCheck = raportMeasurementSchema.safeParse({
      heightCm: height.trim() ? Number(height) : null,
      weightKg: weight.trim() ? Number(weight) : null,
    });
    if (!measurementCheck.success) {
      const next: MeasurementErrors = {};
      for (const issue of measurementCheck.error.issues) {
        const key = MEASUREMENT_KEY_BY_FIELD[String(issue.path[0])];
        if (key && !next[key]) next[key] = issue.message;
      }
      setMeasurementErrors(next);
      toast.error("Periksa tinggi dan berat badan yang ditandai.");
      return false;
    }
    setMeasurementErrors({});

    setSaving(true);
    try {
      const sectionLevels: Record<string, string> = {};
      for (const [k, v] of Object.entries(levels)) if (v) sectionLevels[k] = v;
      const sectionNarratives: Record<string, string> = {};
      for (const [k, v] of Object.entries(narratives)) if (v.trim()) sectionNarratives[k] = v.trim();

      const res = await fetch(`/api/admin/report-cards/${studentId}/${termId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionLevels,
          sectionNarratives,
          permittedAbsenceDays: Number(att.permitted) || 0,
          sickDays: Number(att.sick) || 0,
          unexcusedAbsenceDays: Number(att.unexcused) || 0,
          totalSchoolDays: Number(att.total) || 0,
          memorizationNotes: hafalan.trim() || null,
          heightCm: height.trim() ? Number(height) : null,
          weightKg: weight.trim() ? Number(weight) : null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          errors?: { field?: string; message?: string }[];
        };
        // Surface a server-side attendance rejection on its field too.
        const next: AttErrors = {};
        const nextMeasurement: MeasurementErrors = {};
        for (const e of body.errors ?? []) {
          const key = e.field ? ATT_KEY_BY_FIELD[e.field] : undefined;
          if (key && e.message && !next[key]) next[key] = e.message;
          const mKey = e.field ? MEASUREMENT_KEY_BY_FIELD[e.field] : undefined;
          if (mKey && e.message && !nextMeasurement[mKey]) nextMeasurement[mKey] = e.message;
        }
        if (Object.keys(next).length > 0) {
          setAttErrors(next);
          toast.error("Periksa kolom kehadiran yang ditandai.");
        } else if (Object.keys(nextMeasurement).length > 0) {
          setMeasurementErrors(nextMeasurement);
          toast.error("Periksa tinggi dan berat badan yang ditandai.");
        } else {
          toast.error(body.error ?? "Gagal menyimpan rapor.");
        }
        return false;
      }
      if (status === "NONE") setStatus("DRAFT");
      // Re-baseline against what was just saved — a saved editor is clean
      // even though the field states themselves haven't changed shape.
      setBaseline({ levels, narratives, att, hafalan, height, weight });
      toast.success("Rapor disimpan.");
      return true;
    } finally {
      setSaving(false);
    }
  };

  const setPublish = async (publish: boolean) => {
    setPublishing(true);
    try {
      // Persist current edits first so publish acts on what the admin sees.
      if (publish && !(await save())) return;
      const res = await fetch(
        `/api/admin/report-cards/${studentId}/${termId}/${publish ? "publish" : "unpublish"}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Gagal mengubah status terbit.");
        return;
      }
      setStatus(publish ? "PUBLISHED" : "DRAFT");
      toast.success(publish ? "Rapor diterbitkan." : "Penerbitan ditarik.");
    } finally {
      setPublishing(false);
    }
  };

  // ACAD-2: re-read live presensi into the saved raport. A published raport keeps
  // its snapshot until this runs, so it is offered explicitly, never automatically.
  const syncAttendance = async () => {
    setSyncingAttendance(true);
    try {
      // Persist any pending edits first: the reload below would drop them.
      if (isDirty && !(await save())) return;
      const res = await fetch(`/api/admin/report-cards/${studentId}/${termId}/sync-attendance`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Gagal memperbarui kehadiran.");
        return;
      }
      toast.success("Kehadiran rapor diperbarui dari presensi terbaru.");
      await load();
    } finally {
      setSyncingAttendance(false);
    }
  };

  if (error) {
    return (
      <div>
        <BackBar onBack={handleBack} />
        <Card className="p-card">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            Coba lagi
          </Button>
        </Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <BackBar onBack={handleBack} />
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackBar onBack={handleBack} />
      <PageHeader
        title={`Rapor — ${data.student.name}`}
        description={`Triwulan ${data.term.number} · Semester ${data.term.semesterNumber} · ${data.term.academicYear}`}
      />

      <div className="flex items-center gap-2 mb-6">
        <StatusBadge status={status} label={status === "NONE" ? "Belum disimpan" : undefined} />
        {data.saved?.publishedAt && status === "PUBLISHED" ? (
          <span className="text-xs text-muted-foreground">Terbit</span>
        ) : null}
      </div>

      {data.saved && attendanceDrifted(data.saved, data.draft.attendance) ? (
        <Alert className="mb-6" data-testid="attendance-drift">
          <RefreshCw aria-hidden="true" />
          <AlertTitle>
            {status === "PUBLISHED"
              ? "Kehadiran berubah sejak rapor diterbitkan"
              : "Kehadiran berbeda dari presensi terbaru"}
          </AlertTitle>
          <AlertDescription>
            <p>Di rapor: {describeAttendance(data.saved)}.</p>
            <p>Presensi terbaru: {describeAttendance(data.draft.attendance)}.</p>
            {status === "PUBLISHED" ? (
              <p>Orang tua masih melihat angka di rapor sampai kehadiran diperbarui.</p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={syncAttendance}
              disabled={syncingAttendance || saving || publishing}
            >
              {syncingAttendance ? "Memperbarui…" : "Perbarui kehadiran"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Narrative sections */}
      <Card className="p-4 sm:p-card mb-6 space-y-6">
        <h2 className="text-h2">Narasi Perkembangan</h2>
        {BUCKETED_SECTIONS.map((s) => (
          <SectionField
            key={s}
            section={s}
            hasLevel={SECTION_HAS_SUGGESTION[s]}
            level={levels[s] ?? ""}
            onLevel={(v) => setLevels((p) => ({ ...p, [s]: v }))}
            narrative={narratives[s] ?? ""}
            onNarrative={(v) => setNarratives((p) => ({ ...p, [s]: v }))}
            suggestion={data.draft.sections[s]}
            templateText={
              data.templates ? templateFor(data.templates, s, levels[s]) : null
            }
          />
        ))}
        {CLOSING_SECTIONS.map((s) => (
          <SectionField
            key={s}
            section={s}
            hasLevel={false}
            level=""
            onLevel={() => {}}
            narrative={narratives[s] ?? ""}
            onNarrative={(v) => setNarratives((p) => ({ ...p, [s]: v }))}
            suggestion={null}
            templateText={data.templates ? templateFor(data.templates, s, null) : null}
          />
        ))}
      </Card>

      {/* Attendance + measurements + hafalan */}
      <Card className="p-4 sm:p-card mb-6">
        <h2 className="text-h2 mb-1">Kehadiran & Catatan</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Kehadiran terisi otomatis dari data presensi pada rentang triwulan — sunting bila perlu.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <NumField id="absence-sick" label="Sakit" value={att.sick} error={attErrors.sick} onChange={(v) => setAttField("sick", v)} />
          <NumField id="absence-permitted" label="Izin" value={att.permitted} error={attErrors.permitted} onChange={(v) => setAttField("permitted", v)} />
          <NumField id="absence-unexcused" label="Alpa" value={att.unexcused} error={attErrors.unexcused} onChange={(v) => setAttField("unexcused", v)} />
          <NumField id="absence-total" label="Hari sekolah" value={att.total} error={attErrors.total} onChange={(v) => setAttField("total", v)} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-4">
          {/* StudentMeasurement.height/weight are nullable and publish
              succeeds with both blank — the asterisk was claiming otherwise. */}
          <NumField
            id="measurement-height"
            label="Tinggi (cm)"
            value={height}
            error={measurementErrors.height}
            onChange={(v) => { setHeight(v); setMeasurementErrors((p) => ({ ...p, height: undefined })); }}
            step="0.1"
            max="250"
            optional
          />
          <NumField
            id="measurement-weight"
            label="Berat (kg)"
            value={weight}
            error={measurementErrors.weight}
            onChange={(v) => { setWeight(v); setMeasurementErrors((p) => ({ ...p, weight: undefined })); }}
            step="0.1"
            max="200"
            optional
          />
        </div>
        <Field className="mt-4">
          <FieldLabel htmlFor="hafalan">Hafalan (surah / hadis / doa)</FieldLabel>
          <Textarea id="hafalan" rows={3} value={hafalan} onChange={(e) => setHafalan(e.target.value)} />
        </Field>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving || publishing}>
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
        {status === "PUBLISHED" ? (
          <Button variant="destructive" onClick={() => setConfirmUnpublish(true)} disabled={publishing}>
            Tarik penerbitan
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setConfirmPublish(true)} disabled={publishing}>
            {publishing ? "Memproses…" : "Simpan & Terbitkan"}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => window.open(`/api/admin/report-cards/${studentId}/${termId}/pdf`, "_blank")}
          disabled={status === "NONE"}
        >
          <Download className="size-4" /> Unduh PDF
        </Button>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Keluar tanpa menyimpan?"
        description="Narasi, capaian, kehadiran, hafalan, atau data lain yang belum disimpan akan hilang."
        confirmLabel="Ya, Keluar"
        destructive
        onConfirm={onBack}
      />

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Terbitkan rapor ${data.student.name}?`}
        description="Orang tua akan langsung bisa melihat rapor ini."
        confirmLabel="Terbitkan"
        onConfirm={() => setPublish(true)}
      />

      <ConfirmDialog
        open={confirmUnpublish}
        onOpenChange={setConfirmUnpublish}
        title="Tarik penerbitan rapor?"
        description="Rapor akan kembali menjadi draft dan tidak terlihat sebagai rapor terbit sampai diterbitkan ulang."
        confirmLabel="Ya, Tarik"
        destructive
        onConfirm={() => setPublish(false)}
      />
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={onBack}>
      <ArrowLeft className="size-4" /> Kembali ke daftar
    </Button>
  );
}

function SectionField({
  section,
  hasLevel,
  level,
  onLevel,
  narrative,
  onNarrative,
  suggestion,
  templateText,
}: {
  section: ReportSectionKey;
  hasLevel: boolean;
  level: string;
  onLevel: (v: string) => void;
  narrative: string;
  onNarrative: (v: string) => void;
  suggestion: { suggested: RaportLevel | null; counts: ElementCounts } | null;
  /** Cohort bank narasi for the currently selected level, if any. */
  templateText: string | null;
}) {
  // Offer the action only when it would change something — no point showing
  // "Pakai narasi" when the field already holds exactly that text.
  const canApplyTemplate =
    templateText !== null && templateText.trim() !== narrative.trim();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={`narr-${section}`}>{SECTION_LABELS[section]}</FieldLabel>
        {hasLevel ? (
          // Below `sm` the suggestion and the select stack full-width instead of
          // one non-wrapping row that pushed the select off the card (DOC-5).
          <div className="flex w-full min-w-0 flex-col items-stretch gap-1 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            {suggestion && suggestion.counts.total > 0 ? (
              <span className="min-w-0 text-xs text-muted-foreground">
                Saran:{" "}
                {suggestion.suggested ? LEVEL_LABELS[suggestion.suggested] : "—"} (
                {LEVEL_ORDER.map((l) => `${suggestion.counts[l]}${LEVEL_SHORT[l]}`).join(" · ")})
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Belum ada penilaian</span>
            )}
            <NativeSelect
              size="sm"
              className="w-full sm:w-auto"
              aria-label={`Capaian ${SECTION_LABELS[section]}`}
              value={level}
              onChange={(e) => onLevel(e.target.value)}
            >
              <NativeSelectOption value="">— Capaian —</NativeSelectOption>
              {LEVEL_ORDER.map((l) => (
                <NativeSelectOption key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>
      <Textarea
        id={`narr-${section}`}
        rows={3}
        value={narrative}
        onChange={(e) => onNarrative(e.target.value)}
        placeholder={`Tulis narasi ${SECTION_LABELS[section].toLowerCase()}…`}
      />
      {canApplyTemplate ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onNarrative(templateText)}
        >
          {narrative.trim() ? "Ganti dengan narasi" : "Pakai narasi"}
        </Button>
      ) : null}
    </div>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  step,
  max,
  optional = false,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  /** Upper bound for the native number input (height / weight). */
  max?: string;
  /** Inline validation message; marks the input invalid and announces it. */
  error?: string;
  /** Drops the asterisk and the required/aria-required attributes. */
  optional?: boolean;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id} required={!optional}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min="0"
        step={step}
        max={max}
        required={!optional}
        aria-required={optional ? undefined : "true"}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
