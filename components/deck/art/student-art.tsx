import { Art, Avatar, Bar, Card, Label, Pill } from "./kit";

/** The student detail page — header, three rail tiles, group tabs, and the cuti card beside the linked wali. */
export function StudentArt() {
  return (
    <Art label="student">
      {/* header */}
      <Card x={16} y={16} w={528} h={72} r={14} />
      <Avatar cx={52} cy={52} r={22} tone="teal" />
      <Bar x={88} y={34} w={150} h={10} className="fill-foreground/25" />
      <Pill x={88} y={52} w={58} h={24}>
        TK A
      </Pill>

      {/* rail tiles */}
      <Card x={16} y={102} w={168} h={72} r={12} />
      <Label x={30} y={126} size={13}>
        Tunggakan
      </Label>
      <Label x={30} y={156} size={14} tone="teal" weight={700}>
        Rp
      </Label>
      <Bar x={54} y={148} w={84} h={10} className="fill-foreground/25" />

      <Card x={196} y={102} w={168} h={72} r={12} />
      <Label x={210} y={126} size={13}>
        Hadir bulan ini
      </Label>
      <Label x={210} y={158} size={22} tone="ink" weight={700}>
        18/20
      </Label>

      <Card x={376} y={102} w={168} h={72} r={12} />
      <Label x={390} y={126} size={13}>
        Rapor
      </Label>
      <Pill x={390} y={136} w={72} h={26} tone="teal">
        Terbit
      </Pill>

      {/* group tabs */}
      <Pill x={16} y={190} w={68} h={30} tone="line" size={14}>
        Profil
      </Pill>
      <Pill x={92} y={190} w={92} h={30} tone="line" size={14}>
        Keluarga
      </Pill>
      <Pill x={192} y={190} w={100} h={30} tone="teal" size={14}>
        Keuangan
      </Pill>

      {/* cuti card */}
      <rect x={16} y={238} width={320} height={142} rx={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={34} y={270} size={15.5} tone="gold" weight={700}>
        Cuti siswa
      </Label>
      <Label x={34} y={298} size={14.5} tone="ink" weight={600}>
        Nov – Des
      </Label>
      <Label x={34} y={324} size={14} tone="gold">
        Tidak ditagih
      </Label>
      <rect x={34} y={346} width={284} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <rect x={168} y={346} width={96} height={8} rx={4} className="fill-celebration-gold stroke-none" />

      {/* wali card */}
      <Card x={348} y={238} w={196} h={142} r={14} />
      <Avatar cx={378} cy={274} r={20} />
      <Label x={406} y={272} size={14.5} tone="ink" weight={650}>
        Wali murid
      </Label>
      <Bar x={406} y={284} w={80} />
      <line x1={362} x2={530} y1={306} y2={306} className="stroke-foreground/15" />
      <Pill x={358} y={322} w={176} h={32} tone="teal" size={13}>
        Ingatkan via WhatsApp
      </Pill>
    </Art>
  );
}
