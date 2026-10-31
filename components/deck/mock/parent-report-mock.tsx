import Image from "next/image";
import { BookHeart, CalendarDays, Download, Home, MoreHorizontal, Receipt, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { LEVEL_CHIP_CLASS_OFF, LEVEL_LABEL_LONG } from "@/lib/curriculum/level-presentation";
import { BottomNav, Float, Phone, PortalHeader } from "./frames";
import { Stage } from "./stage";

const NAV = [
  { label: "Beranda", icon: Home },
  { label: "Tagihan", icon: Receipt },
  { label: "Kehadiran", icon: CalendarDays },
  { label: "Jurnal", icon: BookHeart },
  { label: "Lainnya", icon: MoreHorizontal },
];

const ATTENDANCE = [
  { label: "Sakit", value: 1 },
  { label: "Izin", value: 0 },
  { label: "Alpa", value: 0 },
  { label: "Hari sekolah", value: 58 },
];

const NARASI =
  "Aisyah tumbuh menjadi anak yang ceria. Ia mulai berani menyapa teman dengan salam saat tiba di kelas.";

/** Parent rapor: the published report opened in its sheet (narasi, kehadiran, Unduh PDF), beside the PDF page it downloads. */
export function ParentReportMock() {
  return (
    <Stage label="parent-report">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {/* The list page behind the sheet: its gold "sudah terbit" card, dimmed. */}
          <div className="px-4 pt-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-celebration-gold bg-celebration-gold-subtle p-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-celebration-gold-subtle text-celebration-gold-text">
                <Sparkles size={16} />
              </div>
              <p className="min-w-0 truncate text-sm font-semibold text-celebration-gold-text">Rapor Aisyah sudah terbit</p>
            </div>
          </div>
          <div className="absolute inset-0 bg-foreground/25" />

          <div className="absolute inset-x-0 bottom-0 top-[46px] overflow-hidden rounded-t-2xl border-t border-border bg-background px-4 pt-3 shadow-card-elevated">
            <div className="border-b border-border pb-2">
              <p className="text-base font-semibold leading-snug">Rapor Triwulan 1 · Aisyah Putri</p>
            </div>

            <div className="mt-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-semibold">Jati Diri</h3>
                <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium", LEVEL_CHIP_CLASS_OFF.CONSISTENT)}>
                  {LEVEL_LABEL_LONG.CONSISTENT}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-foreground">{NARASI}</p>
            </div>

            <div className="mt-2.5">
              <h3 className="mb-1.5 text-sm font-semibold">Kehadiran</h3>
              <div className="grid grid-cols-[1fr_1fr_1fr_1.7fr] gap-1.5">
                {ATTENDANCE.map((a) => (
                  <div key={a.label} className="min-w-0 rounded-lg border border-border bg-card px-1 py-1.5 text-center">
                    <p className="truncate text-[0.6875rem] uppercase text-muted-foreground">{a.label}</p>
                    <p className="text-base font-bold tabular-nums text-foreground">{a.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2.5 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium">
              <Download size={16} />
              Unduh PDF
            </div>
          </div>
        </div>
        <BottomNav items={NAV} active="Lainnya" />
      </Phone>

      <Float className="left-[392px] top-[40px] w-[264px] -rotate-2 p-0">
        <div className="space-y-2.5 px-5 py-5">
          <div className="flex items-center gap-2 border-b border-border pb-2.5">
            <Image src="/logo.png" alt="" width={24} height={24} className="rounded-md" />
            <div className="min-w-0">
              <p className="truncate text-[0.6875rem] font-semibold leading-tight">An Nisaa&apos; Sekolahku</p>
              <p className="truncate text-[0.6875rem] leading-tight text-muted-foreground">Laporan Perkembangan Anak</p>
            </div>
          </div>
          <div className="text-[0.6875rem] leading-snug">
            <p>
              <span className="text-muted-foreground">Nama</span> <b>Aisyah Putri</b>
            </p>
            <p>
              <span className="text-muted-foreground">Kelas</span> TK A Al-Fatih · Triwulan 1
            </p>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1 text-[0.6875rem] font-semibold">Jati Diri</div>
          <p className="text-[0.6875rem] leading-relaxed text-foreground">{NARASI}</p>
          <div className="space-y-1.5 pt-0.5" aria-hidden>
            <div className="h-1.5 w-full rounded-full bg-muted" />
            <div className="h-1.5 w-11/12 rounded-full bg-muted" />
            <div className="h-1.5 w-2/3 rounded-full bg-muted" />
          </div>
          <p className="pt-3 text-center text-[0.6875rem] text-muted-foreground">Halaman 1 dari 2</p>
        </div>
      </Float>
    </Stage>
  );
}
