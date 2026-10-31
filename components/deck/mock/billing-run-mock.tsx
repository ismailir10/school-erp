import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminRail } from "./admin-rail";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const STEPS = [
  { step: 1, label: "Cakupan", status: "complete" },
  { step: 2, label: "Tinjau", status: "current" },
  { step: 3, label: "Komit", status: "upcoming" },
] as const;

type Row = { name: string; klass: string; amount?: string; skip?: string };

const ROWS: Row[] = [
  { name: "Aisyah Putri", klass: "TK A Al-Fatih · TK A", amount: "850.000" },
  { name: "Umar Faruq", klass: "TK A Al-Fatih · TK A", amount: "850.000" },
  { name: "Hafsa Nuraini", klass: "TK A Al-Fatih · TK A", amount: "850.000" },
  { name: "Bilal Hafidz", klass: "TK A Al-Fatih · TK A", skip: "Sedang cuti" },
];

const PREPAY = [
  { period: "November 2026", amount: "850.000" },
  { period: "Desember 2026", amount: "850.000" },
  { period: "Januari 2027", amount: "850.000" },
];

/** The stepper exactly as the wizard draws it: a check for done, a ringed number for now, a plain one for later. */
function Stepper() {
  return (
    <div className="flex items-start text-sm">
      {STEPS.map((s, i) => (
        <div key={s.step} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border font-medium",
                s.status === "complete" && "border-primary bg-primary text-primary-foreground",
                s.status === "current" && "border-primary text-primary",
                s.status === "upcoming" && "border-border text-muted-foreground",
              )}
            >
              {s.status === "complete" ? <Check size={12} /> : s.step}
            </span>
            <span className={cn("whitespace-nowrap font-medium", s.status === "upcoming" && "text-muted-foreground")}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <span className={cn("mx-3 h-px flex-1", s.status === "complete" ? "bg-primary" : "bg-border")} />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-small font-medium">{label}</p>
      <span className="flex h-8 items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-sm">
        <span className="truncate">{children}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </span>
    </div>
  );
}

/** Buat Tagihan, the Tinjau step with one child skipped for leave, beside the "Catat pembayaran di muka" dialog that ends in Lunas. */
export function BillingRunMock() {
  return (
    <Stage label="billing-run">
      <Browser url="/admin/invoices" className="left-3 top-3 h-[476px] w-[410px]">
        <div className="flex h-[calc(100%-32px)]">
          <AdminRail active={3} />
          <div className="relative min-w-0 flex-1 overflow-hidden bg-background">
            <div className="space-y-2 px-3 pt-3 opacity-60">
              <div className="h-5 w-24 rounded bg-foreground/15" />
              <div className="h-14 rounded-lg border border-border bg-card" />
              <div className="h-14 rounded-lg border border-border bg-card" />
            </div>
            <div className="absolute inset-0 bg-foreground/30" />

            <div className="absolute left-2.5 top-3 w-[322px] rounded-xl border border-border bg-card p-3.5 shadow-card-elevated">
              <p className="text-base font-semibold leading-tight">Buat Tagihan (Wizard)</p>
              <p className="mb-2.5 mt-0.5 text-small text-muted-foreground">Tinjau baris tagihan per siswa sebelum dikomit.</p>
              <Stepper />

              <ul className="mt-3 space-y-1.5">
                {ROWS.map((r) => (
                  <li key={r.name} className={cn("rounded-lg border p-2", r.skip ? "border-dashed bg-muted/30" : "bg-card")}>
                    <div className="flex items-center gap-2">
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      <div className={cn("min-w-0 flex-1", r.skip && "opacity-60")}>
                        <p className="truncate text-body font-medium">{r.name}</p>
                        <p className="truncate text-small text-muted-foreground">{r.klass}</p>
                      </div>
                      {r.skip ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{r.skip}</span>
                      ) : (
                        <>
                          <span className="shrink-0 font-currency text-body font-medium tabular-nums">Rp {r.amount}</span>
                          <span className="flex h-[18px] w-8 shrink-0 items-center justify-end rounded-full bg-primary p-[2px]">
                            <span className="size-3.5 rounded-full bg-background" />
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-2.5">
                <span className="flex h-8 items-center rounded-lg px-2.5 text-sm font-medium">Tutup</span>
                <span className="flex h-8 items-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">Lanjutkan</span>
              </div>
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[398px] top-[56px] w-[270px] p-3.5">
        <p className="text-base font-semibold leading-tight">Catat Pembayaran di Muka</p>
        <p className="mb-2.5 mt-0.5 text-small text-muted-foreground">Tagihan langsung Lunas, tanpa link pembayaran.</p>

        <Field label="Siswa">Aisyah Putri</Field>
        <div className="mt-2 flex gap-2">
          <Field label="Dari bulan">Nov 2026</Field>
          <Field label="Sampai bulan">Jan 2027</Field>
        </div>

        <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
          {PREPAY.map((m) => (
            <div key={m.period} className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-small">
              <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-primary text-primary-foreground">
                <Check size={11} strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1 truncate">SPP {m.period}</span>
              <span className="font-currency tabular-nums">Rp {m.amount}</span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-muted/50 px-2.5 py-1.5 text-small font-semibold">
            <span>Total</span>
            <span className="font-currency tabular-nums">Rp 2.550.000</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg bg-primary px-2 text-sm font-medium text-primary-foreground">
            <span className="truncate">Catat Rp 2.550.000 lunas</span>
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-small text-muted-foreground">
          <span className="inline-flex items-center rounded-full border border-status-present/40 bg-status-present-subtle px-2 py-0.5 text-xs font-medium text-status-present-text">Lunas</span>
          3 tagihan SPP, tanpa link
        </div>
      </Float>
    </Stage>
  );
}
