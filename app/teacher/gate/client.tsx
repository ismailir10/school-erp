"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, UserRound, Users } from "lucide-react";
import { toast } from "sonner";
import { MESSAGES, toastError } from "@/lib/feedback";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { campusShortLabels, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "arrive" | "pickup";

export type GateStudent = {
  studentId: string;
  name: string;
  nickname: string | null;
  classSectionId: string;
  className: string;
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  pickedUpByRelation: string | null;
  pickedUpByName: string | null;
};

type Campus = { id: string; name: string };

const RELATIONS: { value: string; label: string }[] = [
  { value: "PARENT", label: "Orang tua" },
  { value: "GUARDIAN", label: "Wali" },
  { value: "GRANDPARENT", label: "Kakek/Nenek" },
  { value: "SIBLING", label: "Kakak/Saudara" },
  { value: "DRIVER", label: "Sopir" },
  { value: "HOUSEHOLD_HELPER", label: "ART" },
  { value: "OTHER", label: "Lainnya" },
];

const UNDO_TOAST_MS = 6000;

export function GateClient() {
  const [mode, setMode] = useState<Mode>("arrive");
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const campusShort = campusShortLabels(campuses.map((c) => c.name));
  const [campusId, setCampusId] = useState<string | null>(null);
  const [students, setStudents] = useState<GateStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [otherName, setOtherName] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async (forCampus: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const qs = forCampus ? `?campusId=${encodeURIComponent(forCampus)}` : "";
      const res = await fetch(`/api/teacher/gate${qs}`);
      if (!res.ok) throw new Error("load");
      const d = await res.json();
      setCampuses(d.campuses ?? []);
      setCampusId(d.campusId ?? null);
      setStudents(d.students ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const patch = useCallback((studentId: string, p: Partial<GateStudent>) => {
    setStudents((prev) =>
      prev.map((s) => (s.studentId === studentId ? { ...s, ...p } : s)),
    );
  }, []);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/teacher/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, campusId }),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: d as { error?: string; time?: string; alreadyDone?: boolean } };
  }

  async function record(
    s: GateStudent,
    action: Mode,
    relation?: string,
    name?: string,
  ) {
    if (busy.has(s.studentId)) return;
    const before = {
      status: s.status,
      checkInTime: s.checkInTime,
      checkOutTime: s.checkOutTime,
      pickedUpByRelation: s.pickedUpByRelation,
      pickedUpByName: s.pickedUpByName,
    };
    setBusy((b) => new Set(b).add(s.studentId));
    setPickerFor(null);
    try {
      const { ok, status, data } = await post({
        studentId: s.studentId,
        action,
        relation,
        name: name || undefined,
      });
      if (!ok) {
        // A 4xx (e.g. no class session on a non-school day) cannot succeed on
        // retry, so only server errors offer "Coba lagi".
        toastError(
          data.error ?? MESSAGES.saveFailed,
          status >= 500 ? { retry: () => void record(s, action, relation, name) } : undefined,
        );
        return;
      }
      const time = data.time ?? new Date().toISOString();
      patch(
        s.studentId,
        action === "arrive"
          ? { status: "PRESENT", checkInTime: time }
          : {
              status: "PRESENT",
              checkOutTime: time,
              pickedUpByRelation: relation ?? "PARENT",
              pickedUpByName: name || null,
            },
      );
      // Same-mode re-tap on a marked child: nothing was written, no undo.
      if (data.alreadyDone) return;
      toast.success(
        action === "arrive" ? `${s.name} masuk` : `${s.name} pulang`,
        {
          duration: UNDO_TOAST_MS,
          action: {
            label: "Urungkan",
            onClick: () => void undo(s.studentId, action, before),
          },
        },
      );
    } catch {
      toastError(MESSAGES.network, {
        retry: () => void record(s, action, relation, name),
      });
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(s.studentId);
        return n;
      });
    }
  }

  async function undo(
    studentId: string,
    action: Mode,
    before: Partial<GateStudent>,
  ) {
    try {
      const { ok } = await post({
        studentId,
        action: action === "arrive" ? "undo_arrive" : "undo_pickup",
      });
      if (!ok) {
        toastError(MESSAGES.saveFailed);
        return;
      }
      // Restore exactly what the screen showed before the tap.
      patch(studentId, action === "arrive" ? { ...before, status: null, checkInTime: null } : before);
    } catch {
      toastError(MESSAGES.network);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.nickname ?? "").toLowerCase().includes(q) ||
        s.className.toLowerCase().includes(q),
    );
  }, [students, query]);

  const done = (s: GateStudent) =>
    mode === "arrive" ? !!s.checkInTime : !!s.checkOutTime;
  const doneCount = students.filter(done).length;

  return (
    <div className="space-y-3">
      <div
        role="group"
        aria-label="Mode gerbang"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        {(
          [
            ["arrive", "Masuk", LogIn],
            ["pickup", "Pulang", LogOut],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setPickerFor(null);
            }}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:focus-outline [--focus-outline-offset:-2px]",
              mode === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {campuses.length > 1 && campusId && (
        <div>
          <label htmlFor="gate-campus" className="sr-only">
            Kampus
          </label>
          <Select
            value={campusId}
            onValueChange={(v) => {
              setQuery("");
              void load(v);
            }}
          >
            <SelectTrigger id="gate-campus" className="min-h-12 w-full">
              <SelectValue placeholder="Pilih kampus" />
            </SelectTrigger>
            <SelectContent>
              {campuses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {campusShort.get(c.name) ?? c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <label htmlFor="gate-search" className="sr-only">
          Cari nama anak
        </label>
        <Input
          id="gate-search"
          type="search"
          className="min-h-12"
          placeholder="Cari nama atau kelas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!loading && !failed && students.length > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          {mode === "arrive" ? "Sudah masuk" : "Sudah pulang"} {doneCount} dari{" "}
          {students.length}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Memuat…</p>
      ) : failed ? (
        <div data-empty-state="gate-load-failed">
          <EmptyState
            icon={Users}
            title="Daftar anak belum bisa dimuat"
            description={MESSAGES.loadFailed("Daftar anak")}
            actionLabel="Coba lagi"
            onAction={() => void load(campusId)}
          />
        </div>
      ) : students.length === 0 ? (
        <div data-empty-state="gate-no-students">
          <EmptyState
            icon={Users}
            title="Belum ada siswa aktif di kampus ini"
            description="Pilih kampus lain, atau minta admin mendaftarkan siswa ke kelas."
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Tidak ada anak bernama &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => {
            const marked = done(s);
            const time = mode === "arrive" ? s.checkInTime : s.checkOutTime;
            const showPicker = mode === "pickup" && pickerFor === s.studentId;
            return (
              <li
                key={s.studentId}
                data-testid="gate-row"
                className={cn(
                  "rounded-lg border border-border",
                  marked ? "bg-muted/60 text-muted-foreground" : "bg-card",
                )}
              >
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => void record(s, mode)}
                    disabled={busy.has(s.studentId)}
                    className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left focus-visible:focus-outline [--focus-outline-offset:-2px]"
                    aria-label={`${mode === "arrive" ? "Masuk" : "Pulang"}: ${s.name}, ${s.className}${marked ? `, tercatat ${formatTime(time)}` : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {s.name}
                      </span>
                      <span className="block truncate text-xs">{s.className}</span>
                    </span>
                    {marked && (
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatTime(time)}
                      </span>
                    )}
                  </button>
                  {mode === "pickup" && !marked && (
                    <button
                      type="button"
                      onClick={() => {
                        setOtherName("");
                        setPickerFor(showPicker ? null : s.studentId);
                      }}
                      aria-expanded={showPicker}
                      aria-label={`Ubah penjemput ${s.name}`}
                      className="inline-flex min-h-14 min-w-12 shrink-0 items-center justify-center border-l border-border focus-visible:focus-outline [--focus-outline-offset:-2px]"
                    >
                      <UserRound size={18} aria-hidden="true" />
                    </button>
                  )}
                </div>

                {showPicker && (
                  <div className="space-y-2 border-t border-border p-3">
                    <p className="text-sm font-medium text-foreground">Dijemput oleh</p>
                    <div className="flex flex-wrap gap-2">
                      {RELATIONS.filter((r) => r.value !== "OTHER").map((r) => (
                        <Button
                          key={r.value}
                          type="button"
                          variant="outline"
                          className="min-h-12"
                          onClick={() => void record(s, "pickup", r.value)}
                        >
                          {r.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <label htmlFor={`gate-other-${s.studentId}`} className="sr-only">
                        Nama penjemput lainnya
                      </label>
                      <Input
                        id={`gate-other-${s.studentId}`}
                        className="min-h-12"
                        value={otherName}
                        onChange={(e) => setOtherName(e.target.value)}
                        placeholder="Lainnya: nama penjemput"
                      />
                      <Button
                        type="button"
                        className="min-h-12"
                        disabled={!otherName.trim()}
                        onClick={() =>
                          void record(s, "pickup", "OTHER", otherName.trim())
                        }
                      >
                        Simpan
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
