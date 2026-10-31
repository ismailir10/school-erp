import { Building2, CalendarDays, CheckCircle2, Download, ExternalLink, FileText, Home, MoreHorizontal, Receipt, BookHeart } from "lucide-react";
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

/** Same figure treatment as the portal's Amount: a small muted "Rp" and a tabular number. */
function Amount({ digits, size, className }: { digits: string; size: "display" | "line"; className?: string }) {
  return (
    <span
      className={cn(
        "font-amount whitespace-nowrap",
        size === "display" ? "text-[1.75rem] font-semibold leading-tight" : "text-sm font-medium leading-snug",
        className,
      )}
    >
      <span className={cn("mr-1 font-medium text-muted-foreground", size === "display" ? "text-[1.0625rem]" : "text-[0.6875rem]")}>Rp</span>
      {digits}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** Parent invoice detail with its pay button, beside the "Lunas" receipt moment that follows. */
export function ParentInvoiceMock() {
  return (
    <Stage label="parent-invoice">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <div className="border-b border-border px-4 pb-2.5 pt-3">
            <p className="truncate text-sm font-medium">
              SPP November 2026<span className="ml-1 text-muted-foreground">· Aisyah Putri</span>
            </p>
            <p className="text-xs text-muted-foreground">INV/2026/11/0042</p>
          </div>

          <div className="space-y-3.5 px-4 pt-3.5">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-0.5 text-xs font-medium text-muted-foreground">Sisa tagihan</p>
              <Amount digits="850.000" size="display" />
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Belum dibayar
                </span>
                <span>
                  Jatuh tempo <b className="text-foreground">10 November 2026</b>
                </span>
              </div>
            </div>

            <dl className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Total tagihan</dt>
                <dd>
                  <Amount digits="850.000" size="line" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Sudah dibayar</dt>
                <dd>
                  <Amount digits="0" size="line" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
                <dt className="font-medium">Sisa tagihan</dt>
                <dd>
                  <Amount digits="850.000" size="line" />
                </dd>
              </div>
            </dl>

            <div>
              <SectionLabel>Cara bayar</SectionLabel>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Building2 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">Transfer bank (Virtual Account)</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">BCA · Mandiri · BRI · BNI · Permata · CIMB</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-background px-4 py-2.5">
          <div className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground">
            <ExternalLink size={16} />
            Bayar sekarang
          </div>
        </div>
        <BottomNav items={NAV} active="Tagihan" />
      </Phone>

      <Float className="left-[392px] top-[150px] w-[264px] space-y-3.5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-status-present-subtle text-status-present-text">
            <CheckCircle2 size={22} />
          </div>
          <div className="min-w-0">
            <span className="inline-flex items-center rounded-full border border-status-present/40 bg-status-present-subtle px-2 py-0.5 text-xs font-medium text-status-present-text">
              Lunas
            </span>
            <p className="mt-1 text-xs text-muted-foreground">Dibayar 4 November 2026</p>
          </div>
        </div>
        <p className="text-body font-medium leading-snug">Alhamdulillah, tagihan SPP November terbayar.</p>
        <div>
          <SectionLabel>Bukti pembayaran</SectionLabel>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <FileText size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Kuitansi.pdf</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Diterbitkan 4 November 2026</p>
            </div>
            <Download size={16} className="shrink-0 text-muted-foreground" />
          </div>
        </div>
      </Float>
    </Stage>
  );
}
