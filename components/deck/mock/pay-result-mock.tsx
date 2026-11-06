import { BookHeart, CalendarDays, Home, Info, MoreHorizontal, Receipt, RefreshCw, ExternalLink } from "lucide-react";
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

/** Back from the payment page: the invoice still open, with the "sedang diperiksa" note and its refresh button, beside the new-link escape hatch. */
export function PayResultMock() {
  return (
    <Stage label="pay-result">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <div className="border-b border-border px-4 py-2">
            <p className="truncate text-sm font-medium">
              SPP November 2026<span className="ml-1 text-muted-foreground">· Aisyah Putri</span>
            </p>
          </div>

          <div className="space-y-3 px-4 pt-3">
            <div className="rounded-xl border border-border bg-card px-4 py-2">
              <p className="text-xs font-medium text-muted-foreground">Sisa tagihan</p>
              <div className="flex items-center justify-between gap-2">
                <Amount digits="850.000" size="display" />
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Belum dibayar
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Jatuh tempo <b className="text-foreground">10 November 2026</b>
              </p>
            </div>

            <dl className="space-y-1 border-t border-border pt-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Total tagihan</dt>
                <dd>
                  <Amount digits="850.000" size="line" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="font-medium">Sisa tagihan</dt>
                <dd>
                  <Amount digits="850.000" size="line" />
                </dd>
              </div>
            </dl>

            <div className="space-y-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>Pembayaran sedang diperiksa. Status akan diperbarui otomatis — tidak perlu bayar lagi.</span>
              </div>
              <div className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium text-foreground">
                <RefreshCw size={16} />
                Muat ulang status
              </div>
            </div>
          </div>
        </div>
        <BottomNav items={NAV} active="Tagihan" />
      </Phone>

      <Float className="left-[380px] top-[170px] w-[284px] space-y-2">
        <div className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground">
          <ExternalLink size={16} />
          Bayar sekarang
        </div>
        <div className="flex h-10 w-full items-center justify-center rounded-lg text-xs font-medium text-muted-foreground">
          Link tidak bisa dibuka? Minta link baru
        </div>
      </Float>
    </Stage>
  );
}
