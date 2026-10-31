import { BookHeart, CalendarDays, Home, Info, MoreHorizontal, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_CHIP_CLASS_OFF, LEVEL_LABEL_LONG, type Level } from "@/lib/curriculum/level-presentation";
import { BottomNav, Float, Phone, PortalHeader } from "./frames";
import { Stage } from "./stage";

const NAV = [
  { label: "Beranda", icon: Home },
  { label: "Tagihan", icon: Receipt },
  { label: "Kehadiran", icon: CalendarDays },
  { label: "Jurnal", icon: BookHeart },
  { label: "Lainnya", icon: MoreHorizontal },
];

const ENTRIES: { element: string; indicator: string; level: Level; date: string }[] = [
  { element: "Nilai Agama & Budi Pekerti", indicator: "Berdoa sebelum makan", level: "CONSISTENT" },
  { element: "Jati Diri", indicator: "Menyebutkan perasaan", level: "EMERGING" },
  { element: "STEAM / Literasi", indicator: "Menyusun balok tinggi", level: "NEEDS_REINFORCEMENT" },
];

/** The level chip as the real "Pekan ini" row draws it: the light tint family, full level name. */
function LevelChip({ level, className }: { level: Level; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-right text-xs font-medium", LEVEL_CHIP_CLASS_OFF[level], className)}>
      {LEVEL_LABEL_LONG[level]}
    </span>
  );
}

/** Parent Perkembangan: weekly indicator rows with their three levels, and one indicator opened up with a gentle note. */
export function GrowthMock() {
  return (
    <Stage label="growth">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-2">
          <div className="rounded-lg border border-border bg-secondary/40 px-4 py-1">
            <p className="text-sm font-semibold text-primary-text">Aisyah Putri</p>
            <p className="text-small leading-tight text-muted-foreground">TK A · Al-Fatih</p>
          </div>

          <h1 className="mt-2 text-h1 font-bold leading-tight tracking-tight">Perkembangan</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Ini tahapan perkembangan, bukan nilai. Setiap anak berkembang di waktunya masing-masing.
          </p>

          <p className="mb-1.5 mt-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Pekan ini</p>
          <ul className="space-y-1.5">
            {ENTRIES.map((e) => (
              <li
                key={e.indicator}
                className={cn(
                  "rounded-lg border bg-card px-2.5 py-2",
                  e.level === "NEEDS_REINFORCEMENT" ? "border-status-leave ring-2 ring-status-leave/20" : "border-input",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">{e.element}</p>
                    <p className="mt-0.5 truncate text-sm leading-snug text-foreground">{e.indicator}</p>
                  </div>
                  <LevelChip level={e.level} className="max-w-[36%]" />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <BottomNav items={NAV} active="Lainnya" />
      </Phone>

      <Float className="left-[384px] top-[128px] w-[276px] space-y-3">
        <div>
          <p className="text-xs text-muted-foreground">STEAM / Literasi · Sentra Balok</p>
          <p className="mt-0.5 text-sm text-foreground">Menyusun balok tinggi</p>
          <p className="mt-1 text-xs text-muted-foreground">Kegiatan: membangun menara bersama teman</p>
        </div>
        <LevelChip level="NEEDS_REINFORCEMENT" className="inline-block" />
        <div className="flex items-start gap-2 rounded-lg bg-status-leave-subtle p-3 text-status-leave-text">
          <Info size={16} className="mt-0.5 shrink-0" />
          <p className="text-sm leading-snug">
            Bagian yang bisa didampingi bersama di rumah. Ini bukan tanda bahaya, hanya tahap yang sedang tumbuh.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Dinilai Bu Guru Rina · 30 Oktober</p>
      </Float>
    </Stage>
  );
}
