import { BookHeart, Check, CalendarOff, ChevronDown, ChevronUp, ChevronRight, ClipboardCheck, Home, ListChecks, MessageSquarePlus, MoreHorizontal, School } from "lucide-react";
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

const INDICATORS = [
  { label: "Berdoa sebelum makan", checked: true },
  { label: "Merapikan tempat bekal", checked: false },
];

const OTHERS = [
  { name: "Bilal Hafidz", nickname: "Bilal", count: 3, tick: true },
  { name: "Hafsa Nuraini", nickname: "Hafsa", count: 0, tick: false },
];

const SUGGESTIONS = ["Renang", "Libur", "Kegiatan luar"];

/** Isi Buku Penghubung: the class progress and quick-fill action over per-child indicator ticks, with the day-mark dialog lifted beside it. */
export function JournalMock() {
  return (
    <Stage label="journal">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="RN" name="Bu Guru Rina" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-3.5">
          <h1 className="text-h1 font-bold leading-tight tracking-tight">Isi Buku Penghubung</h1>
          <p className="mt-0.5 truncate text-body text-muted-foreground">TK A Al-Fatih · Sabtu, 31 Oktober 2026</p>
          <p className="mb-1.5 mt-1.5 text-xs text-muted-foreground">2/20 siswa lengkap</p>

          <div className="mb-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-sm font-medium">
            <ListChecks className="size-4" />
            Isi cepat satu kelas
          </div>

          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-stretch">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-white">
                      <Check className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">Aisyah Putri</p>
                      <p className="truncate text-xs text-muted-foreground">Aisyah</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">1/16</span>
                    <ChevronUp className="size-4 text-muted-foreground" />
                  </div>
                </div>
                <span className="flex min-w-10 items-center justify-center border-l border-border text-muted-foreground">
                  <MessageSquarePlus className="size-[18px]" />
                </span>
                <span className="flex min-w-10 items-center justify-center border-l border-border text-muted-foreground">
                  <ChevronRight className="size-[18px]" />
                </span>
              </div>
              <div className="space-y-1 border-t border-border px-3 pb-2 pt-1.5">
                {INDICATORS.map((ind) => (
                  <div
                    key={ind.label}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-1.5",
                      ind.checked ? "border-primary bg-primary/10 text-primary-text" : "border-border text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border-2",
                        ind.checked ? "border-primary bg-primary" : "border-muted-foreground/40",
                      )}
                    >
                      {ind.checked ? <Check className="size-[11px] text-white" /> : null}
                    </span>
                    <span className="truncate text-xs leading-snug">{ind.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {OTHERS.map((s) => (
              <div key={s.name} className="flex items-stretch overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white",
                        s.tick ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                    >
                      {s.tick ? <Check className="size-3.5" /> : s.name.slice(0, 1) + s.name.split(" ")[1].slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.nickname}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{s.count}/16</span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </div>
                </div>
                <span className="flex min-w-10 items-center justify-center border-l border-border text-muted-foreground">
                  <MessageSquarePlus className="size-[18px]" />
                </span>
                <span className="flex min-w-10 items-center justify-center border-l border-border text-muted-foreground">
                  <ChevronRight className="size-[18px]" />
                </span>
              </div>
            ))}
          </div>
        </div>
        <BottomNav items={NAV} active="Jurnal" />
      </Phone>

      <Float className="left-[384px] top-[110px] w-[276px] p-0">
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary-text">
              <CalendarOff className="size-4" />
            </span>
            <p className="text-base font-semibold leading-tight">Hari tanpa buku penghubung</p>
          </div>
          <p className="mt-2 text-small text-muted-foreground">
            Sabtu, 31 Oktober. Wali akan melihat keterangan ini di kolom hari tersebut.
          </p>
        </div>
        <div className="space-y-2 px-4 pb-4">
          <p className="text-sm font-medium">Keterangan</p>
          <div className="flex h-10 items-center rounded-lg border border-input bg-background px-3 text-sm">Renang</div>
          <div className="flex justify-end text-xs tabular-nums text-muted-foreground">6/60</div>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((label) => (
              <span
                key={label}
                className={cn(
                  "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium",
                  label === "Renang" ? "border-primary bg-primary/10 text-primary-text" : "border-border text-foreground",
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <span className="flex h-9 items-center px-3 text-sm font-medium text-muted-foreground">Batal</span>
          <span className="flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Simpan</span>
        </div>
      </Float>
    </Stage>
  );
}
