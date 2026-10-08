"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import {
  bulkScopeIndicatorIds,
  decodeBulkScope,
  encodeBulkScope,
  planBulkChange,
  type BulkCategory,
  type BulkPlan,
} from "@/lib/student-journal/bulk";
import type { GridState } from "@/lib/student-journal/optimistic-save";

type Student = { id: string; name: string; nickname: string | null };

/** Attendance statuses that mean "not at school" — what the journal must not tick as present. */
export const BULK_ABSENCE_LABELS = {
  SICK: "Sakit",
  PERMISSION: "Izin",
  ABSENT: "Alpa",
} as const;

export type BulkAbsenceStatus = keyof typeof BULK_ABSENCE_LABELS;
/** studentId → why they are not at school on the journal date. Students absent from the map are treated as present. */
export type BulkAbsences = Record<string, BulkAbsenceStatus>;

export function isBulkAbsenceStatus(status: unknown): status is BulkAbsenceStatus {
  return typeof status === "string" && Object.hasOwn(BULK_ABSENCE_LABELS, status);
}

export type BulkApply = {
  plan: BulkPlan;
  checked: boolean;
  studentCount: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: Student[];
  categories: BulkCategory[];
  /** Live grid state — the counts on the buttons follow it, so they never promise work that is done. */
  state: GridState;
  /**
   * Children marked Sakit / Izin / Alpa for the journal date (TCHX-7). They start
   * unselected so "Tandai" does not tick "Datang di sekolah" for them; the
   * teacher can still opt any of them in. Omit when unknown — everyone is selected.
   */
  absences?: BulkAbsences;
  onApply: (apply: BulkApply) => void;
};

/**
 * "Isi cepat" for a whole class (TCH-7).
 *
 * The daily journal is exception-first like attendance: most days most
 * children did most things. Defaults are "semua indikator" x "semua siswa", so
 * the common case is: open, tap Tandai. Narrowing to a category or one
 * indicator, or to some students, is optional; per-student edits stay in the
 * accordion below and win over anything written here.
 *
 * Children who are absent today start unselected, flagged in the checklist.
 *
 * The sheet only *plans* the change; the page writes it through the same
 * optimistic + batched path as a single tap.
 */
export function ClassBulkSheet({
  open,
  onOpenChange,
  students,
  categories,
  state,
  absences = {},
  onApply,
}: Props) {
  const defaultSelection = () =>
    new Set(students.filter((s) => !absences[s.id]).map((s) => s.id));
  const [scopeValue, setScopeValue] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(defaultSelection);

  // Each opening starts from the common case, not from the last narrowing.
  useEffect(() => {
    if (open) {
      setScopeValue("all");
      setSelected(defaultSelection());
    }
    // Reset on open only: students changing under an open sheet is a reload, which closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scope = useMemo(() => decodeBulkScope(scopeValue), [scopeValue]);
  const studentIds = useMemo(
    () => students.filter((s) => selected.has(s.id)).map((s) => s.id),
    [students, selected],
  );
  const indicatorCount = bulkScopeIndicatorIds(categories, scope).length;
  const markPlan = useMemo(
    () => planBulkChange({ categories, state, scope, studentIds, checked: true }),
    [categories, state, scope, studentIds],
  );
  const clearPlan = useMemo(
    () => planBulkChange({ categories, state, scope, studentIds, checked: false }),
    [categories, state, scope, studentIds],
  );

  const allSelected = studentIds.length === students.length;
  const noneSelected = studentIds.length === 0;
  // Absent children the teacher has not opted back in. Counts down as they do.
  const skippedAbsent = students.filter((s) => absences[s.id] && !selected.has(s.id)).length;

  function toggleAll(next: boolean) {
    setSelected(next ? new Set(students.map((s) => s.id)) : new Set());
  }
  function toggleOne(id: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Isi cepat satu kelas"
      description="Tandai indikator untuk banyak siswa sekaligus. Setelah itu tiap siswa tetap bisa diubah satu per satu."
      size="md"
      contentClassName="p-card"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="tap-target"
            data-testid="bulk-clear"
            disabled={clearPlan.cells.length === 0}
            onClick={() =>
              onApply({ plan: clearPlan, checked: false, studentCount: studentIds.length })
            }
          >
            Kosongkan{clearPlan.cells.length > 0 ? ` (${clearPlan.cells.length})` : ""}
          </Button>
          <Button
            type="button"
            className="tap-target"
            data-testid="bulk-apply"
            disabled={markPlan.cells.length === 0}
            onClick={() =>
              onApply({ plan: markPlan, checked: true, studentCount: studentIds.length })
            }
          >
            <Check aria-hidden="true" />
            {markPlan.cells.length > 0 ? `Tandai (${markPlan.cells.length})` : "Tandai"}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="bulk-scope">Indikator</FieldLabel>
        <NativeSelect
          id="bulk-scope"
          className="w-full"
          selectClassName="tap-target"
          value={scopeValue}
          onChange={(e) => setScopeValue(e.target.value)}
        >
          <NativeSelectOption value="all">
            Semua indikator (
            {bulkScopeIndicatorIds(categories, { kind: "all" }).length})
          </NativeSelectOption>
          {categories.map((category) => (
            <NativeSelectOptGroup key={category.id} label={category.name}>
              <NativeSelectOption value={encodeBulkScope({ kind: "category", categoryId: category.id })}>
                Semua di {category.name} ({category.indicators.length})
              </NativeSelectOption>
              {category.indicators.map((indicator) => (
                <NativeSelectOption
                  key={indicator.id}
                  value={encodeBulkScope({ kind: "indicator", indicatorId: indicator.id })}
                >
                  {indicator.label}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel>Siswa</FieldLabel>
        <div className="rounded-lg border border-border">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 text-sm font-medium">
            <Checkbox
              data-testid="bulk-all-students"
              checked={allSelected}
              indeterminate={!allSelected && !noneSelected}
              onCheckedChange={(next) => toggleAll(next === true)}
            />
            Semua siswa ({students.length})
          </label>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto">
            {students.map((student) => (
              <li key={student.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                  <Checkbox
                    checked={selected.has(student.id)}
                    onCheckedChange={(next) => toggleOne(student.id, next === true)}
                  />
                  <span className="min-w-0 truncate">{student.name}</span>
                  {absences[student.id] ? (
                    <span
                      className="shrink-0 rounded-full bg-status-absent-subtle px-2 py-0.5 text-xs font-medium text-status-absent-text"
                      data-testid={`bulk-absence-${student.id}`}
                    >
                      {BULK_ABSENCE_LABELS[absences[student.id]]}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Field>

      {skippedAbsent > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="bulk-absent-note">
          {skippedAbsent} siswa tidak hadir di tanggal ini tidak dipilih.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground" data-testid="bulk-summary" aria-live="polite">
        {noneSelected
          ? "Pilih minimal satu siswa."
          : indicatorCount === 0
            ? "Tidak ada indikator di pilihan ini."
            : markPlan.cells.length === 0
              ? `${studentIds.length} siswa × ${indicatorCount} indikator: semuanya sudah tercentang.`
              : `${studentIds.length} siswa × ${indicatorCount} indikator: ${markPlan.cells.length} centang akan ditambahkan.`}
      </p>
    </ResponsiveFormDialog>
  );
}
