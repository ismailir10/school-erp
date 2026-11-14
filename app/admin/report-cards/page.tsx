"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LegacyColumnDef as ColumnDef } from "@tanstack/react-table/legacy";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import { DataTableToolbar } from "@/components/ui/data-table-toolbar";
import { DataTableLinkCell } from "@/components/ui/data-table-link-cell";
import { ResponsiveFormDialog } from "@/components/ui/responsive-form-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { ClipboardList, AlertCircle, Pencil, Plus } from "lucide-react";
import { disambiguateClassLabels } from "@/lib/format";
import { RaportEditor } from "./raport-editor";

type Term = {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  publishedAt: string | null;
  semester: { id: string; number: number; academicYear: { name: string } };
};
type ClassRow = {
  id: string;
  name: string;
  status: string;
  campus?: { id: string; name: string } | null;
  academicYear?: { id: string; name: string; status: string } | null;
};
type Semester = { id: string; number: number; academicYear: { name: string } };
type RosterRow = { studentId: string; name: string; nickname: string | null; status: string };

type TermDialogState =
  | { mode: "create"; term?: undefined }
  | { mode: "edit"; term: Term }
  | null;

function termLabel(t: Term) {
  return `Triwulan ${t.number} · Smt ${t.semester.number} ${t.semester.academicYear.name}`;
}

function toJakartaYmd(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function AdminRaportPage() {
  // `?termId=&classSectionId=&studentId=` so the student dossier's Akademik
  // rows can deep-link straight at one child's raport. Without it the link
  // landed on three empty selectors and the admin had to re-find the student
  // they had just clicked — the same reason `/admin/fees` learned `?tab=`.
  //
  // Seeded, not controlled: the params only set the *initial* selection, and
  // only for values that actually exist in the loaded lists (a stale link to an
  // archived cohort must not blank the page). Changing a selector afterwards is
  // never fought by the URL.
  const searchParams = useSearchParams();
  const deepLink = useRef({
    termId: searchParams.get("termId") ?? "",
    classSectionId: searchParams.get("classSectionId") ?? "",
    studentId: searchParams.get("studentId") ?? "",
  });
  const deepLinkApplied = useRef(false);
  const deepLinkStudentApplied = useRef(false);

  const [terms, setTerms] = useState<Term[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterRow | null>(null);
  const [termDialog, setTermDialog] = useState<TermDialogState>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterStatus, setRosterStatus] = useState("all");

  const loadSelectors = useCallback(async () => {
    // Settle each selector independently — one failing fetch (e.g. the raport
    // tables not yet migrated on a preview DB) must not blank the others.
    async function fetchData<T>(url: string): Promise<T[]> {
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: T[] };
        return json.data ?? [];
      } catch {
        return [];
      }
    }
    const [termData, classData, semData] = await Promise.all([
      fetchData<Term>("/api/admin/terms"),
      fetchData<ClassRow>("/api/admin/classes?pageSize=200"),
      fetchData<Semester>("/api/admin/curriculum/semesters?status=ACTIVE&pageSize=50"),
    ]);
    setTerms(termData);
    // Active section AND active academic year. `/api/admin/classes` only
    // filters by year when `yearId` is passed, so an unfiltered call returns
    // every cohort ever created — staging offered 15 options, 7 of them from
    // the archived 2024/2025 year, all sharing labels with the live ones. An
    // admin could draft a raport against the archived cohort without a hint.
    setClasses(
      classData.filter(
        (c) => c.status === "ACTIVE" && c.academicYear?.status === "ACTIVE",
      ),
    );
    setSemesters(semData);
  }, []);

  useEffect(() => {
    loadSelectors();
  }, [loadSelectors]);

  // Apply the deep link once the selector lists exist, and only for ids they
  // actually contain.
  useEffect(() => {
    if (deepLinkApplied.current || terms === null || classes === null) return;
    deepLinkApplied.current = true;
    const { termId: wantTerm, classSectionId: wantClass } = deepLink.current;
    if (wantTerm && terms.some((t) => t.id === wantTerm)) setTermId(wantTerm);
    if (wantClass && classes.some((c) => c.id === wantClass)) setClassId(wantClass);
  }, [terms, classes]);

  const rosterRequest = useRef(0);
  const loadRoster = useCallback(async () => {
    const request = ++rosterRequest.current;
    if (!termId || !classId) {
      setRoster(null);
      setLoadingRoster(false);
      return;
    }
    setLoadingRoster(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/admin/report-cards?termId=${termId}&classSectionId=${classId}`);
      if (request !== rosterRequest.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (request !== rosterRequest.current) return;
        setRosterError(body.error ?? "Gagal memuat daftar siswa.");
        setRoster(null);
        return;
      }
      const json = (await res.json()) as { data: { roster: RosterRow[] } };
      if (request === rosterRequest.current) setRoster(json.data.roster);
    } catch {
      if (request !== rosterRequest.current) return;
      setRosterError("Gagal memuat daftar siswa.");
      setRoster(null);
    } finally {
      if (request === rosterRequest.current) setLoadingRoster(false);
    }
  }, [termId, classId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // Open the editor on the linked student once their roster row exists. Fires
  // at most once, so closing the editor does not bounce straight back into it.
  useEffect(() => {
    if (deepLinkStudentApplied.current || !roster) return;
    const wanted = deepLink.current.studentId;
    if (!wanted) return;
    const row = roster.find((r) => r.studentId === wanted);
    if (!row) return;
    deepLinkStudentApplied.current = true;
    setSelected(row);
  }, [roster]);

  const currentTerm = useMemo(
    () => (terms ?? []).find((term) => term.id === termId) ?? null,
    [terms, termId],
  );

  // One year still runs the same class name on several campuses, so append
  // the campus to colliding names only.
  const classOptions = useMemo(
    () =>
      disambiguateClassLabels(
        (classes ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          campusName: c.campus?.name ?? null,
        })),
      ),
    [classes],
  );

  const filteredRoster = useMemo(() => {
    const query = rosterSearch.trim().toLowerCase();
    return (roster ?? []).filter((row) => {
      const matchesQuery =
        !query ||
        row.name.toLowerCase().includes(query) ||
        (row.nickname ?? "").toLowerCase().includes(query);
      const matchesStatus = rosterStatus === "all" || row.status === rosterStatus;
      return matchesQuery && matchesStatus;
    });
  }, [roster, rosterSearch, rosterStatus]);

  const rosterColumns = useMemo<ColumnDef<RosterRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Siswa" />,
        cell: ({ row }) => (
          <DataTableLinkCell
            onClick={() => setSelected(row.original)}
            description={row.original.nickname ?? undefined}
          >
            {row.original.name}
          </DataTableLinkCell>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} label={row.original.status === "NONE" ? "Belum dibuat" : undefined} />,
      },
    ],
    [],
  );

  if (selected && termId) {
    return (
      <RaportEditor
        studentId={selected.studentId}
        termId={termId}
        onBack={() => {
          setSelected(null);
          loadRoster();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Rapor"
        description="Susun & terbitkan rapor triwulan — terisi otomatis dari penilaian, dapat disunting."
      />

      <div className="space-y-section">
      {terms !== null && terms.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Belum ada triwulan."
          description="Buat triwulan untuk menentukan rentang penilaian dan kehadiran yang dirangkum ke rapor."
          actionLabel="Tambah Triwulan"
          onAction={() => setTermDialog({ mode: "create" })}
        />
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end mb-6">
            <Field className="sm:w-72">
              <FieldLabel htmlFor="term">Triwulan</FieldLabel>
              <NativeSelect id="term" className="w-full" value={termId} onChange={(e) => setTermId(e.target.value)}>
                <NativeSelectOption value="">— Pilih triwulan —</NativeSelectOption>
                {(terms ?? []).map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {termLabel(t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="sm:w-64">
              <FieldLabel htmlFor="class">Kelas</FieldLabel>
              <NativeSelect id="class" className="w-full" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <NativeSelectOption value="">— Pilih kelas —</NativeSelectOption>
                {classOptions.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button variant="outline" size="sm" onClick={() => setTermDialog({ mode: "create" })}>
              <Plus className="size-4" /> Triwulan
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => currentTerm && setTermDialog({ mode: "edit", term: currentTerm })}
              disabled={!currentTerm}
            >
              <Pencil className="size-4" /> Ubah Triwulan
            </Button>
          </div>

          {!termId || !classId ? (
            <EmptyState
              icon={ClipboardList}
              title="Pilih triwulan & kelas."
              description="Pilih triwulan dan kelas untuk melihat daftar siswa dan menyusun rapor."
            />
          ) : rosterError ? (
            <EmptyState
              icon={AlertCircle}
              title="Tidak dapat memuat daftar."
              description={rosterError}
              actionLabel="Coba lagi"
              onAction={loadRoster}
            />
          ) : loadingRoster ? (
            <div className="space-y-3" aria-busy="true" aria-live="polite">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : roster && roster.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada siswa aktif di kelas ini."
              description="Pastikan siswa terdaftar aktif pada kelas terpilih."
            />
          ) : roster ? (
            <>
              <DataTableToolbar
                searchPlaceholder="Cari siswa atau panggilan..."
                value={rosterSearch}
                onValueChange={setRosterSearch}
                filters={[
                  {
                    key: "status",
                    label: "Status",
                    value: rosterStatus,
                    resetValue: "all",
                    onChange: setRosterStatus,
                    options: [
                      { value: "all", label: "Semua Status" },
                      { value: "NONE", label: "Belum Dibuat" },
                      { value: "DRAFT", label: "Draft" },
                      { value: "PUBLISHED", label: "Terbit" },
                    ],
                  },
                ]}
              />
              <DataTable
                columns={rosterColumns}
                data={filteredRoster}
                pagination={{
                  page: 1,
                  pageSize: 10,
                  total: filteredRoster.length,
                  totalPages: Math.max(1, Math.ceil(filteredRoster.length / 10)),
                }}
                emptyTitle="Tidak ada siswa sesuai filter."
                emptyDescription="Ubah pencarian atau status rapor untuk melihat daftar siswa."
              />
            </>
          ) : null}
        </>
      )}
      </div>

      <TermFormDialog
        open={termDialog !== null}
        mode={termDialog?.mode ?? "create"}
        term={termDialog?.mode === "edit" ? termDialog.term : null}
        semesters={semesters}
        onOpenChange={(open) => {
          if (!open) setTermDialog(null);
        }}
        onSaved={(savedTermId) => {
          setTermDialog(null);
          setTermId(savedTermId);
          loadSelectors();
        }}
      />
    </>
  );
}

function TermFormDialog({
  open,
  mode,
  term,
  semesters,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  term: Term | null;
  semesters: Semester[];
  onOpenChange: (open: boolean) => void;
  onSaved: (termId: string) => void;
}) {
  const [semesterId, setSemesterId] = useState("");
  const [number, setNumber] = useState("1");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSemesterId(term?.semester.id ?? "");
    setNumber(String(term?.number ?? 1));
    setStartDate(term ? toJakartaYmd(term.startDate) : "");
    setEndDate(term ? toJakartaYmd(term.endDate) : "");
  }, [open, term]);

  const submit = async () => {
    if (!semesterId || !startDate || !endDate) {
      toast.error("Lengkapi semester dan tanggal triwulan.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(mode === "edit" && term ? `/api/admin/terms/${term.id}` : "/api/admin/terms", {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "edit"
            ? { number: Number(number), startDate, endDate }
            : { semesterId, number: Number(number), startDate, endDate },
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? (mode === "edit" ? "Gagal menyimpan triwulan." : "Gagal membuat triwulan."));
        return;
      }
      const body = (await res.json()) as { data?: { id: string } };
      toast.success(mode === "edit" ? "Triwulan disimpan." : "Triwulan dibuat.");
      onSaved(body.data?.id ?? term?.id ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Ubah Triwulan" : "Tambah Triwulan"}
      description="Triwulan menentukan rentang tanggal penilaian dan kehadiran yang dirangkum ke rapor."
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button type="button" onClick={submit} disabled={saving}>
            {saving ? "Menyimpan..." : mode === "edit" ? "Simpan Perubahan" : "Tambah Triwulan"}
          </Button>
        </>
      }
    >
        <Field>
          <FieldLabel htmlFor="t-sem" required>Semester</FieldLabel>
          <NativeSelect
            id="t-sem"
            className="w-full"
            value={semesterId}
            onChange={(e) => setSemesterId(e.target.value)}
            required
            disabled={mode === "edit"}
          >
            <NativeSelectOption value="">— Pilih —</NativeSelectOption>
            {semesters.map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                Smt {s.number} {s.academicYear.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="t-num" required>Triwulan ke-</FieldLabel>
          <NativeSelect id="t-num" className="w-full" value={number} onChange={(e) => setNumber(e.target.value)} required>
            <NativeSelectOption value="1">1</NativeSelectOption>
            <NativeSelectOption value="2">2</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="t-start" required>Mulai</FieldLabel>
          <DatePicker id="t-start" value={startDate} max={endDate || undefined} onChange={(v) => setStartDate(v)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="t-end" required>Selesai</FieldLabel>
          <DatePicker id="t-end" value={endDate} min={startDate || undefined} onChange={(v) => setEndDate(v)} required />
        </Field>
    </ResponsiveFormDialog>
  );
}
