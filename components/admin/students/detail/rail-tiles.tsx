import type { ReactNode } from "react";
import type { RailTile } from "@/components/admin/detail-rail";
import { formatDateShort, formatRupiah } from "@/lib/format";
import type { StudentInvoiceSummary } from "@/lib/finance/student-invoice-summary";
import type { StudentOverview } from "@/lib/student/overview";

const muted = (text: string): ReactNode => <span className="text-muted-foreground">{text}</span>;

/**
 * The three numbers the header and the strip do not already say: Tunggakan,
 * Hadir bulan ini and Rapor. Each distinguishes "still loading" (Memuat…) from
 * "could not load" and "nothing yet" (a dash), and never shows a bare 0 for a
 * request that has not answered — an admin would read it as a real answer.
 */
export function buildRailTiles({
  invoices,
  overviewError,
  attendanceCounts,
  raportTally,
}: {
  invoices: { loading: boolean; error: boolean; summary: StudentInvoiceSummary };
  overviewError: boolean;
  attendanceCounts: StudentOverview["attendance"]["counts"] | null;
  raportTally: StudentOverview["raport"] | null;
}): RailTile[] {
  const { loading, error, summary } = invoices;
  return [
    {
      label: "Tunggakan",
      wide: true,
      value: loading ? (
        muted("Memuat…")
      ) : error ? (
        muted("—")
      ) : (
        <span className="font-currency">{formatRupiah(summary.outstanding)}</span>
      ),
      tone: summary.outstanding > 0 ? "critical" : "positive",
      hint:
        loading || error
          ? undefined
          : summary.unpaidCount > 0
            ? `${summary.unpaidCount} tagihan belum lunas${
                summary.nearestDue ? ` · ${formatDateShort(summary.nearestDue)}` : ""
              }`
            : "Lunas semua",
    },
    {
      label: "Hadir bulan ini",
      value: overviewError
        ? muted("—")
        : !attendanceCounts
          ? muted("Memuat…")
          : attendanceCounts.total === 0
            ? muted("—")
            : `${attendanceCounts.present}/${attendanceCounts.total}`,
      tone: attendanceCounts && attendanceCounts.total > 0 && attendanceCounts.absent > 0 ? "warning" : "default",
      hint:
        !attendanceCounts || overviewError
          ? undefined
          : attendanceCounts.total === 0
            ? "Belum ada absensi bulan ini"
            : [
                attendanceCounts.absent > 0 ? `${attendanceCounts.absent} alpa` : null,
                attendanceCounts.sick > 0 ? `${attendanceCounts.sick} sakit` : null,
                attendanceCounts.permission > 0 ? `${attendanceCounts.permission} izin` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Hadir penuh",
    },
    {
      label: "Rapor",
      value: overviewError
        ? muted("—")
        : !raportTally
          ? muted("Memuat…")
          : raportTally.total === 0
            ? muted("—")
            : `${raportTally.published}/${raportTally.total}`,
      tone: "default",
      hint:
        !raportTally || overviewError
          ? undefined
          : raportTally.total === 0
            ? "Triwulan belum dibuat"
            : raportTally.draft > 0
              ? `${raportTally.draft} draf`
              : raportTally.published === 0
                ? // With 0 published and 0 draft "terbit" would read as though a raport had been issued.
                  "Belum ada rapor"
                : "semua terbit",
    },
  ];
}
