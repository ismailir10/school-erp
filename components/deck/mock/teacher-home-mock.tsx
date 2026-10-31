import { BookHeart, CalendarDays, ChevronRight, ClipboardCheck, ClipboardList, Home, MoreHorizontal, Presentation, School, User, Wallet, type LucideIcon } from "lucide-react";
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

type Tone = "teal" | "warm" | "purple";

// Same tints as TaskRow: teal for attendance, amber for the journal, purple for assessment.
const TONE: Record<Tone, string> = {
  teal: "bg-secondary text-primary-text",
  warm: "bg-status-late-subtle text-status-late-text",
  purple: "bg-status-holiday-subtle text-status-holiday-text",
};

const TASKS: { title: string; description: string; meta?: string; icon: LucideIcon; tone: Tone }[] = [
  { title: "Absensi TK A Al-Fatih", description: "0 dari 20 siswa tercatat", meta: "Buka", icon: CalendarDays, tone: "teal" },
  { title: "Jurnal TK A Al-Fatih", description: "2 dari 20 siswa lengkap", meta: "Buka", icon: BookHeart, tone: "warm" },
  { title: "Buka penilaian", description: "Penilaian pekanan · TK A Al-Fatih", icon: ClipboardList, tone: "purple" },
];

const MORE: { label: string; description: string; icon: LucideIcon }[] = [
  { label: "Kehadiran saya", description: "Riwayat kehadiran, cuti, dan izin", icon: CalendarDays },
  { label: "Slip gaji", description: "Lihat slip gaji bulanan", icon: Wallet },
  { label: "Profil saya", description: "Data akun dan kontak", icon: User },
  { label: "Panduan Talib", description: "Tur singkat semua modul Talib", icon: Presentation },
];

/** Beranda guru: personal check-in, today's class with its attendance action, and the to-do list. */
export function TeacherHomeMock() {
  return (
    <Stage label="teacher-home">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="RN" name="Bu Guru Rina" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-2.5">
          <h1 className="truncate text-h1 font-bold leading-tight tracking-tight">Selamat siang, Bu Rina</h1>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="min-w-0 text-small text-muted-foreground">Kehadiran pribadi belum dicatat</p>
            <span className="flex h-9 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium">Catat masuk</span>
          </div>

          <div className="mt-2 rounded-xl border border-primary/20 bg-secondary px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-small font-semibold text-muted-foreground">Kelas hari ini</p>
              <p className="text-small text-muted-foreground">20 siswa · 31 Oktober</p>
            </div>
            <h2 className="mt-1 text-h1 font-bold leading-tight tracking-tight">TK A Al-Fatih</h2>
            <div className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground">
              <ClipboardList className="size-4" />
              Lanjutkan absensi · 0/20
            </div>
          </div>

          <h2 className="mb-1.5 mt-2.5 text-h2">Yang perlu diselesaikan</h2>
          <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card">
            {TASKS.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.title} className="flex items-center gap-3 px-3 py-1.5">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", TONE[t.tone])}>
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold leading-snug">{t.title}</p>
                    <p className="truncate text-small text-muted-foreground">{t.description}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-body font-semibold text-muted-foreground">
                    {t.meta}
                    <ChevronRight className="size-4" />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <BottomNav items={NAV} active="Beranda" />
      </Phone>

      <Float className="left-[374px] top-[84px] w-[290px] p-0">
        <div className="px-4 pb-2 pt-4">
          <p className="text-h2">Lainnya</p>
          <p className="mt-0.5 text-small text-muted-foreground">Halaman pribadi yang tidak dibuka setiap hari</p>
        </div>
        <div className="space-y-2 px-4 pb-4">
          {MORE.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      </Float>
    </Stage>
  );
}
