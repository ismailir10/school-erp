import { ChevronDown, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminRail } from "./admin-rail";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const TABS = ["Komponen Biaya", "Tarif per Program", "Keringanan Siswa"];

const TARIF = [
  { label: "SPP Bulanan", code: "spp", amount: "850.000" },
];

function SelectBox({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("flex h-8 items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-sm", className)}>
      {children}
      <ChevronDown className="size-4 text-muted-foreground" />
    </span>
  );
}

/** Biaya, Tarif per Program tab, with the "Harga paket sekolah + daycare" section lifted over the corner. */
export function FeesMock() {
  return (
    <Stage label="fees">
      <Browser url="/admin/fees" className="left-3 top-3 h-[330px] w-[640px]">
        <div className="flex h-[calc(100%-32px)]">
          <AdminRail active={3} />
          <div className="min-w-0 flex-1 overflow-hidden bg-background px-4 pt-3">
            <h1 className="text-h1 font-bold leading-tight tracking-tight">Biaya</h1>
            <p className="mb-2.5 text-small text-muted-foreground">Daftar komponen → tarif per program → keringanan per siswa.</p>

            <div className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px]">
              {TABS.map((t, i) => (
                <span
                  key={t}
                  className={cn("rounded-md px-2.5 py-0.5 text-sm font-medium", i === 1 ? "bg-background text-foreground shadow-sm" : "text-foreground/60")}
                >
                  {t}
                </span>
              ))}
            </div>

            <div className="mt-2.5 flex gap-2">
              <SelectBox className="w-44">TK A</SelectBox>
              <SelectBox className="w-44">2026/2027</SelectBox>
            </div>

            <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card">
              <div className="grid grid-cols-[1fr_130px] border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Komponen</span>
                <span className="text-right">Tarif</span>
              </div>
              {TARIF.map((r) => (
                <div key={r.code} className="grid grid-cols-[1fr_130px] items-center border-b border-border px-3 py-1 last:border-0">
                  <p className="text-sm">
                    {r.label}
                    <span className="ml-1.5 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.7rem]">{r.code}</span>
                  </p>
                  <span className="flex h-6 items-center justify-end rounded-lg border border-border bg-background px-2 font-currency text-sm tabular-nums">
                    <span className="mr-1 text-muted-foreground">Rp</span>
                    {r.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[176px] top-[268px] w-[492px] p-3.5">
        <p className="text-h2">Harga paket sekolah + daycare</p>
        <p className="mb-1.5 mt-0.5 text-small text-muted-foreground">
          Isi kalau anak yang ikut sekolah dan daycare ditagih satu harga paket.
        </p>
        <p className="mb-1 text-small font-medium">Daycare: Day Care</p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[112px_100px_1fr_116px] whitespace-nowrap gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <span>Program sekolah</span>
            <span>Komponen</span>
            <span className="text-right">Jumlah biasa</span>
            <span className="text-right">Harga paket</span>
          </div>
          <div className="grid grid-cols-[112px_100px_1fr_116px] whitespace-nowrap items-center gap-2 px-3 py-1.5">
            <span className="text-sm font-medium">TK A</span>
            <span className="whitespace-nowrap text-sm">SPP Bulanan</span>
            <span className="text-right font-currency text-sm tabular-nums text-muted-foreground">Rp 1.350.000</span>
            <span className="flex h-6 items-center justify-end rounded-lg border border-primary bg-background px-2 font-currency text-sm font-medium tabular-nums ring-2 ring-primary/20">
              <span className="mr-1 text-muted-foreground">Rp</span>
              1.200.000
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-end gap-3">
          <span className="text-small text-muted-foreground">Ada perubahan belum disimpan</span>
          <span className="flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground">
            <Save className="size-3.5" />
            Simpan harga paket
          </span>
        </div>
      </Float>
    </Stage>
  );
}
