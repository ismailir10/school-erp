"use client";

import { DossierSubsection } from "@/components/admin/dossier-section";
import { formatDateShort } from "@/lib/format";
import { SECTION_KELAS_SAAT_INI } from "./sections";
import type { Enrollment } from "./types";

/**
 * "Kelas saat ini" — the first block of Kelas & Akademik. It carries what the
 * old Ringkasan rail card said about placement (class, school year, campus,
 * since when) next to the academic detail it belongs with. `enrollments` is the
 * page's current-placement list, primary (school) placement first; a day-care
 * or second placement follows as its own row, named by its programme.
 */
export function KelasSaatIniSection({
  enrollments,
  joinedDate,
}: {
  enrollments: Enrollment[];
  /** Earliest enrolment date (`YYYY-MM-DD`): when the child actually joined the school. */
  joinedDate: string | null;
}) {
  const [primary, ...others] = enrollments;
  return (
    <DossierSubsection id={SECTION_KELAS_SAAT_INI} label="Kelas saat ini">
      {!primary ? (
        <p className="text-sm text-muted-foreground">Belum terdaftar di kelas</p>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Fact label="Kelas" value={`${primary.classSection.program.name} · ${primary.classSection.name}`} />
          <Fact label="Tahun ajaran" value={primary.classSection.academicYear.name} />
          <Fact label="Kampus" value={primary.classSection.campus.name} />
          {joinedDate && <Fact label="Masuk sejak" value={formatDateShort(joinedDate)} />}
          {others.map((e) => (
            <Fact key={e.id} label={e.classSection.program.name} value={e.classSection.name} />
          ))}
        </dl>
      )}
    </DossierSubsection>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  );
}
