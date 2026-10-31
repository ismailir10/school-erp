import { ChevronDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminRail } from "./admin-rail";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

function Picker({ label, children, className }: { label: string; children: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="mb-1 text-small font-medium">{label}</p>
      <span className="flex h-8 items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-sm">
        <span className="truncate">{children}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </span>
    </div>
  );
}

/** Rapor editor: Triwulan and Kelas pickers, the narasi hint and "Pakai narasi", with the published state ("Terbit", "Unduh PDF") lifted over the corner. */
export function ReportCardMock() {
  return (
    <Stage label="report-card">
      <Browser url="/admin/report-cards" className="left-3 top-3 h-[392px] w-[640px]">
        <div className="flex h-[calc(100%-32px)]">
          <AdminRail active={2} />
          <div className="min-w-0 flex-1 overflow-hidden bg-background px-4 pt-3">
            <h1 className="text-h1 font-bold leading-tight tracking-tight">Rapor</h1>
            <div className="mb-2.5 mt-2 flex gap-3">
              <Picker label="Triwulan" className="w-52">Triwulan 1 · 2026/2027</Picker>
              <Picker label="Kelas" className="w-44">TK A Al-Fatih</Picker>
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-h2">Narasi Perkembangan</p>
                <p className="truncate text-small font-medium">Aisyah Putri</p>
              </div>

              <div className="mt-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">Nilai Agama &amp; Budi Pekerti</p>
                  <p className="truncate text-small text-muted-foreground">Saran: Mampu dan Konsisten (5K · 1BK · 0PP)</p>
                </div>
                <span className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-2 text-small">
                  Mampu dan Konsisten
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </span>
              </div>

              <div className="mt-1.5 h-12 rounded-lg border border-border bg-background px-2.5 py-1.5 text-body text-muted-foreground">
                Tulis narasi nilai agama &amp; budi pekerti…
              </div>
              <span className="mt-1.5 inline-flex h-7 items-center rounded-lg bg-muted px-2.5 text-[0.8rem] font-medium text-primary-text">Pakai narasi</span>
            </div>

            <div className="mt-3 flex gap-2">
              <span className="flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Simpan</span>
              <span className="flex h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium">Simpan &amp; Terbitkan</span>
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[388px] top-[352px] w-[280px] p-3.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 items-center rounded-4xl bg-status-present-subtle px-2 text-xs font-medium text-status-present-text">Terbit</span>
          <span className="text-small text-muted-foreground">31 Okt 2026</span>
        </div>
        <p className="mt-1.5 text-body font-semibold leading-snug">Rapor Aisyah Putri</p>
        <p className="text-small text-muted-foreground">Triwulan 1 · Semester 1 · 2026/2027</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium">
            <Download className="size-4" />
            Unduh PDF
          </span>
          <span className="flex h-8 items-center whitespace-nowrap rounded-lg bg-destructive-subtle px-2.5 text-sm font-medium text-destructive-text">Tarik penerbitan</span>
        </div>
      </Float>
    </Stage>
  );
}
