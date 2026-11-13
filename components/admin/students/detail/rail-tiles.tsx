import { BookOpen, CalendarCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { RailTile } from "@/components/admin/detail-rail";
import type { StudentOverview } from "@/lib/student/overview";

const muted = (text: string): ReactNode => <span className="text-muted-foreground">{text}</span>;

/** Keep report and attendance context alongside the dossier sections. */
export function buildRailTiles({
  overviewError,
  attendanceCounts,
  raportTally,
}: {
  overviewError: boolean;
  attendanceCounts: StudentOverview["attendance"]["counts"] | null;
  raportTally: StudentOverview["raport"] | null;
}): RailTile[] {
  return [
    {
      label: "Hadir bulan ini",
      icon: CalendarCheck,
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
      icon: BookOpen,
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
