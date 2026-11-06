import { CalendarDays, ClipboardCheck, BookHeart, Home, MoreHorizontal, School } from "lucide-react";
import { LEVEL_CHIP_CLASS, LEVEL_CHIP_CLASS_OFF, LEVEL_LABEL_LONG, LEVEL_LABEL_SHORT, LEVEL_ORDER, type Level } from "@/lib/curriculum/level-presentation";
import { cn } from "@/lib/utils";
import { BottomNav, Float, Phone, PortalHeader } from "./frames";
import { Stage } from "./stage";

const NAV = [
  { label: "Beranda", icon: Home },
  { label: "Absensi", icon: School },
  { label: "Jurnal", icon: BookHeart },
  { label: "Penilaian", icon: ClipboardCheck },
  { label: "Lainnya", icon: MoreHorizontal },
];

const STUDENTS: { name: string; level?: Level }[] = [
  { name: "Aisyah Putri", level: "CONSISTENT" },
  { name: "Bilal Hafidz", level: "EMERGING" },
  { name: "Hafsa Nuraini", level: "NEEDS_REINFORCEMENT" },
  { name: "Umar Faruq" },
];

const CLASSES = [
  { name: "TK A", program: "TK Islam Terpadu", assessed: 18, enrolled: 18 },
  { name: "TK B", program: "TK Islam Terpadu", assessed: 12, enrolled: 21 },
  { name: "KB", program: "Kelompok Bermain", assessed: 0, enrolled: 15 },
];

function Completion({ assessed, enrolled }: { assessed: number; enrolled: number }) {
  const cls =
    assessed >= enrolled
      ? "bg-status-present-subtle text-status-present-text"
      : assessed > 0
        ? "bg-status-late-subtle text-status-late-text"
        : "text-muted-foreground";
  return (
    <span className={cn("font-currency inline-flex h-5 items-center whitespace-nowrap rounded-full border border-border px-2 text-xs font-medium", cls)}>
      {assessed}/{enrolled} dinilai
    </span>
  );
}

/** Penilaian pekanan: the walas rates each child on three levels; admin Pemantauan lifted beside it shows completeness per class. */
export function AssessmentMock() {
  return (
    <Stage label="assessment">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="RN" name="Bu Guru Rina" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3">
          <h1 className="text-h1 font-bold leading-tight tracking-tight">Penilaian pekanan</h1>
          <p className="mt-0.5 truncate text-body text-muted-foreground">TK A · Pekan 3 · tema Diriku</p>

          <div className="mt-2 flex h-8 items-center rounded-lg border border-input bg-background px-3 text-xs">
            <span className="truncate">Jati Diri · Menyebutkan nama lengkap</span>
          </div>

          <div className="mt-2 space-y-1.5">
            {STUDENTS.map((s) => (
              <div key={s.name} className="space-y-1 rounded-lg border border-input px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  {s.level ? <span className="shrink-0 text-xs text-muted-foreground">{LEVEL_LABEL_LONG[s.level]}</span> : null}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {LEVEL_ORDER.map((level) => (
                    <span
                      key={level}
                      className={cn(
                        "flex h-8 items-center justify-center rounded-md border px-1 text-center text-sm font-medium",
                        s.level === level ? LEVEL_CHIP_CLASS[level] : LEVEL_CHIP_CLASS_OFF[level],
                      )}
                    >
                      {LEVEL_LABEL_SHORT[level]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <BottomNav items={NAV} active="Penilaian" />
      </Phone>

      <Float className="left-[384px] top-[116px] w-[276px] p-0">
        <div className="border-b border-border px-4 pb-3 pt-4">
          <p className="text-h2">Pemantauan</p>
          <p className="mt-0.5 text-small text-muted-foreground">Pantau kelengkapan penilaian</p>
        </div>
        <div className="px-4 pb-4 pt-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            <p className="text-body font-semibold">Penilaian Pekanan (Walas)</p>
          </div>
          <p className="mb-2.5 mt-1 text-small text-muted-foreground">Pekan 3 · Aku dan namaku</p>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {CLASSES.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">{c.name}</p>
                  <p className="truncate text-caption text-muted-foreground">{c.program}</p>
                </div>
                <Completion assessed={c.assessed} enrolled={c.enrolled} />
              </div>
            ))}
          </div>
        </div>
      </Float>
    </Stage>
  );
}
