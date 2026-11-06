import { BookHeart, CalendarDays, Check, ClipboardCheck, Download, Home, MoreHorizontal, School } from "lucide-react";
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

type Mark = "S" | "I" | undefined;

const STUDENTS: { name: string; nickname: string; mark: Mark }[] = [
  { name: "Aisyah Putri", nickname: "Aisyah", mark: undefined },
  { name: "Bilal Hafidz", nickname: "Bilal", mark: "I" },
  { name: "Hafsa Nuraini", nickname: "Hafsa", mark: "S" },
  { name: "Umar Faruq", nickname: "Umar", mark: undefined },
  { name: "Zaid Ahmad", nickname: "Zaid", mark: undefined },
];

// Same letters and colours as the real row: Sakit is the amber "late" family, Izin the blue "leave" family.
const SELECTED: Record<string, string> = {
  S: "border-transparent bg-status-late text-white",
  I: "border-transparent bg-status-leave text-white",
};
const ROW_TINT: Record<string, string> = { S: "bg-status-late-subtle", I: "bg-status-leave-subtle" };

const MONTHLY = [
  { name: "TK A Al-Fatih", percent: 96, caption: "21 hari efektif" },
  { name: "TK B Al-Hikmah", percent: 92, caption: "21 hari efektif" },
  { name: "KB Melati", percent: 88, caption: "20 hari efektif" },
];

/** Class attendance: the teacher's roll screen with two absences marked, beside the admin monthly recap it feeds. */
export function ClassAttendanceMock() {
  return (
    <Stage label="class-attendance">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="RN" name="Bu Guru Rina" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3.5">
          <h1 className="mb-2.5 text-h1 font-bold leading-tight tracking-tight">Absensi kelas</h1>

          <div className="mb-2.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-h2">
              TK A<span className="ml-1.5 text-small font-normal text-muted-foreground">Al-Fatih</span>
            </p>
            <span className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm">
              31/10/2026
              <CalendarDays className="size-4 text-muted-foreground" />
            </span>
          </div>

          <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">Hadir 0</span>
            <span className="text-status-late-text">Sakit 1</span>
            <span className="text-status-leave-text">Izin 1</span>
            <span className="text-muted-foreground">Alpa 0</span>
            <span className="text-muted-foreground">18 belum</span>
          </div>

          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {STUDENTS.map((s) => (
              <div key={s.name} className={cn("flex items-center gap-3 px-3 py-1", s.mark && ROW_TINT[s.mark])}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{s.nickname}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {["H", "S", "I", "A"].map((letter) => {
                    const selected = s.mark === letter;
                    return (
                      <span
                        key={letter}
                        className={cn(
                          "grid size-8 place-items-center rounded-lg border text-sm font-semibold",
                          selected ? SELECTED[letter] : "border-border bg-background text-muted-foreground",
                        )}
                      >
                        {letter}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 border-t border-border bg-background px-4 py-2.5">
          <div className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            <Check className="size-4" />
            Tandai 18 siswa lainnya Hadir
          </div>
        </div>
        <BottomNav items={NAV} active="Absensi" />
      </Phone>

      <Float className="left-[384px] top-[132px] w-[276px] p-0">
        <div className="border-b border-border px-4 pb-3 pt-4">
          <p className="whitespace-nowrap text-h2">Kehadiran Siswa</p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="whitespace-nowrap text-small text-muted-foreground">Rekap Bulanan</p>
            <span className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs font-medium">
              <Download className="size-3" />
              Ekspor CSV
            </span>
          </div>
        </div>
        <div className="space-y-3.5 px-4 py-4">
          {MONTHLY.map((row) => (
            <div key={row.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body font-medium">{row.name}</span>
                <span className="shrink-0 text-body font-semibold tabular-nums">{row.percent}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
              </div>
              <p className="mt-1 text-caption text-muted-foreground">{row.caption}</p>
            </div>
          ))}
        </div>
      </Float>
    </Stage>
  );
}
