import { Link as LinkIcon, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminRail } from "./admin-rail";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const CHIPS = [
  { label: "Belum lunas (98)" },
  { label: "Lewat Tempo (23)" },
  { label: "Perlu link (92)" },
  { label: "Perlu dicek (2)" },
  { label: "Lunas (203)" },
];

const BADGE = {
  sent: { label: "Link Dibuat", className: "bg-status-leave-subtle text-status-leave-text" },
  overdue: { label: "Lewat Tempo", className: "bg-status-absent-subtle text-status-absent-text" },
  paid: { label: "Lunas", className: "bg-status-present-subtle text-status-present-text" },
};

type Row = { name: string; no: string; period: string; amount: string; status: keyof typeof BADGE; link: string; expired?: boolean };

const ROWS: Row[] = [
  { name: "Aisyah Putri", no: "INV-2026-1002", period: "Oktober 2026", amount: "850.000", status: "sent", link: "5 Nov 2026 · 09.00 WIB" },
  { name: "Umar Faruq", no: "INV-2026-1003", period: "Oktober 2026", amount: "850.000", status: "overdue", link: "Kedaluwarsa", expired: true },
];

/** Same chip as the app's StatusBadge: pill, 12px, the status family's subtle tint. */
function Badge({ status }: { status: keyof typeof BADGE }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap", BADGE[status].className)}>
      {BADGE[status].label}
    </span>
  );
}

function HeaderButton({ icon: Icon, children, primary }: { icon?: typeof LinkIcon; children: string; primary?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-[0.8rem] font-medium",
        primary ? "bg-primary text-primary-foreground" : "border border-border bg-background text-foreground",
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  );
}

/** Tagihan list with its payment-link column and status filters, and the WhatsApp reminder queue lifted over the corner. */
export function InvoicesMock() {
  return (
    <Stage label="invoices">
      <Browser url="/admin/invoices" className="left-3 top-3 h-[330px] w-[656px]">
        <div className="flex h-[calc(100%-32px)]">
          <AdminRail active={3} />
          <div className="min-w-0 flex-1 overflow-hidden bg-background px-3.5 pt-3">
            <div className="flex items-center justify-between gap-2">
              <div className="shrink-0">
                <h1 className="text-h1 font-bold leading-tight tracking-tight">Tagihan</h1>
                <p className="text-small text-muted-foreground">310 tagihan</p>
              </div>
              <div className="flex min-w-0 gap-1.5">
                <HeaderButton icon={LinkIcon}>Buat link baru (91)</HeaderButton>
                <HeaderButton icon={MessageCircle}>Pengingat WhatsApp</HeaderButton>
                <HeaderButton primary>Buat Tagihan</HeaderButton>
              </div>
            </div>

            <div className="mt-2.5 flex gap-1.5">
              {CHIPS.map((c, i) => (
                <span
                  key={c.label}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                    i === 0 ? "border-primary/40 bg-primary/10 text-primary-text" : "border-border bg-background text-muted-foreground",
                  )}
                >
                  {c.label}
                </span>
              ))}
            </div>

            <div className="mt-2.5 overflow-hidden rounded-lg border border-border bg-card">
              <div className="grid grid-cols-[104px_96px_88px_92px_1fr] gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <span>Siswa</span>
                <span>Periode</span>
                <span className="text-right">Jumlah</span>
                <span>Status</span>
                <span>Link berlaku</span>
              </div>
              {ROWS.map((r) => (
                <div key={r.no} className="grid grid-cols-[104px_96px_88px_92px_1fr] items-center gap-2 border-b border-border px-3 py-1 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-small font-medium">{r.name}</p>
                    <p className="truncate font-mono text-[0.7rem] text-muted-foreground">{r.no}</p>
                  </div>
                  <span className="truncate text-small">{r.period}</span>
                  <span className="whitespace-nowrap text-right font-currency text-small font-medium tabular-nums">Rp {r.amount}</span>
                  <span>
                    <Badge status={r.status} />
                  </span>
                  <span className={cn("truncate text-small", r.expired ? "font-medium text-destructive-text" : "text-muted-foreground")}>{r.link}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[150px] top-[267px] w-[518px] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">Pengingat WhatsApp</p>
            <p className="mt-0.5 text-small text-muted-foreground">Satu ketukan per keluarga. Anda yang menekan kirim.</p>
          </div>
          <p className="shrink-0 text-small text-muted-foreground">12 tagihan di antrean</p>
        </div>

        <div className="mt-2 flex items-center gap-3 rounded-lg border border-border p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-body font-medium">Aisyah Putri</p>
              <Badge status="sent" />
            </div>
            <p className="truncate text-small text-muted-foreground">Oktober 2026 · Wali: Bu Nur</p>
            <p className="text-small">
              <span className="text-muted-foreground">Sisa </span>
              <span className="font-currency font-medium tabular-nums">Rp 850.000</span>
              <span className="text-muted-foreground"> · Belum diingatkan</span>
            </p>
          </div>
          <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground">
            <MessageCircle className="size-4" />
            Buka WhatsApp
          </span>
        </div>

        <div className="mt-2 rounded-xl rounded-tl-sm bg-status-present-subtle px-3 py-1.5 text-small leading-snug">
          <p>Assalamu&apos;alaikum Bu Nur.</p>
          <p className="mt-1">
            Tagihan Oktober 2026 untuk ananda Aisyah Putri (INV-2026-1002) masih tersisa Rp 850.000. Bisa dibayar lewat tautan:{" "}
            <span className="font-medium text-info-text underline">doku.com/pay/aisyah-okt</span>
          </p>
        </div>
      </Float>
    </Stage>
  );
}
