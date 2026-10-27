"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { BookHeart, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PortalTabs } from "@/components/portal/portal-tabs";
import { PageHeader } from "@/components/portal/page-header";
import { ContextStrip } from "@/components/portal/context-strip";
import { WeekNavigator } from "@/components/portal/week-navigator";
import { WeekGrid } from "@/components/portal/week-grid";
import { NoteThreadPanel } from "@/components/student-journal/note-thread-panel";
import { NoteComposeDialog } from "@/components/student-journal/note-compose-dialog";
import { NoteDeleteDialog } from "@/components/student-journal/note-delete-dialog";
import { weekStart, weekDates } from "@/lib/student-journal/week";
import { homeEntryEditFloor } from "@/lib/student-journal/backfill";
import { formatWeekRangeLabel } from "@/lib/format";
import { getTodayInTimezone } from "@/lib/attendance/timezone";
import { parentHref, resolveParentChildId } from "@/lib/parent/navigation";
import { childShortName } from "@/lib/parent/child-name";
import { ChildParamNotice } from "@/components/parent/child-param-notice";

// ── Types ────────────────────────────────────────────────────────

type Child = {
  id: string;
  name: string;
  nickname: string | null;
  className: string | null;
};

type Indicator = { id: string; label: string; order: number };
type Category = { id: string; name: string; scope: string; indicators: Indicator[] };
type Entry = {
  id?: string;
  indicatorId: string;
  date: string;
  checked: boolean;
  lastAdminEdit?: { changedAt: string; changedByName: string } | null;
};
type Note = {
  id: string;
  date: string;
  authorRole: string;
  authorUserId?: string;
  authorName?: string;
  body: string;
  createdAt: string;
};

type WeekData = {
  weekStart: string;
  dates: string[];
  schoolCategories: Category[];
  homeCategories: Category[];
  schoolEntries: Entry[];
  homeEntries: Entry[];
  notes: Note[];
  /** `YYYY-MM-DD → keterangan` for days the guru marked "tanpa buku penghubung". */
  dayMarks?: Record<string, string>;
};

// ── Helpers ──────────────────────────────────────────────────────

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  return formatWeekRangeLabel(dates[0], dates[dates.length - 1]);
}

/**
 * `?week=` is trusted only as far as "is this a real calendar date" — anything
 * else falls back to the current week rather than 400-ing at the reader. The
 * value is snapped to its Monday so a link to any day of a week opens that week.
 */
function resolveWeekParam(raw: string | null, todayYmd: string): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw) {
      return weekStart(raw);
    }
  }
  return weekStart(todayYmd);
}

// ── Component ─────────────────────────────────────────────────────

type TabView = "school" | "home" | "notes";
const VALID_VIEWS: readonly TabView[] = ["school", "home", "notes"] as const;

function isValidView(v: string | null | undefined): v is TabView {
  return v != null && (VALID_VIEWS as readonly string[]).includes(v);
}

export default function ParentStudentJournalPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [children, setChildren] = useState<Child[] | null>(null);
  const childId = resolveParentChildId(
    children?.map((child) => child.id) ?? [],
    searchParams.get("child"),
  );

  // Active tab persisted in URL (UAT 2026-05-01 cycle T5) — without this the
  // tab resets to "Sekolah" on every Catatan create/delete because the
  // re-render reseeds defaultValue. URL keeps the user where they were.
  const viewParam = searchParams.get("view");
  const activeView: TabView = isValidView(viewParam) ? viewParam : "school";

  const setActiveView = useCallback(
    (next: string) => {
      if (!isValidView(next)) return;
      const params = Object.fromEntries(new URLSearchParams(searchParams.toString()));
      if (next === "school") {
        delete params.view;
      } else {
        params.view = next;
      }
      router.replace(parentHref(pathname, childId, params), { scroll: false });
    },
    [childId, pathname, router, searchParams],
  );

  const selectChild = useCallback((id: string) => {
    if (!children?.some((child) => child.id === id)) return;
    const local = Object.fromEntries(new URLSearchParams(searchParams.toString()));
    router.push(parentHref(pathname, id, local));
  }, [children, pathname, router, searchParams]);

  // The viewed week lives in the URL, like the tab above it. Held in component
  // state it did not survive a reload, a back-button press, or a link pasted to
  // another wali — every one of those silently snapped back to this week, which
  // is the opposite of what a parent chasing last week's catatan wants.
  const today = getTodayInTimezone("Asia/Jakarta");
  const thisWeek = weekStart(today);
  const currentWeek = resolveWeekParam(searchParams.get("week"), today);
  const isCurrentWeek = currentWeek === thisWeek;

  const setCurrentWeek = useCallback(
    (next: string) => {
      const params = Object.fromEntries(new URLSearchParams(searchParams.toString()));
      if (next === thisWeek) {
        delete params.week;
      } else {
        params.week = next;
      }
      router.replace(parentHref(pathname, childId, params), { scroll: false });
    },
    [childId, pathname, router, searchParams, thisWeek],
  );
  const [loadedWeek, setLoadedWeek] = useState<{
    childId: string;
    week: string;
    data: WeekData;
  } | null>(null);
  const data = loadedWeek?.childId === childId && loadedWeek.week === currentWeek
    ? loadedWeek.data
    : null;
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [noteDialog, setNoteDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; noteId: string; date: string; body: string }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // Bumped after write/edit/delete so the thread refetches from its first page.
  const [noteReloadToken, setNoteReloadToken] = useState(0);
  /** studentId → unread catatan, for the tab badge and the child pills. */
  const [unreadByChild, setUnreadByChild] = useState<Record<string, number>>({});
  const activeWeekRef = useRef({ childId, week: currentWeek });
  activeWeekRef.current = { childId, week: currentWeek };
  const weekRequestRef = useRef(0);

  // Load current session id (for own-note edit/delete affordance)
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { id?: string } | null) => {
        if (json?.id) setCurrentUserId(json.id);
      })
      .catch(() => {
        // Non-fatal; edit/delete affordance simply won't render.
      });
  }, []);

  // Load children on mount
  useEffect(() => {
    fetch("/api/parent/children")
      .then((r) => {
        if (!r.ok) throw new Error("children fetch failed");
        return r.json();
      })
      .then((json: { data?: Child[]; error?: string }) => {
        if (json.data && json.data.length > 0) {
          setChildren(json.data);
        } else {
          setChildren([]);
        }
      })
      .catch(() => {
        toast.error("Data anak belum bisa dimuat. Coba lagi sebentar ya.");
        setChildren([]);
      });
  }, []);

  // Unread catatan for every child, in one call — the badge has to be visible
  // before the wali picks a child, otherwise it only announces what they were
  // already looking at. The panel below reports the authoritative count for the
  // selected child once its thread loads.
  useEffect(() => {
    if (!children || children.length === 0) return;
    const ids = children.map((c) => c.id).join(",");
    fetch(`/api/student-journal/notes/unread?studentIds=${encodeURIComponent(ids)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data?: { unreadNoteCounts?: Record<string, number> } } | null) => {
        if (json?.data?.unreadNoteCounts) setUnreadByChild(json.data.unreadNoteCounts);
      })
      .catch(() => {
        // Non-fatal: no badge rather than a broken page.
      });
  }, [children]);

  // Load week data when child or week changes
  const loadWeekData = useCallback(
    async (cid: string, ws: string) => {
      const requestId = ++weekRequestRef.current;
      const isCurrentRequest = () =>
        requestId === weekRequestRef.current &&
        activeWeekRef.current.childId === cid &&
        activeWeekRef.current.week === ws;

      setLoading(true);
      try {
        const res = await fetch(
          `/api/student-journal/children/${cid}/week?weekStart=${ws}`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (isCurrentRequest()) {
            toast.error((err as { error?: string }).error ?? "Jurnal belum bisa dimuat. Coba lagi sebentar ya.");
          }
          return;
        }
        const json = await res.json() as { data: WeekData };
        if (isCurrentRequest()) {
          setLoadedWeek({ childId: cid, week: ws, data: json.data });
        }
      } catch {
        if (isCurrentRequest()) {
          toast.error("Jurnal belum bisa dimuat. Coba lagi sebentar ya.");
        }
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (childId) {
      loadWeekData(childId, currentWeek);
    }
  }, [childId, currentWeek, loadWeekData]);

  const handlePrevWeek = () => setCurrentWeek(addDays(currentWeek, -7));
  const handleNextWeek = () => setCurrentWeek(addDays(currentWeek, 7));

  // ── Loading state ────────────────────────────────────────────────
  if (children === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <EmptyState
        accent="warm"
        icon={BookHeart}
        title="Belum ada data anak"
        description="Hubungi admin sekolah untuk menautkan akun Anda."
      />
    );
  }

  const dates = data?.dates ?? weekDates(currentWeek);
  // Anchored to TODAY's week, not `currentWeek` (the week the parent is
  // currently viewing) — a wali who navigates back four weeks must still see
  // every cell there locked. `homeEntryEditFloor` is the same helper the
  // server route enforces against, so client and server never disagree.
  const homeEditFloor = homeEntryEditFloor(today);
  const selectedUnread = childId ? (unreadByChild[childId] ?? 0) : 0;
  const selectedChild = children?.find((c) => c.id === childId) ?? null;
  const selectedChildLabel = selectedChild
    ? [selectedChild.name, selectedChild.className]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="space-y-6">
      {/*
        Child switcher sits ABOVE the title and shows first names only, matching
        Tagihan / Kehadiran / Rapor. It used to sit below the title with full
        names ("Hafizh Umar Ramadhan"), and the full name was then repeated on
        its own line underneath — three different presentations of one child on
        one screen.
      */}
      {childId && selectedChild ? (
        <ChildParamNotice
          knownIds={children.map((c) => c.id)}
          selectedChildId={childId}
          selectedName={childShortName(selectedChild)}
        />
      ) : null}
      {children.length > 1 && (
        <PortalTabs
          items={children.map((c) => ({
            id: c.id,
            label: childShortName(c),
            count: unreadByChild[c.id] || undefined,
          }))}
          activeId={childId ?? ""}
          onSelect={selectChild}
          variant="pills"
          ariaLabel="Pilih anak"
        />
      )}

      {selectedChild ? (
        <ContextStrip
          name={selectedChild.name}
          detail={selectedChild.className || "Jurnal anak terpilih"}
          className="rounded-lg border-x border-t"
        />
      ) : null}

      {/*
        Parent-facing label is "Jurnal" — it has to match the bottom-nav tab,
        and "Penghubung" does not fit a 5-tab bar at 375 px. The route slug,
        the `/api/student-journal/*` paths and every DB field keep the
        `student-journal` name; this is a copy change only. Teacher + admin
        surfaces still say "Buku Penghubung" (staff vocabulary, own cycle).
      */}
      {/*
        Which child is on screen was carried only by the pill state above the
        title, and the class (TKIT-A / KB) — shown on the parent home — was
        dropped entirely. A wali with one child saw no name at all.
      */}
      <PageHeader
        title="Jurnal"
        subtitle={selectedChildLabel ?? "Pantau kegiatan harian di sekolah dan rumah"}
      />

      <WeekNavigator
        label={isCurrentWeek ? `${weekLabel(dates)} · pekan ini` : weekLabel(dates)}
        onPrev={handlePrevWeek}
        onNext={handleNextWeek}
        // Future weeks hold nothing: school entries are written by the guru for
        // days that have happened, and the "Di rumah" grid locks every cell
        // after today. Paging forward only produced an empty grid.
        nextDisabled={isCurrentWeek}
        onToday={isCurrentWeek ? undefined : () => setCurrentWeek(thisWeek)}
      />

      {/* Main content */}
      {loading || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : data.schoolCategories.length === 0 &&
        data.homeCategories.length === 0 ? (
        <EmptyState
          accent="warm"
          icon={BookHeart}
          title="Jurnal belum diatur sekolah"
          description="Sekolah belum menambahkan indikator harian untuk Jurnal. Hubungi admin sekolah untuk informasi lebih lanjut."
        />
      ) : (
        <Tabs value={activeView} onValueChange={setActiveView}>
          {/* min-h-11 = 44px. The triggers measured 25px tall, the smallest
              tap target left in the portal. */}
          <TabsList className="w-full">
            <TabsTrigger value="school" className="min-h-11 flex-1">
              Di sekolah
            </TabsTrigger>
            <TabsTrigger value="home" className="min-h-11 flex-1">
              Di rumah
            </TabsTrigger>
            <TabsTrigger value="notes" className="min-h-11 flex-1">
              Catatan
              {selectedUnread > 0 ? (
                <span
                  data-testid="notes-unread-badge"
                  className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground"
                  aria-label={`${selectedUnread} catatan baru`}
                >
                  {selectedUnread}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* Sekolah tab — read-only */}
          <TabsContent value="school" className="mt-3">
            <WeekGrid
              categories={data.schoolCategories}
              entries={data.schoolEntries}
              dates={data.dates}
              featureLabel="Jurnal"
              dayMarks={data.dayMarks}
              emptyWeekMessage="Sekolah belum mengisi jurnal untuk pekan ini."
            />
          </TabsContent>

          {/* Rumah tab — editable */}
          <TabsContent value="home" className="mt-3">
            <WeekGrid
              categories={data.homeCategories}
              entries={data.homeEntries}
              dates={data.dates}
              featureLabel="Jurnal"
              editable
              earliestEditableDate={homeEditFloor}
              onToggle={async (indicatorId, date, next) => {
                const mutationChildId = childId;
                const mutationWeek = currentWeek;
                const isActiveMutation = () =>
                  activeWeekRef.current.childId === mutationChildId &&
                  activeWeekRef.current.week === mutationWeek;

                try {
                  const res = await fetch("/api/student-journal/entries/home", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      studentId: mutationChildId,
                      date,
                      entries: [{ indicatorId, checked: next }],
                    }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    if (isActiveMutation()) {
                      toast.error((err as { error?: string }).error ?? "Belum bisa disimpan. Coba lagi sebentar ya.");
                    }
                    return;
                  }
                  // A late mutation from a child/week the wali has left must not
                  // start a refresh that supersedes the newly selected journal.
                  if (mutationChildId && isActiveMutation()) {
                    await loadWeekData(mutationChildId, mutationWeek);
                  }
                } catch {
                  if (isActiveMutation()) {
                    toast.error("Koneksi terputus. Coba lagi sebentar ya.");
                  }
                }
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Opsional &mdash; bantu Ustadzah memantau ibadah dan rutinitas di rumah.
            </p>
          </TabsContent>

          {/* Catatan tab — parent can write, edit, delete own notes */}
          <TabsContent value="notes" className="mt-3 space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 px-4"
                onClick={() => setNoteDialog({ mode: "create" })}
              >
                <Plus size={14} className="mr-1" />
                Tulis catatan
              </Button>
            </div>
            {/*
              Reads the whole thread, not `data.notes` — the week payload only
              ever held the five days on screen, so a wali chasing last month's
              catatan from Ustadzah had to page back through empty weeks to
              find it.
            */}
            <NoteThreadPanel
              studentId={childId ?? ""}
              audience="parent"
              reloadToken={noteReloadToken}
              markReadOnOpen={activeView === "notes"}
              onUnreadChange={(unread) =>
                setUnreadByChild((prev) =>
                  prev[childId ?? ""] === unread
                    ? prev
                    : { ...prev, [childId ?? ""]: unread },
                )
              }
              canEdit={(note) =>
                note.authorRole === "GUARDIAN" &&
                !!currentUserId &&
                note.authorUserId === currentUserId
              }
              onEdit={(noteId, n) =>
                setNoteDialog({
                  mode: "edit",
                  noteId,
                  date: n.date,
                  body: n.body,
                })
              }
              onDelete={(noteId) => setDeleteTarget(noteId)}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* Write / Edit dialog */}
      {childId && (
        <NoteComposeDialog
          open={noteDialog !== null}
          onOpenChange={(open) => {
            if (!open) setNoteDialog(null);
          }}
          mode={noteDialog?.mode ?? "create"}
          studentId={childId}
          weekDates={dates}
          audience="parent"
          initialDate={
            noteDialog?.mode === "edit" ? noteDialog.date : undefined
          }
          initialBody={
            noteDialog?.mode === "edit" ? noteDialog.body : undefined
          }
          noteId={noteDialog?.mode === "edit" ? noteDialog.noteId : undefined}
          placeholder="Tulis catatan rumah di sini..."
          onSaved={() => {
            setNoteReloadToken((n) => n + 1);
            if (childId) loadWeekData(childId, currentWeek);
          }}
        />
      )}

      {/* Delete confirm (shared with the teacher page) */}
      <NoteDeleteDialog
        noteId={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => setNoteReloadToken((n) => n + 1)}
      />
    </div>
  );
}
