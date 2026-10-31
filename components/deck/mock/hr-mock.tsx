import { BookHeart, CalendarDays, ClipboardCheck, Download, Home, MoreHorizontal, School } from "lucide-react";
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

type Status = "present" | "late" | "absent" | "leave";

// Same fills as the attendance calendar: Hadir, Terlambat, Alpa, Izin.
const CELL: Record<Status, string> = {
  present: "bg-status-present text-white",
  late: "bg-status-late text-white",
  absent: "bg-status-absent text-white",
  leave: "bg-status-leave text-white",
};

const STATS: { label: string; value: number; tone: string }[] = [
  { label: "Hadir", value: 18, tone: "text-status-present-text" },
  { label: "Terlambat", value: 2, tone: "text-status-late-text" },
  { label: "Alpa", value: 1, tone: "text-status-absent-text" },
  { label: "Izin", value: 1, tone: "text-status-leave-text" },
];

// October 2026 starts on a Thursday. Weekdays only carry a status; 31 is today and not yet recorded.
const SPECIAL: Record<number, Status> = { 13: "late", 15: "leave", 16: "late", 29: "absent" };
const WEEKS: (number | null)[][] = [
  [null, null, null, null, 1, 2, 3],
  [4, 5, 6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15, 16, 17],
  [18, 19, 20, 21, 22, 23, 24],
  [25, 26, 27, 28, 29, 30, 31],
];

function statusOf(day: number, col: number): Status | null {
  if (col === 0 || col === 6 || day === 31) return null;
  return SPECIAL[day] ?? "present";
}

const SLIPS = [
  { month: "Oktober 2026", range: "21 September – 20 Oktober 2026" },
  { month: "September 2026", range: "21 Agustus – 20 September 2026" },
];

/** Teacher "Kehadiran saya" with the Cuti dan izin entry, beside the Slip gaji list the payroll run produces. */
export function HrMock() {
  return (
    <Stage label="hr">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="RN" name="Bu Guru Rina" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3">
          <h1 className="text-h1 font-bold leading-tight tracking-tight">Kehadiran saya</h1>

          <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Cuti dan izin</p>
              <p className="truncate text-xs text-muted-foreground">Lihat saldo dan ajukan cuti</p>
            </div>
          </div>

          <p className="mb-1 mt-2 text-center text-sm font-semibold">Oktober 2026</p>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].map((d) => (
              <span key={d} className="text-center text-xs font-semibold text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
          <div className="space-y-[3px]">
            {WEEKS.map((week, i) => (
              <div key={i} className="grid grid-cols-7 gap-1">
                {week.map((day, col) => {
                  if (day === null) return <span key={col} className="h-[22px]" />;
                  const status = statusOf(day, col);
                  return (
                    <span
                      key={col}
                      className={cn(
                        "grid h-[22px] place-items-center rounded-md text-xs font-medium",
                        status ? CELL[status] : "bg-muted/50 text-muted-foreground",
                        day === 31 && "ring-2 ring-primary/60",
                      )}
                    >
                      {day}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-4 gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className={cn("font-currency text-base font-bold leading-tight", s.tone)}>{s.value}</p>
                <p className="text-caption text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
        <BottomNav items={NAV} active="Lainnya" />
      </Phone>

      <Float className="left-[374px] top-[128px] w-[290px] p-0">
        <div className="px-4 pb-2 pt-4">
          <p className="text-h1 font-bold leading-tight tracking-tight">Slip gaji</p>
        </div>
        <div className="space-y-2.5 px-4 pb-4 pt-1">
          {SLIPS.map((slip) => (
            <div key={slip.month} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{slip.month}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{slip.range}</p>
                <span className="mt-2 inline-flex items-center rounded-full bg-status-present-subtle px-2 py-0.5 text-xs font-medium text-status-present-text">
                  Tersedia
                </span>
              </div>
              <span className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-sm font-medium">
                <Download className="size-3.5" />
                PDF
              </span>
            </div>
          ))}
        </div>
      </Float>
    </Stage>
  );
}
