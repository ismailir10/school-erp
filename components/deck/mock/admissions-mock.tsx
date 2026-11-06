import Image from "next/image";
import { ClipboardCheck, GraduationCap, LayoutDashboard, Plus, UserPlus, Users, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const STATS: { label: string; value: number; icon: LucideIcon; tone: string }[] = [
  { label: "Total", value: 4, icon: Users, tone: "bg-primary/10 text-primary" },
  { label: "Baru", value: 1, icon: UserPlus, tone: "bg-primary/10 text-primary" },
  { label: "Belum bayar", value: 1, icon: Wallet, tone: "bg-warning-subtle text-warning-text" },
  { label: "Formulir masuk", value: 1, icon: ClipboardCheck, tone: "bg-success-subtle text-success-text" },
];

// Stage chips and their tones are the real StatusBadge ones: Formulir masuk is amber, the one stage staff act on.
const BARU = "bg-status-leave-subtle text-status-leave-text";
const DIKIRIM = "bg-muted text-muted-foreground";
const MASUK = "bg-status-late-subtle text-status-late-text";
const SISWA = "bg-status-present-subtle text-status-present-text";

const ROWS: { child: string; meta: string; stage: string; tone: string; pay: string; action: string }[] = [
  { child: "Hafsa Nuraini", meta: "Bu Nur · 0812 0000 0001", stage: "Baru", tone: BARU, pay: "—", action: "Kirim Formulir" },
  { child: "Umar Faruq", meta: "Pak Faruq · 0812 0000 0002", stage: "Formulir masuk", tone: MASUK, pay: "Lunas", action: "Buka formulir" },
  { child: "Bilal Hafidz", meta: "Bu Dewi · 0812 0000 0003", stage: "Formulir dikirim", tone: DIKIRIM, pay: "Belum bayar", action: "Kirim ulang tautan" },
  { child: "Zaid Ahmad", meta: "Bu Sari · 0812 0000 0004", stage: "Siswa", tone: SISWA, pay: "Lunas", action: "Lihat siswa" },
];

const COLS = "grid grid-cols-[170px_122px_76px_1fr] items-center gap-2";

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5 w-fit items-center whitespace-nowrap rounded-full px-2 text-xs font-medium", tone)}>{children}</span>;
}

/** Pendaftaran: the admissions list with every stage on it, and the formulir that just came in lifted over it, ready to accept. */
export function AdmissionsMock() {
  return (
    <Stage label="admissions">
      <Browser url="/admin/admissions" className="left-3 top-3 h-[400px] w-[656px]">
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
              <div>
                <h1 className="text-h1 font-bold leading-tight tracking-tight">Pendaftaran</h1>
                <p className="text-xs text-muted-foreground">Dari pertanyaan pertama sampai jadi siswa.</p>
              </div>
              <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
                <Plus className="size-3.5" />
                Catat Pertanyaan
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {STATS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className={cn("rounded-xl bg-card px-3 py-2 ring-1 ring-border", i === 0 && "ring-primary/40")}>
                    <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <p className="font-currency text-xl font-bold leading-tight tabular-nums">{s.value}</p>
                      <span className={cn("grid size-6 shrink-0 place-items-center rounded-lg", s.tone)}>
                        <Icon className="size-3.5" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2.5 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className={cn(COLS, "bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground")}>
                <span>Anak</span>
                <span>Tahap</span>
                <span>Bayar</span>
                <span className="text-right">Aksi</span>
              </div>
              {ROWS.map((r) => (
                <div key={r.child} className={cn(COLS, "border-t border-border px-3 py-1")}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{r.child}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{r.meta}</p>
                  </div>
                  <Chip tone={r.tone}>{r.stage}</Chip>
                  <span className={cn("text-xs", r.pay === "Belum bayar" ? "text-status-late-text" : "text-muted-foreground")}>{r.pay}</span>
                  <span className="flex justify-end">
                    <span className="flex h-7 items-center whitespace-nowrap rounded-lg border border-border bg-background px-2 text-[11px] font-medium">{r.action}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[372px] top-[298px] w-[296px] p-0">
        <div className="flex items-start justify-between gap-2 px-4 pt-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">Umar Faruq</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">TK Islam Terpadu</p>
          </div>
          <Chip tone={MASUK}>Formulir masuk</Chip>
        </div>

        <div className="mx-4 mt-2.5 rounded-xl border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">Pembayaran pendaftaran</p>
            <Chip tone={SISWA}>Lunas</Chip>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="font-medium">Dibayar</dt>
            <dd className="text-right font-semibold tabular-nums">Rp 500.000</dd>
          </dl>
        </div>

        <div className="px-4 pb-3 pt-2.5">
          <div className="flex h-8 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            Terima &amp; Jadikan Siswa
          </div>
        </div>
      </Float>
    </Stage>
  );
}
