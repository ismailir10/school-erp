"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DetailPageHeader, type DetailPageHeaderAction } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { DossierNav, type DossierSectionDef } from "@/components/admin/dossier-section";
import { DetailRail, RailCard, RailKV, RailStatTiles } from "@/components/admin/detail-rail";
import type { SessionRow } from "@/components/admin/class-sessions-calendar";
import { EditClassDialog } from "@/components/admin/classes/detail/edit-class-dialog";
import { RosterSection } from "@/components/admin/classes/detail/roster-section";
import { EntityLink } from "@/components/entity-link";
import { entityHref } from "@/lib/entity-links";
import { TeachersSection } from "@/components/admin/classes/detail/teachers-section";
import { SessionsSection } from "@/components/admin/classes/detail/sessions-section";
import type { TeacherOptionsStatus } from "@/components/admin/classes/detail/teacher-option-items";
import { SwapSessionDialog } from "@/components/admin/classes/detail/swap-session-dialog";
import { SECTION_ROSTER, SECTION_TEACHERS, SECTION_SESSIONS, type ClassDetail, type Employee } from "@/components/admin/classes/detail/types";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

/**
 * Class-detail orchestrator. Owns `data`, `fetchDetail`, the Dossier
 * open/collapse + hash-anchor state, `writeAllowed`, and the employee
 * options shared by the add-teacher and swap-session dialogs. Everything
 * else — the roster/teachers/sessions sections, and every dialog — lives in
 * `components/admin/classes/detail/*` (T2, 2026-09-27 admin-finish-standard
 * cycle split of what used to be a single 1550-line component).
 */
export function ClassDetailClient({
  classId,
  canWrite,
  canViewEmployees = false,
}: {
  classId: string;
  canWrite: boolean;
  /** Viewer has `hr.view`: employee names link to their page. */
  canViewEmployees?: boolean;
}) {
  const isMobile = useIsMobile();

  // Detail data is the source of truth for header + roster + teachers.
  const [data, setData] = useState<ClassDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);

  // Deactivate / reactivate confirms
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  // ── Calendar state (relocated from class-sections detail) ───────
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [employeesTruncated, setEmployeesTruncated] = useState(false);
  const [employeesStatus, setEmployeesStatus] = useState<TeacherOptionsStatus>(
    canWrite ? "loading" : "ready",
  );
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(
    null,
  );

  // ── Dossier section open/collapse state ──────────────────────────
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    [SECTION_ROSTER]: true,
    [SECTION_TEACHERS]: true,
    [SECTION_SESSIONS]: true,
  });
  const setSectionOpen = useCallback((sectionId: string, open: boolean) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: open }));
  }, []);

  /** Nav click: expand first (a collapsed target is nothing to scroll to), then scroll. */
  const jumpToSection = useCallback(
    (sectionId: string) => {
      setSectionOpen(sectionId, true);
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [setSectionOpen],
  );

  // ── Derived flags ───────────────────────────────────────────────
  const archived = data?.academicYear.status === "ARCHIVED";
  const writeAllowed = canWrite && !archived;
  const homeroomAssignment =
    data?.teachingAssignments.find((a) => a.role === "HOMEROOM") ?? null;
  const enrolledCount = data?.enrollments.length ?? 0;

  // Health metric inputs — `attendance7dPct` + `todaySession` are not exposed
  // by the detail GET this cycle (list page enrichment lives on the index
  // route). Wires up when the detail endpoint adds health enrichment in a
  // follow-up. For now the rail's Kehadiran + Sesi tiles render dashes.
  const attendance7dPct = null as number | null;
  const todaySession = null as "Held" | "Missing" | "Holiday" | null;

  // ── Detail fetch ────────────────────────────────────────────────
  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/classes/${classId}`);
      if (!res.ok) {
        setLoadError(true);
        setData(null);
        return;
      }
      const json = (await res.json()) as ClassDetail;
      setData(json);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // ── Calendar fetch ──────────────────────────────────────────────
  const fetchSessions = useCallback(() => {
    setSessionsLoading(true);
    setSessionsError(false);
    const m = `${year}-${String(month).padStart(2, "0")}`;
    fetch(`/api/admin/class-sessions?classSectionId=${classId}&month=${m}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows: SessionRow[]) => {
        setSessions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        setSessions([]);
        setSessionsError(true);
      })
      .finally(() => setSessionsLoading(false));
  }, [classId, month, year]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Teacher options (for swap drawer + add-teacher dialog) ──────
  // Deliberately NOT `/api/employees`: that endpoint needs `hr.view`, which
  // SCHOOL_ADMIN lacks, so the picker 403'd into a false "no teachers" state.
  // The class-scoped endpoint is gated on `academic.edit` — the same
  // permission as the assignment write it feeds — and returns only
  // id/nama/formalName. See docs/cycles/2026-10-01-teacher-picker-access.md.
  const loadTeacherOptions = useCallback(() => {
    setEmployeesStatus("loading");
    fetch(`/api/admin/classes/${classId}/teacher-options?pageSize=100`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => {
        const list: Employee[] = json?.data ?? [];
        const total: number = json?.pagination?.total ?? list.length;
        setEmployeeOptions(
          list.map((e) => ({
            id: e.id,
            nama: e.nama,
            formalName: e.formalName ?? null,
          })),
        );
        setEmployeesTruncated(total > list.length);
        setEmployeesStatus("ready");
      })
      .catch(() => {
        setEmployeeOptions([]);
        setEmployeesTruncated(false);
        setEmployeesStatus("error");
      });
  }, [classId]);

  useEffect(() => {
    if (!canWrite) return;
    loadTeacherOptions();
  }, [canWrite, loadTeacherOptions]);

  // ── Header actions ──────────────────────────────────────────────
  function openEdit() {
    setEditOpen(true);
  }

  async function flipStatus(target: "ACTIVE" | "INACTIVE") {
    if (!data) return;
    const res =
      target === "INACTIVE"
        ? await fetch(`/api/admin/classes/${classId}`, { method: "DELETE" })
        : await fetch(`/api/admin/classes/${classId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ACTIVE" }),
          });
    if (res.ok) {
      toast.success(
        target === "ACTIVE" ? "Kelas diaktifkan" : "Kelas dinonaktifkan",
      );
      fetchDetail();
    } else {
      const d = await res.json().catch(() => ({}));
      toast.error(d.error ?? "Gagal");
    }
  }

  // ── Calendar handlers (verbatim from class-sections client) ─────
  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  // ── Deep-linkable sections ────────────────────────────────────────
  // `#roster`, `#teachers`, `#sessions` — every section id is already a DOM
  // anchor, but the browser's own hash scroll fires before the section
  // exists and lands on nothing. Honouring the hash ourselves (once the
  // class has loaded) is what makes a link into the dossier actually work.
  const hashHandled = useRef(false);
  useEffect(() => {
    if (loading || hashHandled.current) return;
    const target = window.location.hash.replace(/^#/, "");
    if (!target) {
      hashHandled.current = true;
      return;
    }
    if (!document.getElementById(target)) return;
    hashHandled.current = true;
    jumpToSection(target);
  }, [loading, jumpToSection]);

  // ── Render guards ───────────────────────────────────────────────
  if (loading) {
    return <DetailPageSkeleton />;
  }

  if (loadError || !data) {
    return (
      <EmptyState
        title="Kelas tidak ditemukan"
        description="Kelas tidak ada atau Anda tidak memiliki akses."
      />
    );
  }

  const homeroomLabel = homeroomAssignment
    ? ` · Wali Kelas: ${homeroomAssignment.employee.nama}`
    : "";

  // Section labels for the Sesi Hari Ini rail tile
  const sesiHariIniLabel =
    todaySession === "Held"
      ? "Berlangsung"
      : todaySession === "Missing"
        ? "Belum dibuat"
        : todaySession === "Holiday"
          ? "Libur"
          : "—";

  const navSections: DossierSectionDef[] = [
    { id: SECTION_ROSTER, label: "Daftar Siswa" },
    { id: SECTION_TEACHERS, label: "Guru Pengajar" },
    { id: SECTION_SESSIONS, label: "Kalender Sesi" },
  ];

  const statTiles = [
    { label: "Roster", value: `${enrolledCount}/${data.capacity}` },
    {
      label: "Kehadiran 7 Hari",
      value:
        attendance7dPct !== null ? `${attendance7dPct.toFixed(0)}%` : "—",
    },
    { label: "Sesi Hari Ini", value: sesiHariIniLabel },
  ];

  const summaryItems = [
    { label: "Kondisi", value: <StatusBadge status={data.status} /> },
    {
      label: "Wali Kelas",
      value: homeroomAssignment ? (
        <EntityLink
          href={canViewEmployees ? entityHref.employee(homeroomAssignment.employee.id) : null}
        >
          {homeroomAssignment.employee.nama}
        </EntityLink>
      ) : (
        "—"
      ),
    },
    { label: "Program", value: data.program.name },
    { label: "Tahun Ajaran", value: data.academicYear.name },
    { label: "Kampus", value: data.campus.name },
    {
      label: "Pola Waktu",
      value:
        data.slotTemplate === "FULL_DAY" ? "Sehari Penuh" : "Pagi & Sore",
    },
    { label: "Kapasitas", value: String(data.capacity) },
  ];

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────── */}
      <DetailPageHeader
        backHref="/admin/classes"
        backLabel="Kembali ke Daftar Kelas"
        title={`${data.name} · ${data.academicYear.name}`}
        description={`${data.program.name}${homeroomLabel}`}
        badge={<Badge variant="outline">{data.campus.name}</Badge>}
        primaryActions={
          writeAllowed
            ? [
                { label: "Ubah", onClick: openEdit },
                // Aktifkan is not destructive, so it stays visible alongside
                // Ubah; Nonaktifkan (destructive) goes to the overflow menu
                // instead of a third visible button.
                ...(data.status === "ACTIVE"
                  ? []
                  : ([{ label: "Aktifkan", onClick: () => setReactivateOpen(true) }] as DetailPageHeaderAction[])),
              ]
            : []
        }
        menuActions={
          writeAllowed && data.status === "ACTIVE"
            ? [{ label: "Nonaktifkan", onClick: () => setDeactivateOpen(true), destructive: true }]
            : []
        }
      />

      {archived && (
        <div className="mb-section rounded-md border border-status-leave bg-status-leave-subtle px-4 py-3 text-sm text-status-leave-text">
          Tahun ajaran ini sudah diarsipkan. Tampilan hanya baca.
        </div>
      )}

      {/* Mobile: the rail's numbers move above the sections so the first
          viewport still answers "how is this class doing". */}
      {isMobile && (
        <div className="mb-4">
          <RailStatTiles tiles={statTiles} />
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <DossierNav sections={navSections} onJump={jumpToSection} />

          <RosterSection
            classId={classId}
            classDisplayName={data.name}
            capacity={data.capacity}
            enrollments={data.enrollments}
            writeAllowed={writeAllowed}
            open={openSections[SECTION_ROSTER] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_ROSTER, o)}
            onChanged={fetchDetail}
          />

          <TeachersSection
            classId={classId}
            classDisplayName={data.name}
            teachingAssignments={data.teachingAssignments}
            employeeOptions={employeeOptions}
            employeesTruncated={employeesTruncated}
            employeesStatus={employeesStatus}
            onRetryEmployees={loadTeacherOptions}
            writeAllowed={writeAllowed}
            canViewEmployees={canViewEmployees}
            open={openSections[SECTION_TEACHERS] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_TEACHERS, o)}
            onChanged={fetchDetail}
          />

          <SessionsSection
            open={openSections[SECTION_SESSIONS] ?? true}
            onOpenChange={(o) => setSectionOpen(SECTION_SESSIONS, o)}
            year={year}
            month={month}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            sessions={sessions}
            loading={sessionsLoading}
            error={sessionsError}
            onRetry={fetchSessions}
            onOpenSession={setSelectedSession}
          />
        </div>

        {/* Desktop rail. On mobile the stat tiles already rendered above and
            the Ringkasan card falls to the end of the document, after the
            sections — same split as guardians/[id] and students/[id]. */}
        {isMobile ? (
          <div className="mt-2 flex flex-col gap-4">
            <RailCard title="Ringkasan">
              <RailKV items={summaryItems} />
            </RailCard>
          </div>
        ) : (
          <DetailRail>
            <RailStatTiles tiles={statTiles} />
            <RailCard title="Ringkasan">
              <RailKV items={summaryItems} />
            </RailCard>
          </DetailRail>
        )}
      </div>

      <EditClassDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        classId={classId}
        data={data}
        onSaved={fetchDetail}
      />

      {/* ── Deactivate confirm ──────────────────────────────────── */}
      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        title={`Nonaktifkan "${data.name}"?`}
        description={
          enrolledCount > 0
            ? `Kelas memiliki ${enrolledCount} siswa aktif yang tidak akan otomatis dipindahkan. Tidak akan muncul di daftar aktif. Bisa diaktifkan kembali kapan saja.`
            : "Tidak akan muncul di daftar aktif. Bisa diaktifkan kembali kapan saja."
        }
        confirmLabel="Nonaktifkan"
        onConfirm={() => flipStatus("INACTIVE")}
      />

      {/* ── Reactivate confirm ──────────────────────────────────── */}
      <ConfirmDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        title="Aktifkan kembali kelas?"
        description={`${data.name} akan muncul kembali di daftar aktif.`}
        confirmLabel="Aktifkan"
        onConfirm={() => flipStatus("ACTIVE")}
      />

      <SwapSessionDialog
        selectedSession={selectedSession}
        writeAllowed={writeAllowed}
        employeeOptions={employeeOptions}
        employeesTruncated={employeesTruncated}
        employeesStatus={employeesStatus}
        onRetryEmployees={loadTeacherOptions}
        onClose={() => setSelectedSession(null)}
        onSaved={fetchSessions}
      />
    </>
  );
}
