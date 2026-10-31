import Image from "next/image";
import { ArrowUpRight, ChevronDown, ClipboardCheck, GraduationCap, LayoutDashboard, Plus, Users, Wallet } from "lucide-react";
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

const ROWS: { name: string; program: string; teacher: string; selected?: boolean }[] = [
  { name: "TK A Al-Fatih", program: "TK Islam Terpadu", teacher: "Bu Guru Rina" },
  { name: "TK B Al-Hikmah", program: "TK Islam Terpadu", teacher: "Bu Guru Sari" },
  { name: "KB Melati", program: "Day Care", teacher: "Bu Guru Dewi", selected: true },
  { name: "Pop Up Sabtu", program: "Pop Up Class", teacher: "Bu Guru Aini" },
];

const COLS = "grid grid-cols-[96px_112px_1fr] items-center gap-2";

/** Kelas: the class list with its program column, and the Ubah Kelas preview that shows the old and new SPP before a program change is saved. */
export function ClassesMock() {
  return (
    <Stage label="classes">
      <Browser url="/admin/classes" className="left-3 top-3 h-[400px] w-[656px]">
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
                <h1 className="text-h1 font-bold leading-tight tracking-tight">Kelas</h1>
                <p className="text-xs text-muted-foreground">Daftar kelas per tahun ajaran.</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium">
                  <ArrowUpRight className="size-3.5" />
                  Naik Kelas Massal
                </span>
                <span className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground">
                  <Plus className="size-3.5" />
                  Tambah Kelas
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <span className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs">
                2026/2027 · Aktif
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </span>
              <span className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs">
                Semua Program
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </span>
            </div>

            <div className="mt-2.5 overflow-hidden rounded-xl bg-card ring-1 ring-border">
              <div className={cn(COLS, "bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground")}>
                <span>Nama</span>
                <span>Program</span>
                <span>Wali Kelas</span>
              </div>
              {ROWS.map((r) => (
                <div key={r.name} className={cn(COLS, "border-t border-border px-3 py-2", r.selected && "bg-secondary/60")}>
                  <span className="truncate text-xs font-medium">{r.name}</span>
                  <span className="truncate text-xs">{r.program}</span>
                  <span className="truncate text-xs">{r.teacher}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[384px] top-[212px] w-[284px] p-0">
        <div className="border-b border-border px-4 py-2.5">
          <p className="text-base font-semibold leading-tight">Ubah Kelas</p>
          <p className="mt-0.5 text-xs text-muted-foreground">KB Melati · 2026/2027</p>
        </div>
        <div className="space-y-2 px-4 py-2.5">
          <div>
            <p className="mb-1 text-xs font-medium">Program</p>
            <span className="flex h-8 items-center justify-between rounded-lg border border-border bg-background px-2.5 text-sm">
              Kelompok Bermain
              <ChevronDown className="size-4 text-muted-foreground" />
            </span>
          </div>
          <div className="rounded-lg border border-border bg-card px-2.5 py-2 text-xs">
            <p className="text-muted-foreground">
              Tagihan rutin per periode berubah dari <span className="whitespace-nowrap font-currency font-semibold text-foreground">Rp 1.100.000</span> ke{" "}
              <span className="whitespace-nowrap font-currency font-semibold text-foreground">Rp 650.000</span> untuk 15 siswa aktif. Draf tagihan yang sudah dibuat perlu dibuat ulang.
            </p>
          </div>
          <div className="flex justify-end gap-1.5 pt-0.5">
            <span className="flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium">Batal</span>
            <span className="flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Simpan</span>
          </div>
        </div>
      </Float>
    </Stage>
  );
}
