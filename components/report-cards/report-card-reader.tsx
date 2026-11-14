"use client";

import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ParentReportCard } from "@/lib/parent-helpers";
import { formatMeasurement } from "@/lib/raport/build";
import { LEVEL_CHIP_CLASS_OFF } from "@/lib/curriculum/level-presentation";

/** Shared parent reader and admin preview. Header stays outside the bounded
 * scroll area; deliberate heading focus prevents jumping to the final PDF link.
 * Visual reference: design-system.html overlays. */
export function ReportCardReader({ card, childName, onClose, pdfUrl, preview = false }: {
  card: ParentReportCard;
  childName?: string;
  onClose: () => void;
  pdfUrl?: string;
  preview?: boolean;
}) {
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        initialFocus={titleRef}
        className="gap-0 overflow-hidden p-0 data-[side=bottom]:h-[95dvh] data-[side=bottom]:max-h-[95dvh] data-[side=bottom]:rounded-t-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="shrink-0 border-b p-card pr-14">
          <SheetTitle ref={titleRef} tabIndex={-1} className="[overflow-wrap:anywhere] focus-visible:focus-outline">
            {preview ? "Pratinjau rapor" : "Rapor"}{childName ? ` — ${childName}` : ""}
          </SheetTitle>
          <SheetDescription>{card.period}</SheetDescription>
          {preview ? <p className="text-small text-muted-foreground">Menampilkan isian saat ini. Pratinjau ini belum menyimpan atau menerbitkan perubahan.</p> : null}
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
          <ReportCardDetail card={card} pdfUrl={pdfUrl} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function ReportCardDetail({ card, pdfUrl }: { card: ParentReportCard; pdfUrl?: string }) {
  // Hide structurally-empty sections (no level + no narrative) so the parent
  // sees only what the Ustadzah actually wrote.
  const sections = card.sections.filter((s) => s.level || s.narrative.trim());

  return (
    <>
      <div className="space-y-8 p-card [overflow-wrap:anywhere]">
        {sections.length > 0 ? (
          sections.map((sec) => (
            <div key={sec.label}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-h2 text-foreground">{sec.label}</h3>
                {sec.level ? (
                  <Badge
                    variant="outline"
                    className={
                      sec.levelKey
                        ? LEVEL_CHIP_CLASS_OFF[sec.levelKey]
                        : "bg-primary/10 text-primary-text border-primary/20"
                    }
                  >
                    {sec.level}
                  </Badge>
                ) : null}
              </div>
              {sec.narrative.trim() ? (
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                  {sec.narrative}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Narasi rapor belum tersedia.
          </p>
        )}

        {/* Kehadiran */}
        <div>
          <h3 className="text-h2 text-foreground mb-3">Kehadiran</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <AttCell label="Sakit" value={card.attendance.sick} />
            <AttCell label="Izin" value={card.attendance.permitted} />
            <AttCell label="Alpa" value={card.attendance.unexcused} />
            <AttCell label="Hari sekolah" value={card.attendance.total} />
          </div>
        </div>

        {/* Pertumbuhan */}
        {card.height || card.weight ? (
          <div>
            <h3 className="text-h2 text-foreground mb-3">Pertumbuhan</h3>
            <p className="text-sm text-foreground">
              {card.height ? `Tinggi: ${formatMeasurement(card.height)} cm` : ""}
              {card.height && card.weight ? "   ·   " : ""}
              {card.weight ? `Berat: ${formatMeasurement(card.weight)} kg` : ""}
            </p>
          </div>
        ) : null}

        {/* Hafalan */}
        {card.hafalan && card.hafalan.trim() ? (
          <div>
            <h3 className="text-h2 text-foreground mb-3">Hafalan</h3>
            <p className="text-sm text-foreground whitespace-pre-wrap">{card.hafalan}</p>
          </div>
        ) : null}

        {pdfUrl ? <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            window.open(pdfUrl, "_blank")
          }
        >
          <Download size={16} className="mr-2" />
          Unduh PDF
        </Button> : null}
      </div>
    </>
  );
}

function AttCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-center">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
