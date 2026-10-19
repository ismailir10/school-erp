"use client";

import Link from "next/link";
import { DetailRail, RailCard, RailKV, RailStatTiles, type RailTile } from "@/components/admin/detail-rail";
import { formatDateShort } from "@/lib/format";

/**
 * The student dossier's right rail, desktop only. Below `lg` it is hidden
 * outright: on a phone the header, "Perlu perhatian", the family strip and the
 * closed groups' summaries already carry these numbers, and a stacked tile
 * block would only push the sections down.
 *
 * Tunggakan, Hadir bulan ini and Raport as tiles, then Jejak (when the record
 * was made and where it came from). Everything else the old rail said now lives
 * with the section it belongs to or in the strip.
 */
export function StudentRail({
  tiles,
  createdAt,
  fromEnrollmentApplication,
}: {
  tiles: RailTile[];
  createdAt: string | null;
  fromEnrollmentApplication: string | null;
}) {
  return (
    <DetailRail className="hidden lg:flex">
      <RailStatTiles tiles={tiles} />
      <RailCard title="Jejak">
        <RailKV
          items={[
            ...(createdAt ? [{ label: "Dibuat", value: formatDateShort(createdAt) }] : []),
            {
              label: "Asal data",
              value: fromEnrollmentApplication ? (
                <Link
                  href={`/admin/enrollments/${fromEnrollmentApplication}`}
                  className="inline-flex items-center text-primary-text hover:underline [@media(pointer:coarse)]:min-h-11"
                >
                  Formulir pendaftaran →
                </Link>
              ) : (
                <span className="text-muted-foreground">Input manual</span>
              ),
            },
          ]}
        />
      </RailCard>
    </DetailRail>
  );
}
