"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  ClassSectionMultiPicker,
  type ClassSection,
} from "@/components/admin/class-section-picker";
import { StudentPicker, type Student } from "@/components/admin/student-picker";
import { ClassSetupWarnings } from "@/components/admin/classes/class-setup-warnings";
import { checkClassSetup } from "@/lib/classes/setup-check";
import { userMessage, ApiError } from "@/lib/api/client-errors";
import { computeDefaultBillingForm, defaultDueDateForPeriod, type AcademicYear } from "./billing-defaults";
import { WizardFooter } from "./wizard-footer";
import type { CreateBillingRunPayload, CreateBillingRunResponse, DuplicateDraftConflict } from "./types";

// Step 1 — Scope (Cycle B1, Task T8). Periode / jatuh tempo / tahun ajaran
// mirror the legacy "Buat Tagihan" dialog in invoices-client.tsx exactly
// (same fields, same defaults, reused via `computeDefaultBillingForm` rather
// than re-derived) — class + student scoping on top is what's new.

function StudentChips({
  students,
  onRemove,
  emptyLabel,
  listLabel,
}: {
  students: Student[];
  onRemove: (id: string) => void;
  emptyLabel: string;
  listLabel: string;
}) {
  if (students.length === 0) {
    return <p className="text-small text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul aria-label={listLabel} className="flex flex-wrap gap-1.5">
      {students.map((s) => (
        <li key={s.id}>
          <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-1 pr-1 pl-2.5 text-small">
            {s.name}
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              aria-label={`Hapus ${s.name} dari daftar`}
              className="inline-flex size-5 items-center justify-center rounded-full opacity-70 hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X size={12} />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScopeStep({
  years,
  onAdvance,
  onCancel,
  notifyDraftChanged,
}: {
  years: AcademicYear[];
  onAdvance: (runId: string) => void;
  onCancel: () => void;
  notifyDraftChanged?: () => void;
}) {
  const [form, setForm] = useState(() => computeDefaultBillingForm(years));
  // The due date follows the typed period until the admin picks one
  // themselves — a deliberate choice is never overwritten.
  const dueDateEditedRef = useRef(false);
  // If step 1 mounts before `years` has loaded (the wizard can be opened
  // right after page load, racing the invoices-client academic-years
  // fetch), fill the default academic year in once it arrives.
  useEffect(() => {
    if (form.academicYearId || years.length === 0) return;
    setForm(computeDefaultBillingForm(years));
    // Only re-run when `years` transitions from empty — not on every
    // keystroke that touches `form`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  const [classSections, setClassSections] = useState<(ClassSection & { academicYearId: string })[]>([]);
  const [classSectionIds, setClassSectionIds] = useState<string[]>([]);
  const [includeStudents, setIncludeStudents] = useState<Student[]>([]);
  const [excludeStudents, setExcludeStudents] = useState<Student[]>([]);

  useEffect(() => {
    fetch("/api/class-sections?yearStatus=ACTIVE,PLANNING&include=fees")
      .then((r) => r.json())
      .then((json) => setClassSections(Array.isArray(json) ? json : []))
      .catch((err) => console.error("[billing-run-wizard] class sections fetch failed", err));
  }, []);

  // Billing follows each class's own program, so a class linked to the wrong
  // program (or one without a fee structure) bills wrongly without a word.
  const setupWarnings = useMemo(
    () =>
      checkClassSetup(
        classSections
          .filter((s) => classSectionIds.includes(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            programName: s.program.name,
            recurringFeeTotal: s.recurringFeeTotal,
          })),
      ),
    [classSections, classSectionIds],
  );

  const [scopeError, setScopeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set only on a 409 — the wizard offers to resume the existing draft or
  // cancel it and retry with the scope just filled in above.
  const [conflict, setConflict] = useState<DuplicateDraftConflict | null>(null);
  const [pendingPayload, setPendingPayload] = useState<CreateBillingRunPayload | null>(null);
  const [discarding, setDiscarding] = useState(false);

  function addIncludeStudent(s: Student | null) {
    if (!s) return;
    setIncludeStudents((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
  }
  function addExcludeStudent(s: Student | null) {
    if (!s) return;
    setExcludeStudents((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
  }

  const inScopeSummary =
    classSectionIds.length === 0 && includeStudents.length === 0
      ? "Belum ada cakupan dipilih."
      : `Cakupan saat ini: ${classSectionIds.length} kelas dipilih` +
        (includeStudents.length > 0 ? `, +${includeStudents.length} siswa tambahan` : "") +
        (excludeStudents.length > 0 ? `, −${excludeStudents.length} siswa dikecualikan` : "") +
        ".";

  // Resolves to "created" or "conflict" — any other failure throws an
  // `ApiError` for the caller's catch block, it never resolves to a third
  // "error" variant.
  async function createDraft(payload: CreateBillingRunPayload): Promise<
    | { kind: "created"; data: CreateBillingRunResponse }
    | { kind: "conflict"; data: DuplicateDraftConflict }
  > {
    const res = await fetch("/api/billing-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 201) {
      return { kind: "created", data: await res.json() };
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { kind: "conflict", data: { id: body.id, periodLabel: body.periodLabel } };
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.error || "Gagal membuat draf tagihan");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setScopeError(null);

    // Client-side mirror of createBillingRunSchema's superRefine: an empty
    // scope (no classes AND no explicit-include students) is rejected
    // inline, never silently treated as "everyone" or "nobody".
    if (classSectionIds.length === 0 && includeStudents.length === 0) {
      setScopeError("Pilih minimal satu kelas atau siswa untuk ditagih");
      return;
    }
    if (!form.periodLabel.trim() || !form.dueDate || !form.academicYearId) {
      toast.error("Lengkapi semua field");
      return;
    }

    const payload: CreateBillingRunPayload = {
      periodLabel: form.periodLabel,
      dueDate: form.dueDate,
      academicYearId: form.academicYearId,
      classSectionIds,
      includeStudentIds: includeStudents.map((s) => s.id),
      excludeStudentIds: excludeStudents.map((s) => s.id),
    };

    setSubmitting(true);
    try {
      const result = await createDraft(payload);
      if (result.kind === "created") {
        notifyDraftChanged?.();
        onAdvance(result.data.id);
        return;
      }
      // conflict — surface the resume-or-discard panel instead of silently
      // dropping the existing draft.
      setPendingPayload(payload);
      setConflict(result.data);
    } catch (err) {
      toast.error(userMessage(err, "Gagal membuat draf tagihan"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleResumeExisting() {
    if (!conflict) return;
    const id = conflict.id;
    setConflict(null);
    setPendingPayload(null);
    onAdvance(id);
  }

  async function handleDiscardAndRetry() {
    if (!conflict || !pendingPayload) return;
    setDiscarding(true);
    // Tracks whether the old draft is confirmed gone. If it is and the retry
    // then fails, keeping the conflict panel up would strand the admin: it
    // points at a CANCELLED run, so "Lanjutkan Draf" would open a dead run
    // and "Buang & Mulai Baru" would 409 forever, with no way back to the
    // form except closing the dialog — which unmounts this step and throws
    // away the scope they just entered.
    let oldDraftCancelled = false;
    try {
      const cancelRes = await fetch(`/api/billing-runs/${conflict.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (!cancelRes.ok) {
        const body = await cancelRes.json().catch(() => ({}));
        throw new ApiError(body?.error || "Gagal membuang draf lama");
      }
      oldDraftCancelled = true;
      notifyDraftChanged?.();
      const result = await createDraft(pendingPayload);
      if (result.kind === "created") {
        setConflict(null);
        setPendingPayload(null);
        notifyDraftChanged?.();
        onAdvance(result.data.id);
        return;
      }
      // Another draft appeared in the race between cancel and re-create —
      // re-surface the conflict panel with the new target rather than
      // looping silently.
      setConflict(result.data);
    } catch (err) {
      toast.error(userMessage(err, "Gagal membuang draf lama"));
      if (oldDraftCancelled) {
        // Old draft is gone, so there is nothing left to conflict with. Drop
        // the panel and hand the admin back their still-populated form.
        setConflict(null);
        setPendingPayload(null);
      }
    } finally {
      setDiscarding(false);
    }
  }

  if (conflict) {
    return (
      <div className="space-y-field">
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Sudah ada draf tagihan</AlertTitle>
          <AlertDescription>
            Draf untuk periode {conflict.periodLabel} belum diselesaikan. Lanjutkan draf itu,
            atau buang draf lama dan mulai draf baru dengan cakupan yang baru saja diisi.
          </AlertDescription>
        </Alert>
        <WizardFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setConflict(null);
              setPendingPayload(null);
            }}
            disabled={discarding}
          >
            Kembali
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDiscardAndRetry}
            disabled={discarding}
          >
            {discarding ? "Membuang..." : "Buang & Mulai Baru"}
          </Button>
          <Button type="button" onClick={handleResumeExisting} disabled={discarding}>
            Lanjutkan Draf
          </Button>
        </WizardFooter>
      </div>
    );
  }

  return (
    <form className="space-y-field" onSubmit={handleSubmit} noValidate>
      <Field>
        <FieldLabel required htmlFor="wizard-scope-period">Periode</FieldLabel>
        <Input
          id="wizard-scope-period"
          required
          aria-required="true"
          value={form.periodLabel}
          onChange={(e) => {
            const periodLabel = e.target.value;
            // Default "Jatuh Tempo" = end of the typed period's month, while
            // the admin has not chosen a date themselves and the label parses.
            const due = dueDateEditedRef.current ? null : defaultDueDateForPeriod(periodLabel);
            setForm((f) => ({ ...f, periodLabel, ...(due ? { dueDate: due } : {}) }));
          }}
          placeholder="April 2026"
        />
        <FieldDescription>Contoh: April 2026</FieldDescription>
      </Field>
      <Field>
        <FieldLabel required htmlFor="wizard-scope-due-date">Tanggal Jatuh Tempo</FieldLabel>
        <DatePicker
          id="wizard-scope-due-date"
          required
          value={form.dueDate}
          onChange={(v) => {
            dueDateEditedRef.current = true;
            setForm((f) => ({ ...f, dueDate: v }));
          }}
        />
      </Field>
      <Field>
        <FieldLabel required htmlFor="wizard-scope-academic-year">Tahun Ajaran</FieldLabel>
        <Select
          value={form.academicYearId}
          onValueChange={(v) => {
            if (!v || v === form.academicYearId) return;
            setForm((f) => ({ ...f, academicYearId: v }));
            setClassSectionIds([]);
            setScopeError(null);
          }}
        >
          <SelectTrigger id="wizard-scope-academic-year" aria-required="true">
            <SelectValue placeholder="Pilih tahun ajaran" />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y.id} value={y.id}>
                {y.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>Periode tagihan akan terikat ke tahun ajaran ini.</FieldDescription>
      </Field>

      <Field data-invalid={scopeError ? "true" : undefined}>
        <FieldLabel htmlFor="wizard-scope-classes">Kelas</FieldLabel>
        <ClassSectionMultiPicker
          id="wizard-scope-classes"
          sections={classSections.filter(section => section.academicYearId === form.academicYearId)}
          value={classSectionIds}
          onChange={(ids) => {
            setClassSectionIds(ids);
            if (scopeError) setScopeError(null);
          }}
          placeholder="Pilih kelas..."
          showProgram
        />
        <FieldDescription>Kelas mengikuti tahun ajaran terpilih. Semua siswa aktif di kelas terpilih akan ditagih.</FieldDescription>
        {scopeError && <FieldError>{scopeError}</FieldError>}
      </Field>

      <ClassSetupWarnings warnings={setupWarnings} />

      <Field>
        <FieldLabel htmlFor="wizard-scope-include">Siswa Tambahan</FieldLabel>
        <StudentPicker id="wizard-scope-include" selected={null} onSelect={addIncludeStudent} />
        <FieldDescription>Tambahkan siswa di luar cakupan kelas di atas.</FieldDescription>
        <StudentChips
          students={includeStudents}
          onRemove={(id) => setIncludeStudents((prev) => prev.filter((s) => s.id !== id))}
          emptyLabel="Belum ada siswa tambahan."
          listLabel="Daftar siswa tambahan"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="wizard-scope-exclude">Siswa Dikecualikan</FieldLabel>
        <StudentPicker id="wizard-scope-exclude" selected={null} onSelect={addExcludeStudent} />
        <FieldDescription>Siswa ini tidak akan ditagih meski masuk cakupan kelas.</FieldDescription>
        <StudentChips
          students={excludeStudents}
          onRemove={(id) => setExcludeStudents((prev) => prev.filter((s) => s.id !== id))}
          emptyLabel="Belum ada siswa dikecualikan."
          listLabel="Daftar siswa dikecualikan"
        />
      </Field>

      <p aria-live="polite" className="text-small text-muted-foreground">
        {inScopeSummary}
      </p>

      <WizardFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Batal
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Membuat..." : "Lanjutkan"}
        </Button>
      </WizardFooter>
    </form>
  );
}
