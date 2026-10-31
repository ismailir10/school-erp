"use client";

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, LogIn, LogOut, Users, X } from "lucide-react";
import { toast } from "sonner";
import { MESSAGES, toastError } from "@/lib/feedback";
import { PageHeader } from "@/components/portal/page-header";
import { BackLink } from "@/components/portal/back-link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, getStatusConfig } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SaveStatus } from "@/components/portal/save-status";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatDate, formatTime } from "@/lib/format";

const SAVE_TOAST_ID = "session-attendance-save";

// Prisma enum values — do NOT translate in code, only display labels.
// Tap order matches class attendance (H · S · I · A) so one muscle memory
// serves both screens (TCH-15).
const ROTATION = ["PRESENT", "SICK", "PERMISSION", "ABSENT"] as const;
type Status = (typeof ROTATION)[number];

// Labels come from status-badge's STATUS_MAP — the single source of truth.
// A second hand-written copy here is exactly how the historical
// "Tidak Hadir" → "Alpa" drift happened.

// Mirrors .claude/standards/portal.md Daily Data Entry recipe — cycle-tap the
// status, row-tinted by current state for a 3 m glance.
const ROW_TINT: Record<Status, string> = {
  PRESENT: "bg-[color:var(--status-present-subtle)]",
  ABSENT: "bg-[color:var(--status-absent-subtle)]",
  SICK: "bg-[color:var(--status-late-subtle)]",
  PERMISSION: "bg-[color:var(--status-leave-subtle)]",
};

// pickedUpByRelation enum → Indonesian display labels.
const PICKUP_RELATIONS: { value: string; label: string }[] = [
  { value: "PARENT", label: "Orang tua" },
  { value: "GUARDIAN", label: "Wali" },
  { value: "GRANDPARENT", label: "Kakek/Nenek" },
  { value: "SIBLING", label: "Kakak/Saudara" },
  { value: "DRIVER", label: "Sopir" },
  { value: "HOUSEHOLD_HELPER", label: "ART" },
  { value: "OTHER", label: "Lainnya" },
];

const SLOT_LABEL: Record<string, string> = {
  FULL_DAY: "Sehari penuh",
  MORNING: "Pagi",
  AFTERNOON: "Siang",
};

export type RosterRow = {
  studentId: string;
  name: string;
  nickname: string | null;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  pickedUpByRelation: string | null;
  pickedUpByName: string | null;
};

/**
 * What "saved" means for one row: the fields the save request carries. The
 * name is compared as text so null and "" (an untouched vs. cleared box) agree.
 * Only rows whose key differs from the last-saved baseline are sent (TCHX-1).
 */
function rowKey(r: RosterRow): string {
  return JSON.stringify([
    r.status,
    r.checkInTime,
    r.checkOutTime,
    r.pickedUpByRelation,
    (r.pickedUpByName ?? "").trim(),
  ]);
}

function baselineOf(rows: RosterRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.studentId, rowKey(r)]));
}

export function SessionRosterClient({
  sessionId,
  className,
  date,
  slot,
  roster,
}: {
  sessionId: string;
  className: string;
  date: string;
  slot: string;
  roster: RosterRow[];
}) {
  const [rows, setRows] = useState<RosterRow[]>(roster);
  const [saving, setSaving] = useState(false);
  // Masuk / pulang / penjemput only reach the server on "Simpan absensi", so
  // the page has to say so — a reload used to drop taps silently (TCH-2).
  // Per-row baseline: what the server last held, as far as this tab knows. A
  // save sends only rows that differ from it, so an untouched row can never
  // overwrite a status written meanwhile on class attendance (TCHX-1).
  const [baseline, setBaseline] = useState(() => baselineOf(roster));
  const [savedOnce, setSavedOnce] = useState(false);
  const changedRows = useMemo(
    () => rows.filter((r) => baseline[r.studentId] !== rowKey(r)),
    [rows, baseline],
  );
  const dirty = changedRows.length > 0;
  const guard = useUnsavedChangesGuard(dirty);

  const update = useCallback(
    (studentId: string, patch: Partial<RosterRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  function cycleStatus(studentId: string, current: string) {
    const idx = ROTATION.indexOf(current as Status);
    const next = ROTATION[(idx + 1) % ROTATION.length];
    // Masuk / pulang / penjemput only make sense for a child who is there.
    update(
      studentId,
      next === "PRESENT"
        ? { status: next }
        : {
            status: next,
            checkInTime: null,
            checkOutTime: null,
            pickedUpByRelation: null,
            pickedUpByName: null,
          },
    );
  }

  function tapIn(studentId: string) {
    update(studentId, { checkInTime: new Date().toISOString() });
  }

  function tapOut(studentId: string) {
    update(studentId, { checkOutTime: new Date().toISOString() });
  }

  // A mistap must be undoable before saving. Pulang (and its pickup form)
  // goes with it only when pulang itself is cleared.
  function clearIn(studentId: string) {
    update(studentId, { checkInTime: null });
  }

  function clearOut(studentId: string) {
    update(studentId, {
      checkOutTime: null,
      pickedUpByRelation: null,
      pickedUpByName: null,
    });
  }

  async function handleSave() {
    if (saving) return;

    // Client-side guard for the OTHER-requires-name rule so the teacher gets
    // an instant, row-specific message instead of a generic 400.
    if (changedRows.length === 0) {
      toast.info("Tidak ada perubahan untuk disimpan.");
      return;
    }

    const missingName = changedRows.find(
      (r) =>
        r.pickedUpByRelation === "OTHER" &&
        (!r.pickedUpByName || r.pickedUpByName.trim().length === 0),
    );
    if (missingName) {
      toast.error(
        `Isi nama penjemput untuk ${missingName.name} (hubungan: Lainnya).`,
      );
      document.getElementById(`pickup-name-${missingName.studentId}`)?.focus();
      return;
    }

    await submit(changedRows);
  }

  /** Sends the given rows. A failure keeps them so "Coba lagi" re-sends exactly this payload. */
  async function submit(submitted: typeof changedRows) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/teacher/sessions/${sessionId}/attendance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: submitted.map((r) => ({
              studentId: r.studentId,
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              pickedUpByRelation: r.pickedUpByRelation,
              pickedUpByName: r.pickedUpByName?.trim() || null,
            })),
          }),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toastError(
          d?.message ||
            d?.error ||
            "Absensi tidak tersimpan. Coba ketuk ulang ya.",
          { retry: () => void submit(submitted), id: SAVE_TOAST_ID },
        );
        return;
      }
      const body = await res.json().catch(() => ({ saved: 0, total: 0 }));
      // Only the submitted rows move forward; a row edited while the request
      // was in flight keeps differing from its baseline and stays unsaved.
      setBaseline((prev) => ({ ...prev, ...baselineOf(submitted) }));
      setSavedOnce(true);
      toast.success(`Absensi tersimpan · ${body.total ?? submitted.length} siswa`, {
        id: SAVE_TOAST_ID,
      });
    } catch {
      toastError(MESSAGES.network, {
        retry: () => void submit(submitted),
        id: SAVE_TOAST_ID,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <BackLink href="/teacher" label="Beranda" />

      <PageHeader
        title={className}
        subtitle={`${formatDate(date)} · ${SLOT_LABEL[slot] ?? slot}`}
      />

      {rows.length === 0 ? (
        <div data-empty-state="no-students">
          <EmptyState
            icon={Users}
            title="Belum ada siswa di sesi ini"
            description="Minta admin untuk mendaftarkan siswa ke kelas ini."
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((r) => {
              const status = r.status as Status;
              return (
                <div
                  key={r.studentId}
                  data-testid="roster-row"
                  className={`rounded-lg border border-border p-3 ${ROW_TINT[status]}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      {r.nickname && (
                        <p className="text-xs text-muted-foreground truncate">
                          {r.nickname}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => cycleStatus(r.studentId, r.status)}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1 rounded-full border border-border bg-background py-1 pl-1 pr-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={`Status ${r.name}: ${getStatusConfig(status).label}. Ketuk untuk ganti.`}
                    >
                      <StatusBadge status={status} />
                      <ChevronDown
                        size={16}
                        className="text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {/*
                    Masuk / pulang only exist for a child who is Hadir. A row
                    that already carries a time (older data) still shows it,
                    with a way to clear it, but offers no new taps.
                  */}
                  {(status === "PRESENT" || r.checkInTime || r.checkOutTime) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/*
                        "Tap Masuk" used the English verb in an Indonesian
                        portal; voice.md's glossary and every other tap
                        affordance in the app say "Ketuk".
                      */}
                      {r.checkInTime ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-secondary px-2.5 text-sm font-medium text-secondary-foreground">
                            <LogIn size={16} aria-hidden="true" />
                            Masuk {formatTime(r.checkInTime)}
                          </span>
                          {!r.checkOutTime && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="tap-target min-w-11"
                              aria-label={`Hapus jam masuk ${r.name}`}
                              onClick={() => clearIn(r.studentId)}
                            >
                              <X size={16} aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      ) : (
                        status === "PRESENT" && (
                          <Button
                            type="button"
                            size="sm"
                            className="tap-target"
                            variant="outline"
                            onClick={() => tapIn(r.studentId)}
                          >
                            <LogIn size={16} aria-hidden="true" />
                            Ketuk masuk
                          </Button>
                        )
                      )}
                      {r.checkOutTime ? (
                        <div className="flex items-center gap-1">
                          <span className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-secondary px-2.5 text-sm font-medium text-secondary-foreground">
                            <LogOut size={16} aria-hidden="true" />
                            Pulang {formatTime(r.checkOutTime)}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="tap-target min-w-11"
                            aria-label={`Hapus jam pulang ${r.name}`}
                            onClick={() => clearOut(r.studentId)}
                          >
                            <X size={16} aria-hidden="true" />
                          </Button>
                        </div>
                      ) : (
                        status === "PRESENT" && (
                          <Button
                            type="button"
                            size="sm"
                            className="tap-target"
                            variant="outline"
                            onClick={() => tapOut(r.studentId)}
                            disabled={!r.checkInTime}
                          >
                            <LogOut size={16} aria-hidden="true" />
                            Ketuk pulang
                          </Button>
                        )
                      )}
                    </div>
                  )}

                  {status === "PRESENT" && r.checkOutTime && (
                    <div className="mt-2 space-y-2 rounded-md bg-card/60 p-2">
                      <p className="text-sm font-medium text-foreground">
                        Dijemput oleh
                      </p>
                      <label htmlFor={`pickup-relation-${r.studentId}`} className="sr-only">
                        Hubungan penjemput {r.name}
                      </label>
                      <Select
                        value={r.pickedUpByRelation ?? ""}
                        onValueChange={(v) =>
                          update(r.studentId, {
                            pickedUpByRelation: v || null,
                          })
                        }
                      >
                        <SelectTrigger id={`pickup-relation-${r.studentId}`} className="tap-target w-full">
                          <SelectValue placeholder="Pilih hubungan" />
                        </SelectTrigger>
                        <SelectContent>
                          {PICKUP_RELATIONS.map((rel) => (
                            <SelectItem key={rel.value} value={rel.value}>
                              {rel.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {r.pickedUpByRelation && (
                        <>
                          <label htmlFor={`pickup-name-${r.studentId}`} className="sr-only">
                            Nama penjemput {r.name}
                          </label>
                          <Input
                            id={`pickup-name-${r.studentId}`}
                            className="tap-target"
                            value={r.pickedUpByName ?? ""}
                            onChange={(e) =>
                              update(r.studentId, {
                                pickedUpByName: e.target.value,
                              })
                            }
                            placeholder={
                              r.pickedUpByRelation === "OTHER"
                                ? "Nama penjemput (wajib)"
                                : "Nama penjemput (opsional)"
                            }
                            aria-invalid={
                              r.pickedUpByRelation === "OTHER" &&
                              !r.pickedUpByName?.trim()
                            }
                            aria-describedby={
                              r.pickedUpByRelation === "OTHER" &&
                              !r.pickedUpByName?.trim()
                                ? `pickup-name-${r.studentId}-error`
                                : undefined
                            }
                          />
                          {r.pickedUpByRelation === "OTHER" &&
                            !r.pickedUpByName?.trim() && (
                              <FieldError id={`pickup-name-${r.studentId}-error`}>
                                {MESSAGES.required}
                              </FieldError>
                            )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-sticky -mx-page-x mt-4 border-t border-border bg-background px-page-x py-3 supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur">
            {/* Space is reserved so the line appearing never moves the button under a thumb. */}
            <div className="mb-2 min-h-6" data-testid="roster-save-state">
              {saving ? (
                <SaveStatus state="saving" message="Menyimpan absensi…" />
              ) : dirty ? (
                <p role="status" className="inline-flex min-h-6 items-center gap-1.5 text-small font-medium text-status-late-text">
                  <span aria-hidden="true" className="size-2 rounded-full bg-status-late" />
                  Belum disimpan · ketuk Simpan absensi
                </p>
              ) : savedOnce ? (
                <SaveStatus state="saved" message="Semua perubahan tersimpan" />
              ) : null}
            </div>
            <Button
              type="button"
              className="tap-target w-full"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? "Menyimpan absensi…"
                : dirty
                  ? `Simpan absensi · ${changedRows.length} perubahan`
                  : "Simpan absensi"}
            </Button>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Ketuk status untuk mengganti (Hadir → Sakit → Izin → Alpa)
          </p>
        </>
      )}

      <ConfirmDialog
        open={guard.confirmOpen}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
        title="Keluar tanpa menyimpan?"
        description="Ketukan masuk, pulang, dan data penjemput yang belum disimpan akan hilang."
        confirmLabel="Keluar tanpa menyimpan"
        cancelLabel="Tetap di sini"
        destructive
        onConfirm={guard.confirmLeave}
      />
    </div>
  );
}
