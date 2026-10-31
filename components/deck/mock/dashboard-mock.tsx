import Image from "next/image";
import { ArrowRight, ClipboardCheck, GraduationCap, LayoutDashboard, TriangleAlert, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const RAIL = [
  { icon: LayoutDashboard, active: true },
  { icon: GraduationCap },
  { icon: ClipboardCheck },
  { icon: Wallet },
  { icon: Users },
];

const QUEUE = [
  { label: "Pertanyaan pendaftaran baru", value: 2 },
  { label: "Formulir menunggu tinjauan", value: 3 },
  { label: "Pengajuan cuti menunggu", value: 1 },
  { label: "Link pembayaran belum tersedia", value: 1 },
  { label: "Draf penggajian", value: 0 },
];

const URGENT = [
  { title: "Tinjau draf penggajian", detail: "21 Okt 2026–20 Nov 2026", action: "Tinjau draf" },
  { title: "Tindak lanjuti pertanyaan Ananda Calon", detail: "Dari Bapak Calon Wali · masuk 30 Okt 2026", action: "Buka pendaftaran" },
];

// 30 days of attendance, in percent. The two dips are the Fridays the school closes early.
const DAYS = [92, 94, 91, 95, 93, 90, 94, 96, 93, 91, 88, 94, 95, 92, 90, 93, 96, 94, 89, 92, 95, 93, 91, 94, 87, 93, 95, 92, 90, 89];

/** A tile as the dashboard draws it: tiny uppercase label over a bold mono figure. */
function Tile({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border bg-card px-2.5 py-2", className)}>
      <p className="text-[0.58rem] font-semibold uppercase leading-[1.15] tracking-wider text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** Admin dashboard: the "Perlu ditangani" queue and finance tiles, with the Analitik attendance card lifted over the corner. */
export function DashboardMock() {
  return (
    <Stage label="dashboard">
      <Browser url="/admin" className="left-3 top-3 h-[380px] w-[640px]">
        <div className="flex h-[calc(100%-32px)]">
          <div className="flex w-11 shrink-0 flex-col items-center gap-2 bg-sidebar py-3">
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

          <div className="min-w-0 flex-1 overflow-hidden bg-background">
            <div className="px-4 pt-3.5">
              <p className="text-xs text-muted-foreground">Dasbor</p>
              <div className="mb-2.5 mt-1 flex items-baseline justify-between gap-3">
                <h1 className="text-h1 font-bold leading-tight tracking-tight">Perlu ditangani</h1>
                <p className="shrink-0 text-xs text-muted-foreground">Sabtu, 31 Oktober 2026</p>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {QUEUE.map((q) => (
                  <Tile key={q.label} label={q.label}>
                    <p className="mt-1 font-currency text-xl font-bold leading-tight tabular-nums">{q.value}</p>
                  </Tile>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Tile label="Tagihan lewat tempo">
                  <p className="font-currency text-base font-bold leading-tight tabular-nums">7</p>
                </Tile>
                <Tile label="Piutang (belum dibayar)">
                  <p className="whitespace-nowrap font-currency text-base font-bold leading-tight tabular-nums">Rp 24.850.000</p>
                </Tile>
              </div>

              <div className="mt-2 overflow-hidden rounded-xl bg-card ring-1 ring-border">
                <p className="px-3.5 pb-1 pt-2 text-sm font-semibold">Perlu perhatian</p>
                <div className="space-y-2 px-3.5 pb-2.5">
                  {URGENT.map((u) => (
                    <div key={u.title} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{u.title}</p>
                        <p className="truncate text-[0.65rem] text-muted-foreground">{u.detail}</p>
                      </div>
                      <span className="flex h-6 shrink-0 items-center rounded-lg border border-border bg-background px-2 text-[0.7rem] font-medium">{u.action}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1 border-t border-border bg-muted/50 px-3.5 py-1.5 text-[0.7rem] font-medium text-primary-text">
                  Lihat semua (7)
                  <ArrowRight className="size-3" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[388px] top-[340px] w-[280px] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-semibold leading-tight">Kehadiran siswa</p>
            <p className="mt-0.5 text-xs text-muted-foreground">30 hari terakhir</p>
          </div>
          <p className="font-currency text-xl font-bold leading-none tabular-nums">89%</p>
        </div>
        <div className="mt-2.5 flex h-10 items-end gap-[3px]">
          {DAYS.map((d, i) => (
            <span
              key={i}
              className={cn("flex-1 rounded-[2px]", d < 90 ? "bg-status-late" : "bg-status-present/70")}
              style={{ height: `${((d - 80) / 20) * 100}%` }}
            />
          ))}
        </div>
        <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning-subtle px-2.5 py-1 text-xs font-medium text-warning-text">
          <TriangleAlert className="size-3.5" />
          Kelas perlu perhatian
        </span>
      </Float>
    </Stage>
  );
}
