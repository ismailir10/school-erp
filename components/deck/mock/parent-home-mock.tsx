import { BookHeart, CalendarDays, ChevronRight, Home, MessageCircle, MoreHorizontal, Receipt } from "lucide-react";
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

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** The small status pill a kid card carries top right, same tokens as StatusBadge. */
function Chip({ tone, children }: { tone: "present" | "neutral"; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "present" ? "bg-status-present-subtle text-status-present-text" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** A compact KidCard: name, today's chip, class and the week line. */
function Kid({ name, foot, chip, warn }: { name: string; foot: string; chip: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-1.5 shadow-card-resting">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{name}</p>
        <Chip tone="present">{chip}</Chip>
      </div>
      <p className={cn("mt-0.5 truncate text-xs", warn ? "text-status-late-text" : "text-muted-foreground")}>{foot}</p>
    </div>
  );
}

/** Parent Beranda: the family's day in one screen, with the new note from Bu Guru lifted beside it. */
export function ParentHomeMock() {
  return (
    <Stage label="parent-home">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-2">
          <p className="text-sm text-muted-foreground">Assalamu&apos;alaikum, Bu Nur</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Kabar keluarga hari ini</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Selamat siang · Kamis, 29 Oktober 2026</p>

          <div className="mt-2">
            <SectionLabel>Hari ini</SectionLabel>
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 rounded-xl bg-status-present-subtle px-3 py-2 text-sm ring-1 ring-border">
                <CalendarDays className="size-5 shrink-0 text-status-present-text" />
                <span className="min-w-0">
                  <strong>Aisyah Putri sudah hadir.</strong>
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-card-resting">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-status-late-subtle text-status-late-text">
                  <Receipt className="size-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Tagihan keluarga</p>
                  <p className="text-xs text-muted-foreground">3 belum dibayar</p>
                </div>
                <span className="font-amount whitespace-nowrap text-[0.9375rem] font-semibold">
                  <span className="mr-1 text-[0.6875rem] font-medium text-muted-foreground">Rp</span>1.275.000
                </span>
              </div>
            </div>
          </div>

          <div className="mt-2">
            <SectionLabel>Anak saya</SectionLabel>
            <div className="space-y-1.5">
              <Kid name="Aisyah Putri" chip="Hadir" foot="TK A · Hadir 3 · Sakit 1 pekan ini" warn />
              <Kid name="Umar Faruq" chip="Hadir" foot="KB · Hadir 4 hari pekan ini" />
            </div>
          </div>
        </div>
        <BottomNav items={NAV} active="Beranda" />
      </Phone>

      <Float className="left-[384px] top-[128px] w-[272px] space-y-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-status-leave-subtle text-status-leave-text">
            <MessageCircle size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">Catatan baru dari Bu Guru</p>
            <p className="truncate text-xs text-muted-foreground">Aisyah Putri · TK A Al-Fatih</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">Catatan guru:</span> Aisyah semangat menyusun balok hari ini dan mau berbagi dengan teman-temannya.
        </p>
        <p className="text-xs text-muted-foreground">Bu Guru Rina · 29 Oktober</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex h-9 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">Baca catatan</div>
          <div className="flex h-9 items-center justify-center rounded-lg border border-border bg-background text-xs font-medium">Lihat kehadiran</div>
        </div>
        <div className="flex items-center gap-4 border-t border-border pt-2.5 text-xs font-medium text-primary-text">
          <span>Perkembangan</span>
          <span>Rapor</span>
          <span>Tagihan</span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
        </div>
      </Float>
    </Stage>
  );
}
