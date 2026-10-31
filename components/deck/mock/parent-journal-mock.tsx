import { BookHeart, CalendarDays, CalendarOff, Check, ChevronLeft, ChevronRight, Home, MoreHorizontal, Pencil, Plus, Receipt, Trash2 } from "lucide-react";
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

// Sen, Sel, Rab, Kam, Jum. Sel is the swimming day (no buku penghubung), Rab Aisyah was away, Kam is today.
const DAYS = [
  { label: "Sen", date: "26/10" },
  { label: "Sel", date: "27/10", off: true },
  { label: "Rab", date: "28/10" },
  { label: "Kam", date: "29/10", today: true },
  { label: "Jum", date: "30/10" },
];

const ROWS: { label: string; ticks: boolean[] }[] = [
  { label: "Tahfizul Qur'an", ticks: [true, false, false, true, false] },
  { label: "Membawa Infaq", ticks: [true, false, false, true, false] },
  { label: "Qiro'atul Qur'an", ticks: [true, false, false, true, false] },
];

function Cell({ tick, off, today, last }: { tick: boolean; off?: boolean; today?: boolean; last?: boolean }) {
  return (
    <td className={cn("p-0 text-center align-middle", off && "bg-muted/60", today && (tick ? "bg-status-present-subtle" : "bg-primary/5"), today && last && "border-b-2 border-primary")}>
      <span className="flex h-8 items-center justify-center">
        {tick ? <Check size={16} strokeWidth={2.5} className="text-primary-text" /> : <span className="block h-px w-3.5 bg-muted-foreground/40" />}
      </span>
    </td>
  );
}

function Avatar({ children, own }: { children: string; own?: boolean }) {
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[0.6875rem] font-medium", own ? "bg-secondary text-primary-text" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}

function RoleBadge({ children }: { children: string }) {
  return <span className="rounded-full border border-border px-1.5 text-xs font-medium">{children}</span>;
}

/** Parent Jurnal: the Di sekolah week grid with today ticked and a swimming day noted, beside the Catatan thread. */
export function ParentJournalMock() {
  return (
    <Stage label="parent-journal">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3">
          <div className="flex gap-2">
            <span className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-md">Aisyah</span>
            <span className="inline-flex h-8 items-center rounded-full bg-muted px-4 text-sm font-medium text-muted-foreground">Umar</span>
          </div>

          <h1 className="mt-1.5 text-h1 font-bold leading-tight tracking-tight">Jurnal</h1>

          <div className="mt-1 flex items-center justify-between gap-2">
            <ChevronLeft size={20} className="mx-2" />
            <span className="truncate text-sm font-medium">26 – 30 Okt 2026 · pekan ini</span>
            <ChevronRight size={20} className="mx-2 text-muted-foreground/50" />
          </div>

          <div className="mt-1.5 flex rounded-lg bg-muted p-[3px] text-sm font-medium">
            <span className="flex-1 rounded-md bg-background py-1.5 text-center shadow-sm">Di sekolah</span>
            <span className="flex-1 py-1.5 text-center text-foreground/60">Di rumah</span>
            <span className="flex-1 py-1.5 text-center text-foreground/60">Catatan</span>
          </div>

          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarOff size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Sel 27/10</span> · Tanpa buku penghubung: Renang
            </span>
          </p>

          <table className="mt-1.5 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-[96px] py-1 pr-1 text-left text-xs font-medium text-muted-foreground">Indikator</th>
                {DAYS.map((d) => (
                  <th
                    key={d.label}
                    className={cn(
                      "w-[40px] px-0.5 py-1 text-center text-xs",
                      d.today ? "border-t-2 border-primary bg-primary/5 font-semibold text-primary-text" : "font-medium text-muted-foreground",
                    )}
                  >
                    <div>{d.label}</div>
                    <div className={cn("text-xs font-normal", d.today ? "text-primary-text" : "text-muted-foreground/70")}>{d.date}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={6} className="border-l-4 border-l-primary bg-primary/5 py-1 pl-3 text-h2 leading-tight">
                  Ibadah
                </td>
              </tr>
              {ROWS.map((r, i) => (
                <tr key={r.label} className="border-b border-border/40 last:border-0">
                  <td className="whitespace-nowrap py-1 pr-1 text-xs leading-tight">{r.label}</td>
                  {DAYS.map((d, j) => (
                    <Cell key={d.label} tick={r.ticks[j]!} off={d.off} today={d.today} last={i === ROWS.length - 1} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BottomNav items={NAV} active="Jurnal" />
      </Phone>

      <Float className="left-[384px] top-[104px] w-[272px] space-y-2.5 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-h2 font-semibold">Catatan</p>
          <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-3 text-xs font-medium">
            <Plus size={14} />
            Tulis catatan
          </span>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Avatar>RN</Avatar>
            <span className="text-xs font-medium">Bu Guru Rina</span>
            <RoleBadge>Bu Guru</RoleBadge>
          </div>
          <p className="text-xs text-muted-foreground">28 Okt · 14.20</p>
          <p className="text-sm leading-relaxed">Aisyah mulai berani maju membaca Iqra di depan kelas. Alhamdulillah.</p>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Avatar own>NR</Avatar>
            <span className="text-xs font-medium">Bu Nur</span>
            <RoleBadge>Orang Tua</RoleBadge>
            <span className="ml-auto flex items-center gap-2.5 text-muted-foreground">
              <Pencil size={14} />
              <Trash2 size={14} />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">28 Okt · 19.05</p>
          <p className="text-sm leading-relaxed">Terima kasih, Bu Guru. Di rumah Aisyah juga semangat mengulang bacaannya.</p>
        </div>
      </Float>
    </Stage>
  );
}
