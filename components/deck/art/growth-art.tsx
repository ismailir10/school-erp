import { Art, Avatar, Bar, Card, Label, Pill } from "./kit";

/** Growth — a child's Perkembangan card with three indicators at three levels, and a "not a grade" note. */
const ROWS = [
  { y: 130, level: "Mampu dan Konsisten", tone: "teal", a: 196, b: 124 },
  { y: 182, level: "Mampu Belum Konsisten", tone: "pale", a: 170, b: 108 },
  { y: 234, level: "Perlu Penguatan", tone: "line", a: 208, b: 132 },
] as const;

export function GrowthArt() {
  return (
    <Art label="growth">
      <Card x={28} y={24} w={504} h={262} r={16} />
      <Avatar cx={62} cy={58} r={16} tone="teal" />
      <Label x={88} y={64} size={15.5} tone="ink" weight={700}>
        Perkembangan
      </Label>
      <Pill x={440} y={45} w={76} h={26} size={13}>
        Aisyah
      </Pill>
      <line x1={44} x2={516} y1={88} y2={88} className="stroke-foreground/15" />

      {ROWS.map((r) => (
        <g key={r.level}>
          <Bar x={48} y={r.y - 12} w={r.a} h={8} />
          <Bar x={48} y={r.y + 6} w={r.b} h={8} />
          <Pill x={318} y={r.y - 14} w={190} h={28} tone={r.tone} size={13}>
            {r.level}
          </Pill>
        </g>
      ))}

      <rect x={28} y={312} width={504} height={56} rx={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <circle cx={60} cy={340} r={11} className="fill-celebration-gold/25 stroke-celebration-gold/60" />
      <Label x={60} y={345} size={14} anchor="middle" tone="gold" weight={700}>
        i
      </Label>
      <Label x={84} y={346} size={15} tone="gold" weight={700}>
        Ini tahapan perkembangan, bukan nilai.
      </Label>
    </Art>
  );
}
