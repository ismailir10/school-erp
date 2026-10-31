import { Art, Arrow, Bar, Card, Label, Pill } from "./kit";

/** Weekly assessment — the teacher's phone (indicator, three levels, sentra chips) and the admin Pemantauan card. */
const LEVELS = [
  { x: 54, t: "Mampu" },
  { x: 115, t: "Belum" },
  { x: 176, t: "Perlu" },
] as const;

const CLASSES = [
  { y: 128, n: 12, w: 78 },
  { y: 200, n: 14, w: 64 },
  { y: 272, n: 9, w: 70 },
] as const;

export function AssessArt() {
  return (
    <Art label="assess">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={54} y={74} size={15.5} tone="ink" weight={700}>
        Penilaian pekanan
      </Label>

      <rect x={54} y={90} width={186} height={76} rx={12} className="fill-secondary stroke-primary-text/25" />
      <Bar x={68} y={106} w={140} h={8} className="fill-foreground/25" />
      <Bar x={68} y={124} w={112} />
      <Bar x={68} y={140} w={84} />

      {LEVELS.map((l, i) => (
        <g key={l.t}>
          <rect
            x={l.x}
            y={182}
            width={58}
            height={40}
            rx={12}
            className={i === 0 ? "fill-primary stroke-none" : "fill-card stroke-foreground/25"}
          />
          <Label x={l.x + 29} y={207} size={13} anchor="middle" tone={i === 0 ? "onTeal" : "muted"} weight={i === 0 ? 650 : 600}>
            {l.t}
          </Label>
        </g>
      ))}

      <Label x={54} y={256} size={13} weight={600}>
        Sentra harian
      </Label>
      <Pill x={54} y={268} w={124} h={28} size={13}>
        Sentra Ibadah
      </Pill>
      <Pill x={54} y={304} w={124} h={28} size={13}>
        Sentra Seni
      </Pill>

      <Arrow d="M266 200 H 280" head={[290, 200, 0]} />

      {/* admin monitoring */}
      <Card x={296} y={70} w={248} h={260} r={16} />
      <Label x={314} y={102} size={15.5} tone="ink" weight={700}>
        Pemantauan
      </Label>
      {CLASSES.map((c, i) => {
        const low = i === 2;
        return (
          <g key={c.y}>
            <Bar x={314} y={c.y - 8} w={c.w} h={8} className="fill-foreground/25" />
            <Label x={526} y={c.y + 2} size={14} anchor="end" tone={low ? "gold" : "ink"} weight={700}>
              {`${c.n}/14`}
            </Label>
            <rect x={314} y={c.y + 14} width={212} height={10} rx={5} className="fill-foreground/12 stroke-none" />
            <rect
              x={314}
              y={c.y + 14}
              width={(212 * c.n) / 14}
              height={10}
              rx={5}
              className={low ? "fill-celebration-gold stroke-none" : "fill-primary stroke-none"}
            />
          </g>
        );
      })}
    </Art>
  );
}
