import Image from "next/image";
import { ClipboardCheck, GraduationCap, LayoutDashboard, Plus, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const RAIL = [
  { icon: LayoutDashboard },
  { icon: GraduationCap, active: true },
  { icon: ClipboardCheck },
  { icon: Wallet },
  { icon: Users },
];

// The three rail tiles, as buildRailTiles words them: label, figure, hint, and the tone of the figure.
const TILES = [
  { label: "Tunggakan", value: "Rp 850.000", hint: "1 tagihan belum lunas · 5 Nov", tone: "text-destructive", mono: true },
  { label: "Hadir bulan ini", value: "17/18", hint: "1 sakit", tone: "text-foreground", mono: false },
  { label: "Rapor", value: "1/2", hint: "semua terbit", tone: "text-foreground", mono: false },
];

const GROUPS = ["Profil", "Keluarga & Berkas", "Kelas & Akademik", "Keuangan", "Pendaftaran & Catatan"];
const ACTIVE_GROUP = "Keuangan";

const INVOICES = [
  { title: "SPP November 2026", due: "Jatuh tempo 5 Nov 2026", amount: "Rp 850.000", status: "Belum bayar", tone: "bg-status-late-subtle text-status-late-text" },
  { title: "SPP Oktober 2026", due: "Dibayar 3 Okt 2026", amount: "Rp 850.000", status: "Lunas", tone: "bg-status-present-subtle text-status-present-text" },
];

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5 w-fit items-center whitespace-nowrap rounded-full px-2 text-xs font-medium", tone)}>{children}</span>;
}

/** Student detail: the answers on top (Tunggakan, Hadir, Rapor), the five group tabs with Keuangan open, and the Cuti card lifted over the corner. */
export function StudentDetailMock() {
  return (
    <Stage label="student-detail">
      <Browser url="/admin/students/aisyah-putri" className="left-3 top-3 h-[400px] w-[656px]">
        <div className="flex h-[calc(100%-32px)]">
          <div className="flex w-10 shrink-0 flex-col items-center gap-2 bg-sidebar py-3">
            <Image src="/logo.png" alt="" width={22} height={22} className="mb-2 rounded-md" />
            {RAIL.map(({ icon: Icon, active }, i) => (
              <span
                key={i}
                className={cn("grid size-7 place-items-center rounded-md", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground")}
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-hidden bg-background px-4 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-h1 font-bold leading-tight tracking-tight">Aisyah Putri</h1>
                  <Chip tone="bg-status-present-subtle text-status-present-text">Aktif</Chip>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  Aisyah · 5 thn 2 bln
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-primary-text">TK A Al-Fatih</span>
                </p>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {TILES.map((t) => (
                <div key={t.label} className="min-w-0 rounded-xl bg-card px-3 py-2 ring-1 ring-border">
                  <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.label}</p>
                  <p className={cn("mt-0.5 truncate text-base font-semibold leading-tight tabular-nums", t.mono && "font-currency", t.tone)}>{t.value}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.hint}</p>
                </div>
              ))}
            </div>

            <div className="mt-2.5 flex items-center gap-0.5 rounded-lg border border-border bg-card p-1">
              {GROUPS.map((g) => (
                <span
                  key={g}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2 py-1 text-xs",
                    g === ACTIVE_GROUP ? "bg-secondary font-semibold text-primary-text" : "text-muted-foreground",
                  )}
                >
                  {g}
                </span>
              ))}
            </div>

            <div className="mt-2.5 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <p className="border-b border-border px-3 py-1.5 text-sm font-semibold">Keuangan</p>
              <p className="px-3 pt-2 text-xs font-semibold">Tagihan</p>
              {INVOICES.map((inv) => (
                <div key={inv.title} className="border-b border-border/60 px-3 py-1.5 last:border-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-medium">{inv.title}</p>
                    <Chip tone={inv.tone}>{inv.status}</Chip>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {inv.due} · <span className="font-currency tabular-nums">{inv.amount}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[304px] top-[290px] w-[364px] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Cuti</p>
          <span className="text-xs text-muted-foreground">1 cuti aktif</span>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">Siswa tidak ditagih untuk bulan yang dicatat cuti.</p>
            <span className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground">
              <Plus className="size-3.5" />
              Catat cuti
            </span>
          </div>
          <div className="mt-2.5 rounded-xl border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">TK A Al-Fatih</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Des 2026 – Jan 2027 · 2026/2027</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">Pulang kampung ke Bandung</p>
              </div>
              <Chip tone="bg-status-present-subtle text-status-present-text">Aktif</Chip>
            </div>
          </div>
        </div>
      </Float>
    </Stage>
  );
}
