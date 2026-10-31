import { BookHeart, CalendarDays, FileText, Home, Receipt, Sprout, type LucideIcon } from "lucide-react";
import { Spotlight } from "@/components/reactbits/spotlight";
import { Stagger, StaggerItem } from "@/components/reactbits/stagger";

/** Parent deck, slide 2 — the six things in the parent portal, named as the portal names them. */
const PARTS: { icon: LucideIcon; name: string; line: string }[] = [
  { icon: Home, name: "Beranda", line: "Kabar keluarga hari ini" },
  { icon: CalendarDays, name: "Kehadiran", line: "Hadir, sakit, izin" },
  { icon: BookHeart, name: "Jurnal", line: "Buku Penghubung" },
  { icon: Sprout, name: "Perkembangan", line: "Tahapan belajar anak" },
  { icon: FileText, name: "Rapor", line: "Tiap triwulan, PDF" },
  { icon: Receipt, name: "Tagihan", line: "Bayar dan kuitansi" },
];

export function ParentMap() {
  return (
    <Stagger
      as="ul"
      count={PARTS.length}
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
      aria-label="Isi portal orang tua"
    >
      {PARTS.map((m) => {
        const Icon = m.icon;
        return (
          <StaggerItem
            key={m.name}
            as="li"
            className="relative isolate overflow-hidden rounded-2xl border border-border bg-card p-3.5 sm:p-4"
          >
            <Spotlight />
            <Icon className="size-5 text-primary-text" strokeWidth={1.75} aria-hidden="true" />
            <p className="mt-3 text-[0.95rem] font-semibold leading-tight">{m.name}</p>
            <p className="mt-1 text-[0.8rem] leading-snug text-muted-foreground">{m.line}</p>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
