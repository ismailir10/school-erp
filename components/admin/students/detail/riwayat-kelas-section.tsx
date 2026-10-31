"use client";

import { GraduationCap } from "lucide-react";
import { DossierSubsection } from "@/components/admin/dossier-section";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateShort } from "@/lib/format";
import type { Enrollment } from "./types";
import { Badge } from "@/components/ui/badge";

/** "Riwayat Kelas" — every enrollment this student has ever held, newest
 * first (as the API returns it). Deliberately historical: unlike the header's
 * "current placement" pick, nothing here is filtered out. */
export function RiwayatKelasSection({
  enrollments,
  canEdit,
}: {
  enrollments: Enrollment[];
  canEdit: boolean;
}) {
  return (
    <DossierSubsection
      id="riwayat-kelas"
      label="Riwayat Kelas"
      badge={
        <Badge variant="neutral">
          {enrollments.length}
        </Badge>
      }
    >
      {enrollments.length === 0 ? (
        <EmptyState title="Belum terdaftar di kelas" description={canEdit ? "Daftarkan siswa ke kelas melalui tombol di atas." : undefined} />
      ) : (
        <div className="space-y-2">
          {enrollments.map((e) => (
            <div key={e.id} className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
              <div>
                <div className="flex items-center gap-2"><GraduationCap size={14} className="text-primary" aria-hidden="true" /><span className="text-sm font-medium">{e.classSection.name}</span></div>
                <p className="mt-0.5 text-xs text-muted-foreground">{e.classSection.program.name} · {e.classSection.academicYear.name} · {e.classSection.campus.name} · masuk {formatDateShort(e.enrollDate)}</p>
              </div>
              <StatusBadge status={e.status} />
            </div>
          ))}
        </div>
      )}
    </DossierSubsection>
  );
}
