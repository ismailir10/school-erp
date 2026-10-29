"use client";

/**
 * Siswa data export configurator.
 *
 * Opened from the Students list PageHeader. Admin narrows row criteria
 * (status / gender / tahun ajaran / program / kelas) and picks which columns
 * to include (4 groups, per-group select-all), then downloads a filtered CSV
 * from `GET /api/students/export`.
 *
 * Overlay rule (ui.md): Dialog on desktop, Sheet on mobile — same body,
 * via `ResponsiveFormDialog`. No Cancel button in the footer: the shell's
 * own close affordance (X / Escape / outside-tap) is the only dismiss
 * path, same as before this was moved onto the shared component — the
 * lone footer action is the destination action ("Unduh CSV"), not a
 * mutation submit.
 */

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "@/components/ui/select";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatClassOptionLabel } from "@/lib/format";
import {
  STUDENT_EXPORT_COLUMNS,
  EXPORT_GROUP_LABELS,
  ALL_EXPORT_COLUMN_KEYS,
  type ExportColumnGroup,
} from "@/lib/students/export";

type RefItem = { id: string; name: string; programId?: string; academicYearId?: string };

type AcademicYearRef = { id: string; name: string; status: string };

// Class sections carry more than `RefItem` — the Kelas filter needs the
// nested academic year (for the Tahun-Ajaran grouping) and occupancy
// (for `formatClassOptionLabel`). `academicYear`/`_count` are optional so
// this still fits defensively if a caller ever narrows the API select.
type ClassSectionRef = RefItem & {
  academicYear?: AcademicYearRef | null;
  capacity?: number;
  _count?: { enrollments: number };
};

const GROUP_ORDER: ExportColumnGroup[] = ["identity", "compliance", "enrollment", "guardian"];

const YEAR_STATUS_RANK: Record<string, number> = { ACTIVE: 0, PLANNING: 1, ARCHIVED: 2 };

export type ClassSectionYearGroup = { year: AcademicYearRef; sections: ClassSectionRef[] };

/**
 * Groups class sections by academic year and orders the groups ACTIVE
 * first, then PLANNING, then ARCHIVED newest-first. Year names sort
 * correctly as plain strings ("2025/2026" > "2020/2021") because the
 * format is a consistent "YYYY/YYYY". Exported for direct unit coverage —
 * see `components/admin/__tests__/student-export-dialog.test.tsx`. Sibling
 * copy lives in `app/admin/student-attendance/page.tsx` — duplicated
 * rather than pulled into a shared lib module to keep this cycle's diff
 * scoped to the two picker surfaces it touches.
 */
export function groupClassSectionsByYear(sections: ClassSectionRef[]): ClassSectionYearGroup[] {
  const byYear = new Map<string, ClassSectionYearGroup>();
  for (const section of sections) {
    const year = section.academicYear;
    if (!year) continue;
    let group = byYear.get(year.id);
    if (!group) {
      group = { year, sections: [] };
      byYear.set(year.id, group);
    }
    group.sections.push(section);
  }
  return Array.from(byYear.values()).sort((a, b) => {
    const rankDiff =
      (YEAR_STATUS_RANK[a.year.status] ?? 3) - (YEAR_STATUS_RANK[b.year.status] ?? 3);
    if (rankDiff !== 0) return rankDiff;
    return b.year.name.localeCompare(a.year.name);
  });
}

const EXPORT_STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "INACTIVE", label: "Tidak Aktif" },
  { value: "GRADUATED", label: "Lulus" },
  { value: "WITHDRAWN", label: "Keluar" },
];
const GENDER_OPTIONS = [
  { value: "all", label: "Semua" },
  { value: "L", label: "Laki-laki" },
  { value: "P", label: "Perempuan" },
];

const TOTAL_COLUMNS = ALL_EXPORT_COLUMN_KEYS.length;

export function StudentExportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Row criteria
  const [status, setStatus] = useState("all");
  const [gender, setGender] = useState("all");
  const [academicYearId, setAcademicYearId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [classSectionId, setClassSectionId] = useState("all");

  // Column selection — every column on by default.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ALL_EXPORT_COLUMN_KEYS));

  // Reference data for the criteria dropdowns.
  const [years, setYears] = useState<RefItem[]>([]);
  const [programs, setPrograms] = useState<RefItem[]>([]);
  const [sections, setSections] = useState<ClassSectionRef[]>([]);
  const [refsLoaded, setRefsLoaded] = useState(false);

  useEffect(() => {
    if (!open || refsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [yRes, pRes, sRes] = await Promise.all([
          fetch("/api/academic-years"),
          fetch("/api/programs"),
          fetch("/api/class-sections"),
        ]);
        const [y, p, s] = await Promise.all([yRes.json(), pRes.json(), sRes.json()]);
        if (cancelled) return;
        setYears(Array.isArray(y) ? y : []);
        setPrograms(Array.isArray(p) ? p : []);
        setSections(Array.isArray(s) ? s : []);
        setRefsLoaded(true);
      } catch {
        if (!cancelled) toast.error(MESSAGES.loadFailed("Pilihan filter"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refsLoaded]);

  // Kelas options narrow to the chosen program / year. Changing program or
  // year resets the kelas pick inline (in the Select onValueChange handlers
  // below) rather than via an effect — a synchronous setState in an effect
  // trips the react-hooks/set-state-in-effect lint rule.
  const filteredSections = useMemo(
    () =>
      sections.filter(
        (s) =>
          (programId === "all" || s.programId === programId) &&
          (academicYearId === "all" || s.academicYearId === academicYearId),
      ),
    [sections, programId, academicYearId],
  );

  // Grouped by Tahun Ajaran, ACTIVE year first — this is a filter surface
  // over historical export data (not a write target), so it keeps every
  // year rather than narrowing to writable ones.
  const groupedSections = useMemo(
    () => groupClassSectionsByYear(filteredSections),
    [filteredSections],
  );

  const columnsByGroup = useMemo(() => {
    const map = new Map<ExportColumnGroup, typeof STUDENT_EXPORT_COLUMNS[number][]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const col of STUDENT_EXPORT_COLUMNS) map.get(col.group)!.push(col);
    return map;
  }, []);

  const toggleColumn = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (group: ExportColumnGroup, on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const col of columnsByGroup.get(group) ?? []) {
          if (on) next.add(col.key);
          else next.delete(col.key);
        }
        return next;
      });
    },
    [columnsByGroup],
  );

  const handleDownload = useCallback(() => {
    if (selected.size === 0) return;
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (gender !== "all") params.set("gender", gender);
    if (academicYearId !== "all") params.set("academicYearId", academicYearId);
    if (programId !== "all") params.set("programId", programId);
    if (classSectionId !== "all") params.set("classSectionId", classSectionId);
    // Omit `columns` when every column is selected — the server defaults to all.
    if (selected.size < TOTAL_COLUMNS) {
      params.set("columns", ALL_EXPORT_COLUMN_KEYS.filter((k) => selected.has(k)).join(","));
    }
    const qs = params.toString();
    const a = document.createElement("a");
    a.href = qs ? `/api/students/export?${qs}` : "/api/students/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Unduhan data siswa dimulai");
    onOpenChange(false);
  }, [selected, status, gender, academicYearId, programId, classSectionId, onOpenChange]);

  const body = (
    <div className="space-y-6">
      {/* Row criteria */}
      <div className="space-y-field">
        <SectionHeading label="Kriteria Siswa" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-field">
          <Field>
            <FieldLabel htmlFor="export-status">Status</FieldLabel>
            <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
              <SelectTrigger id="export-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPORT_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="export-gender">Jenis Kelamin</FieldLabel>
            <Select value={gender} onValueChange={(v) => setGender(v ?? "all")}>
              <SelectTrigger id="export-gender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="export-academic-year">Tahun Ajaran</FieldLabel>
            <Select
              value={academicYearId}
              onValueChange={(v) => {
                setAcademicYearId(v ?? "all");
                setClassSectionId("all");
              }}
            >
              <SelectTrigger id="export-academic-year">
                <SelectValue placeholder="Semua Tahun Ajaran" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tahun Ajaran</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y.id} value={y.id}>
                    {y.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="export-program">Program</FieldLabel>
            <Select
              value={programId}
              onValueChange={(v) => {
                setProgramId(v ?? "all");
                setClassSectionId("all");
              }}
            >
              <SelectTrigger id="export-program">
                <SelectValue placeholder="Semua Program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Program</SelectItem>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="export-class-section">Kelas</FieldLabel>
            <Select value={classSectionId} onValueChange={(v) => setClassSectionId(v ?? "all")}>
              <SelectTrigger id="export-class-section">
                <SelectValue placeholder="Semua Kelas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kelas</SelectItem>
                {groupedSections.map(({ year, sections: yearSections }) => (
                  <SelectGroup key={year.id}>
                    <SelectLabel>{`TA ${year.name}`}</SelectLabel>
                    {yearSections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {formatClassOptionLabel({
                          name: s.name,
                          enrolled: s._count?.enrollments ?? 0,
                          capacity: s.capacity ?? 0,
                        })}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      {/* Column selection */}
      <div className="space-y-field">
        <SectionHeading label="Kolom Data" />
        <div className="space-y-4">
          {GROUP_ORDER.map((group) => {
            const cols = columnsByGroup.get(group) ?? [];
            const allOn = cols.every((c) => selected.has(c.key));
            return (
              <div key={group} className="rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={allOn}
                    onCheckedChange={(checked) => toggleGroup(group, checked === true)}
                  />
                  {EXPORT_GROUP_LABELS[group]}
                </label>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pl-6">
                  {cols.map((col) => (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                      <Checkbox
                        checked={selected.has(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                      />
                      {col.header}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const downloadDisabled = selected.size === 0;
  const downloadButton = (
    <Button onClick={handleDownload} disabled={downloadDisabled}>
      <Download size={14} className="mr-1.5" />
      Unduh CSV{selected.size > 0 ? ` (${selected.size} kolom)` : ""}
    </Button>
  );
  const title = "Unduh Data Siswa";
  const description = "Pilih kriteria siswa dan kolom data, lalu unduh sebagai berkas CSV.";

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="2xl"
      footer={downloadButton}
    >
      {body}
    </ResponsiveFormDialog>
  );
}
