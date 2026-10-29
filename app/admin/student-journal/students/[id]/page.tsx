"use client";

import { MESSAGES } from "@/lib/feedback";
import { useCallback, useEffect, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { DetailPageHeader } from "@/components/admin/detail-page-header";
import { DetailPageSkeleton } from "@/components/admin/detail-page-skeleton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { AdminTabs, AdminTabsContent, AdminTabsList, AdminTabsTrigger } from "@/components/admin/admin-tabs";
import { WeekGrid } from "@/components/portal/week-grid";
import { NoteThreadPanel } from "@/components/student-journal/note-thread-panel";
import { AuditDiff } from "@/components/student-journal/audit-diff";
import { weekStart } from "@/lib/student-journal/week";
import { formatDate } from "@/lib/format";
import { Pencil, Check } from "lucide-react";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { PeriodStepper } from "@/components/ui/period-stepper";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

type Indicator = { id: string; label: string; order: number };
type Category = { id: string; name: string; scope: string; indicators: Indicator[] };
type Entry = { id?: string; indicatorId: string; date: string; checked: boolean };
type AuditRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  changedByUserId: string;
  changedByName?: string;
  changedAt: string;
};

type WeekData = {
  weekStart: string;
  dates: string[];
  schoolCategories: Category[];
  homeCategories: Category[];
  schoolEntries: Entry[];
  dayMarks?: Record<string, string>;
  homeEntries: Entry[];
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function currentMonday(): string {
  const today = getTodayInTimezone("Asia/Jakarta");
  return weekStart(today);
}

function addWeeks(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(ws: string): string {
  const d = new Date(`${ws}T00:00:00Z`);
  const fri = new Date(d);
  fri.setUTCDate(d.getUTCDate() + 4);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const friYmd = fri.toISOString().slice(0, 10);
  return `${formatDate(ws, opts)} – ${formatDate(friYmd, opts)}`;
}

const ENTITY_LABELS: Record<string, string> = {
  ENTRY: "Entri",
  NOTE: "Catatan",
};

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function StudentJournalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: studentId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [ws, setWs] = useState<string>(() => {
    const p = searchParams.get("weekStart");
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : currentMonday();
  });

  const [weekData, setWeekData] = useState<WeekData | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [studentName, setStudentName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);

  const [isEditing, setIsEditing] = useState(false);

  // Back link: use ?from param or default to monitoring
  const fromParam = searchParams.get("from");
  const backHref = fromParam
    ? decodeURIComponent(fromParam)
    : "/admin/student-journal/monitoring";

  // ------------------------------------------------------------------
  // Fetch week data
  // ------------------------------------------------------------------
  const fetchWeekData = useCallback(
    async (weekStartYmd: string) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/student-journal/admin/students/${studentId}/week?weekStart=${weekStartYmd}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || MESSAGES.loadFailed("Data jurnal"));
          return;
        }
        const json = await res.json();
        const data: WeekData = json.data;
        setWeekData(data);
        // Attempt to get student name from the response (or fetch separately)
      } catch {
        toast.error(MESSAGES.loadFailed("Data jurnal"));
      } finally {
        setLoading(false);
      }
    },
    [studentId],
  );

  // ------------------------------------------------------------------
  // Fetch student name
  // ------------------------------------------------------------------
  useEffect(() => {
    fetch(`/api/students/${studentId}`)
      .then((r) => r.json())
      .then((json) => {
        if (typeof json.name === "string" && json.name.trim()) setStudentName(json.name);
      })
      // Silent: optional header-name populate; primary data load has its own toast.error path.
      .catch(() => {});
  }, [studentId]);

  useEffect(() => {
    fetchWeekData(ws);
  }, [fetchWeekData, ws]);

  // ------------------------------------------------------------------
  // Fetch audit rows on demand (when Audit tab is opened)
  // ------------------------------------------------------------------
  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch(
        `/api/student-journal/admin/audit?studentId=${studentId}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || MESSAGES.loadFailed("Riwayat perubahan"));
        return;
      }
      const json = await res.json();
      setAuditRows(json.data ?? []);
    } catch {
      toast.error(MESSAGES.loadFailed("Riwayat perubahan"));
    } finally {
      setAuditLoading(false);
    }
  }, [studentId]);

  // ------------------------------------------------------------------
  // Week navigation
  // ------------------------------------------------------------------
  const handleWeekChange = (delta: number) => {
    const newWs = addWeeks(ws, delta);
    setWs(newWs);
    router.replace(
      `/admin/student-journal/students/${studentId}?weekStart=${newWs}`,
      { scroll: false },
    );
  };

  // ------------------------------------------------------------------
  // Edit toggle
  // ------------------------------------------------------------------
  function handleToggle(
    indicatorId: string,
    date: string,
    next: boolean,
    scope: "SCHOOL" | "HOME",
  ) {
    if (!weekData) return;

    const entries = scope === "SCHOOL" ? weekData.schoolEntries : weekData.homeEntries;
    const existing = entries.find(
      (e) => e.indicatorId === indicatorId && e.date === date,
    );

    if (!existing?.id) {
      toast.info("Belum diisi guru atau orang tua — admin tidak dapat mengubahnya.");
      return;
    }

    // Optimistic update
    const updated = { ...weekData };
    if (scope === "SCHOOL") {
      updated.schoolEntries = weekData.schoolEntries.map((e) =>
        e.indicatorId === indicatorId && e.date === date ? { ...e, checked: next } : e,
      );
    } else {
      updated.homeEntries = weekData.homeEntries.map((e) =>
        e.indicatorId === indicatorId && e.date === date ? { ...e, checked: next } : e,
      );
    }
    setWeekData(updated);

    fetch(`/api/student-journal/admin/entries/${existing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checked: next }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast.error(err.error || "Gagal menyimpan perubahan. Data dikembalikan ke kondisi sebelumnya.");
          // Revert optimistic update
          fetchWeekData(ws);
        }
      })
      .catch(() => {
        toast.error("Gagal menyimpan perubahan. Data dikembalikan ke kondisi sebelumnya.");
        fetchWeekData(ws);
      });
  }

  // ------------------------------------------------------------------
  // Note delete (admin can delete any note; confirm before the DELETE call)
  // ------------------------------------------------------------------
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<string | null>(null);
  const [noteDeleting, setNoteDeleting] = useState(false);
  const [noteReloadToken, setNoteReloadToken] = useState(0);

  async function handleNoteDeleteConfirm() {
    if (!noteDeleteTarget) return;
    setNoteDeleting(true);
    let errorToasted = false;
    try {
      const res = await fetch(
        `/api/student-journal/admin/notes/${noteDeleteTarget}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error || "Gagal menghapus catatan";
        errorToasted = true;
        toast.error(message);
        throw new Error(message);
      }
      toast.success("Catatan dihapus");
      setNoteReloadToken((t) => t + 1);
      setNoteDeleteTarget(null);
    } catch (error) {
      if (!errorToasted) {
        toast.error("Gagal menghapus catatan. Coba lagi.");
      }
      throw error instanceof Error
        ? error
        : new Error("Gagal menghapus catatan");
    } finally {
      setNoteDeleting(false);
    }
  }

  // ------------------------------------------------------------------
  // Skeleton
  // ------------------------------------------------------------------
  if (loading) {
    return <DetailPageSkeleton />;
  }

  return (
    <>
      <DetailPageHeader
        backHref={backHref}
        backLabel="Kembali ke Pemantauan"
        title={studentName || "Detail Jurnal Siswa"}
        description="Buku Penghubung — rincian per minggu"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Week picker */}
            <PeriodStepper
              label={formatWeekLabel(ws)}
              onPrev={() => handleWeekChange(-1)}
              onNext={() => handleWeekChange(1)}
              prevLabel="Minggu sebelumnya"
              nextLabel="Minggu berikutnya"
              variant="outline"
              labelClassName="min-w-[104px] font-medium sm:min-w-[140px]"
            />

            {/* Edit toggle — per-cell edits already PUT immediately (handleToggle),
                so there is nothing to "save" or "cancel" here: this button only
                exits edit mode. */}
            {isEditing ? (
              <Button
                size="sm"
                onClick={() => setIsEditing(false)}
                className="gap-1.5"
              >
                <Check size={14} />
                Selesai
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="gap-1.5"
              >
                <Pencil size={14} />
                Ubah
              </Button>
            )}
          </div>
        }
      />

      <AdminTabs
        defaultValue="school"
        onValueChange={(v) => {
          if (v === "audit") fetchAudit();
        }}
      >
        <AdminTabsList className="mb-4">
          <AdminTabsTrigger value="school">Sekolah</AdminTabsTrigger>
          <AdminTabsTrigger value="home">Rumah</AdminTabsTrigger>
          <AdminTabsTrigger value="notes">Catatan</AdminTabsTrigger>
          <AdminTabsTrigger value="audit">Audit</AdminTabsTrigger>
        </AdminTabsList>

        {/* Sekolah tab */}
        <AdminTabsContent value="school">
          <div className="bg-card border border-border rounded-xl p-card">
            <WeekGrid
              categories={weekData?.schoolCategories ?? []}
              entries={weekData?.schoolEntries ?? []}
              dates={weekData?.dates ?? []}
              dayMarks={weekData?.dayMarks}
              editable={isEditing}
              disablePastDays={false}
              emptyWeekMessage="Belum ada centang di pekan ini."
              onToggle={(indicatorId, date, next) =>
                handleToggle(indicatorId, date, next, "SCHOOL")
              }
            />
          </div>
        </AdminTabsContent>

        {/* Rumah tab */}
        <AdminTabsContent value="home">
          <div className="bg-card border border-border rounded-xl p-card">
            <WeekGrid
              categories={weekData?.homeCategories ?? []}
              entries={weekData?.homeEntries ?? []}
              dates={weekData?.dates ?? []}
              editable={isEditing}
              disablePastDays={false}
              emptyWeekMessage="Belum ada centang di pekan ini."
              onToggle={(indicatorId, date, next) =>
                handleToggle(indicatorId, date, next, "HOME")
              }
            />
          </div>
        </AdminTabsContent>

        {/* Catatan tab */}
        <AdminTabsContent value="notes">
          <NoteThreadPanel
            studentId={studentId}
            /* Gates the action icons only. onEdit is deliberately not passed —
               admins delete any note but never edit note bodies; wiring onEdit
               here later would grant edit-any-note and needs a design decision. */
            canEdit={() => true}
            onDelete={(noteId) => setNoteDeleteTarget(noteId)}
            reloadToken={noteReloadToken}
          />

          <ConfirmDialog
            open={noteDeleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setNoteDeleteTarget(null);
            }}
            title="Nonaktifkan catatan?"
            description="Catatan akan dinonaktifkan dan tidak lagi muncul di jurnal siswa."
            confirmLabel="Ya, Nonaktifkan"
            cancelLabel="Batal"
            onConfirm={handleNoteDeleteConfirm}
            destructive
            loading={noteDeleting}
          />
        </AdminTabsContent>

        {/* Audit tab */}
        <AdminTabsContent value="audit">
          {auditLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : auditRows.length === 0 ? (
            <EmptyState
              title="Belum ada riwayat perubahan"
              description="Riwayat perubahan entri dan catatan akan tercatat di sini begitu ada perubahan yang disimpan."
            />
          ) : (
            <div className="space-y-4">
              {auditRows.map((row) => (
                <div
                  key={row.id}
                  className="bg-card border border-border rounded-xl p-card space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {ENTITY_LABELS[row.entityType] ?? row.entityType}
                    </span>
                    <StatusBadge status={row.action} />
                    <span>{formatDate(row.changedAt)}</span>
                    {row.changedByName && (
                      <span className="text-muted-foreground">
                        oleh {row.changedByName}
                      </span>
                    )}
                    <span className="font-mono text-xs truncate max-w-[120px]">
                      {row.entityId}
                    </span>
                  </div>
                  <AuditDiff before={row.beforeJson} after={row.afterJson} />
                </div>
              ))}
            </div>
          )}
        </AdminTabsContent>
      </AdminTabs>
    </>
  );
}
