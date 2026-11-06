import { BookHeart, CalendarDays, Check, ChevronLeft, ChevronRight, Home, MessageCircle, MoreHorizontal, Receipt, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomNav, Float, Phone, PortalHeader } from "./frames";
import { Stage } from "./stage";

const NAV = [
  { label: "Beranda", icon: Home },
  { label: "Tagihan", icon: Receipt },
  { label: "Kehadiran", icon: CalendarDays },
  { label: "Jurnal", icon: BookHeart },
  { label: "Lainnya", icon: MoreHorizontal },
];

type Mark = "H" | "S" | "A" | "I" | "-";

const DAYS: { label: string; date: string; mark: Mark; today?: boolean }[] = [
  { label: "Sen", date: "26/10", mark: "H" },
  { label: "Sel", date: "27/10", mark: "H" },
  { label: "Rab", date: "28/10", mark: "S" },
  { label: "Kam", date: "29/10", mark: "H", today: true },
  { label: "Jum", date: "30/10", mark: "-" },
];

function MarkCell({ mark }: { mark: Mark }) {
  if (mark === "H") return <Check size={16} strokeWidth={2.5} className="text-primary" />;
  if (mark === "S") return <span className="text-xs font-bold text-status-late-text">S</span>;
  return <span className="text-muted-foreground/60">-</span>;
}

/** Parent Kehadiran: this week's grid, Sen to Jum, with today marked and the sick-day banner lifted beside it. */
export function ParentAttendanceMock() {
  return (
    <Stage label="parent-attendance">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3">
          <div className="flex gap-2">
            <span className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md">Aisyah</span>
            <span className="inline-flex h-9 items-center rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground">Umar</span>
          </div>

          <div className="mt-2.5 rounded-lg border border-border bg-secondary/40 px-4 py-1.5">
            <p className="text-sm font-semibold text-primary-text">Aisyah Putri</p>
            <p className="text-xs text-muted-foreground">TK A · Al-Fatih</p>
          </div>

          <h1 className="mt-3 text-h1 font-bold leading-tight tracking-tight">Kehadiran</h1>
          <p className="mt-0.5 text-body text-muted-foreground">Pantau kehadiran harian anak</p>

          <div className="mt-2 flex items-center justify-between gap-2">
            <ChevronLeft size={20} className="mx-2" />
            <span className="text-sm font-medium">26 Okt – 30 Okt 2026</span>
            <ChevronRight size={20} className="mx-2" />
          </div>

          <div className="mt-2">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-[68px] py-2 pr-2" />
                  {DAYS.map((d) => (
                    <th
                      key={d.label}
                      className={cn(
                        "w-[44px] px-1 py-2 text-center text-xs",
                        d.today ? "border-t-2 border-primary bg-status-present-subtle font-semibold text-primary-text" : "font-medium text-muted-foreground",
                      )}
                    >
                      <div>{d.label}</div>
                      <div className={cn("text-xs font-normal", d.today ? "text-primary-text" : "text-muted-foreground/70")}>{d.date}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/40">
                  <th className="py-2 pr-2 text-left text-xs font-normal">Status</th>
                  {DAYS.map((d) => (
                    <td key={d.label} className={cn("p-0 text-center align-middle", d.today && "border-b-2 border-primary bg-status-present-subtle")}>
                      <span className="inline-flex size-9 items-center justify-center">
                        <MarkCell mark={d.mark} />
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <Check className="mr-0.5 inline size-3 align-middle text-primary" />Hadir
              </span>
              <span>
                <b className="text-status-late-text">S</b> Sakit
              </span>
              <span>
                <b className="text-status-absent-text">A</b> Alpa
              </span>
              <span>
                <b className="text-status-leave-text">I</b> Izin
              </span>
            </div>
          </div>
        </div>
        <BottomNav items={NAV} active="Kehadiran" />
      </Phone>

      <Float className="left-[384px] top-[118px] w-[272px] space-y-3 p-3.5">
        <div className="rounded-xl border border-status-late bg-status-late-subtle p-3">
          <div className="flex items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-status-late-subtle text-status-late-text">
              <Thermometer size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-status-late-text">Hadir 3 · Sakit 1 · Alpa 0</p>
              <p className="mt-1 text-xs text-muted-foreground">Aisyah tercatat sakit pekan ini, semoga lekas sehat.</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Catatan dari sekolah</p>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-status-leave-subtle text-status-leave-text">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">Aisyah sakit hari Rabu. Kami tunggu kembali di sekolah ya, Bu.</p>
              <p className="mt-1 text-xs text-muted-foreground">Bu Guru · 28 Oktober</p>
            </div>
          </div>
        </div>
      </Float>
    </Stage>
  );
}
