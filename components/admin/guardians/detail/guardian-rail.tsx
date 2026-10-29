import { DetailRail, RailStatTiles, type RailTile } from "@/components/admin/detail-rail";
import { formatRupiah } from "@/lib/format";
import { childClassNames, missingDocumentsText } from "./summaries";
import type { ParentDetail } from "./types";

/**
 * Desktop-only summary rail. Below `lg` it is hidden outright: on a phone the
 * header, the attention strip and the collapsed-section summaries already
 * carry the same three numbers, and a stacked tile block would only push the
 * sections down.
 */
export function GuardianRail({ parent }: { parent: ParentDetail }) {
  const { invoiceSummary: s } = parent;
  const classes = childClassNames(parent.guardians);
  const present = (parent.hasKtp ? 1 : 0) + (parent.hasKk ? 1 : 0);

  const tiles: RailTile[] = [
    {
      label: "Tunggakan",
      value: formatRupiah(s.outstanding),
      tone: s.outstanding > 0 ? "critical" : "positive",
      hint: s.outstanding > 0 ? `${s.unpaidCount} dari ${s.invoiceCount} tagihan belum lunas` : "Tidak ada tunggakan",
      wide: true,
      mono: true,
    },
    {
      label: "Anak Terdaftar",
      value: parent.guardians.length,
      hint: classes.length > 0 ? classes.join(", ") : undefined,
    },
    {
      label: "Berkas",
      value: `${present}/2`,
      hint: missingDocumentsText(parent) ?? "Lengkap",
    },
  ];

  return (
    <DetailRail className="hidden lg:flex">
      <RailStatTiles tiles={tiles} />
    </DetailRail>
  );
}
