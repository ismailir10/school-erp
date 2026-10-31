"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Download, FileText, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/portal/page-header";
import { toast } from "sonner";
import { formatPeriodRange, periodMonthLabel, slipBanner, type SlipBanner } from "./helpers";

type SlipItem = {
  id: string;
  payrollRun: { periodStart: string; periodEnd: string; status: string };
};

/** "Last month's slip isn't out yet" notice. Rendered from two branches. */
function PendingSlipCard({ banner }: { banner: SlipBanner }) {
  return (
    <Card className="p-card border-dashed bg-muted/30">
      <div className="flex items-start gap-3">
        <Clock size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{banner.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{banner.description}</p>
        </div>
      </div>
    </Card>
  );
}

export default function TeacherSlipsPage() {
  const [slips, setSlips] = useState<SlipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadRequestId = useRef(0);

  const loadSlips = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setLoadError(false);

    try {
      const response = await fetch("/api/slips/my");
      if (!response.ok) throw new Error("Slip request failed");
      const data = await response.json();
      if (requestId !== loadRequestId.current) return;
      setSlips(data);
    } catch {
      if (requestId !== loadRequestId.current) return;
      setLoadError(true);
      toast.error("Slip gaji tidak bisa dimuat. Coba lagi sebentar ya.");
    } finally {
      if (requestId === loadRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlips();
  }, [loadSlips]);

  const banner = loading ? null : slipBanner(slips, new Date());

  return (
    <div>
      <PageHeader title="Slip gaji" />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        // Was a hand-rolled Card that imitated EmptyState — in a file that
        // already imports EmptyState eight lines below for the empty case.
        <div role="alert">
          <EmptyState
            icon={FileText}
            title="Slip gaji tidak bisa dimuat"
            description="Periksa koneksi, lalu coba lagi."
            actionLabel="Coba lagi"
            onAction={loadSlips}
          />
        </div>
      ) : slips.length === 0 && !banner ? (
        <EmptyState
          icon={FileText}
          title="Belum ada slip gaji"
          description="Slip akan muncul setelah penggajian disetujui admin."
        />
      ) : slips.length === 0 && banner ? (
        <div className="space-y-3">
          <PendingSlipCard banner={banner} />
          <EmptyState
            icon={FileText}
            title="Belum ada riwayat slip sebelumnya"
            description="Slip yang sudah disetujui akan muncul di sini."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {banner && <PendingSlipCard banner={banner} />}

          {slips.map((slip) => {
            const monthLabel = periodMonthLabel(slip.payrollRun.periodEnd);
            const rangeLabel = formatPeriodRange(slip.payrollRun.periodStart, slip.payrollRun.periodEnd);
            const periodLabel = `${monthLabel} (${rangeLabel})`;
            return (
              <Card key={slip.id} className="p-card transition-colors hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/teacher/slips/${slip.id}`}
                    prefetch={false}
                    className="flex-1 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                    aria-label={`Lihat slip ${periodLabel}`}
                  >
                    <p className="text-sm font-medium">{monthLabel}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <StatusBadge status="APPROVED" label="Tersedia" />
                    </div>
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    className="tap-target shrink-0"
                    onClick={() => window.open(`/api/slips/${slip.id}/pdf`, "_blank")}
                    aria-label={`Unduh PDF slip ${periodLabel} (buka di tab baru)`}
                  >
                    <Download size={14} className="mr-1" aria-hidden="true" /> PDF
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
