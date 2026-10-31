import { Art, Arrow, Avatar, Bar, Card, Label, Pill } from "./kit";

/** Fee settings — the three tabs, per-program rates, the school + daycare bundle, and a discount. */
const ROWS = [
  { name: "KB", y: 110, w: 56, hot: false },
  { name: "TK A", y: 150, w: 80, hot: true },
  { name: "Day Care", y: 190, w: 68, hot: true },
] as const;

export function FeesArt() {
  return (
    <Art label="fees">
      {/* tabs */}
      <Pill x={28} y={24} w={96} h={28} tone="line" size={13.5}>
        Komponen
      </Pill>
      <Pill x={132} y={24} w={150} h={28} tone="teal" size={13.5}>
        Tarif per program
      </Pill>
      <Pill x={290} y={24} w={106} h={28} tone="line" size={13.5}>
        Keringanan
      </Pill>

      {/* rate table */}
      <Card x={28} y={72} w={250} h={170} r={14} />
      <Label x={46} y={98} size={13}>
        Program
      </Label>
      <Label x={170} y={98} size={13}>
        Biaya
      </Label>
      <line x1={28} x2={278} y1={110} y2={110} className="stroke-foreground/15" />
      {ROWS.map((r) => (
        <g key={r.name}>
          {r.hot && <rect x={36} y={r.y + 3} width={234} height={34} rx={9} className="fill-secondary stroke-none" />}
          <Label x={48} y={r.y + 25} size={14.5} tone="ink" weight={600}>
            {r.name}
          </Label>
          <Bar x={170} y={r.y + 16} w={r.w} h={9} className={r.hot ? "fill-primary/50" : "fill-primary/30"} />
        </g>
      ))}

      {/* bundle */}
      <Card x={330} y={122} w={206} h={104} r={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={346} y={152} size={13.5} tone="gold" weight={650}>
        Paket sekolah + daycare
      </Label>
      <Label x={346} y={174} size={13.5}>
        Satu harga
      </Label>
      <Bar x={346} y={190} w={104} h={9} className="fill-celebration-gold/40" />
      <Arrow d="M284 170 C 302 170 306 152 322 152" head={[330, 152, 0]} />
      <Arrow d="M284 210 C 302 210 306 198 322 198" head={[330, 198, 0]} />

      {/* discount */}
      <Card x={28} y={272} w={508} h={92} r={14} />
      <Avatar cx={64} cy={318} r={17} tone="teal" />
      <Bar x={92} y={308} w={84} h={8} />
      <Bar x={92} y={324} w={54} h={6} />
      <Pill x={204} y={305} w={76} h={26} size={13.5}>
        Diskon
      </Pill>
      <Bar x={316} y={314} w={76} h={9} className="fill-foreground/20" />
      <line x1={316} x2={392} y1={318.5} y2={318.5} className="stroke-foreground/45" />
      <Arrow d="M402 318 H 424" head={[432, 318, 0]} />
      <Bar x={444} y={314} w={56} h={9} className="fill-primary/50" />
    </Art>
  );
}
