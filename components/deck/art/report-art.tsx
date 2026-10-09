import { Art, Avatar, Bar, Card, Label, Pill, Tick } from "./kit";

/** Slide 7 — a report card paper stack, published, read as PDF and on a phone. */
export function ReportArt() {
  return (
    <Art label="report">
      {/* stacked sheets */}
      <rect x={74} y={46} width={228} height={316} rx={16} className="fill-secondary stroke-foreground/15" transform="rotate(-5 188 204)" />
      <rect x={66} y={40} width={228} height={316} rx={16} className="fill-secondary stroke-foreground/15" transform="rotate(-2.2 180 198)" />
      <Card x={60} y={34} w={228} h={316} r={16} className="stroke-foreground/25" />
      <Avatar cx={92} cy={68} r={14} tone="teal" />
      <Bar x={116} y={58} w={96} h={8} className="fill-foreground/25" />
      <Bar x={116} y={73} w={64} h={6} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Bar x={80} y={118 + i * 72} w={74} h={8} className="fill-primary/45" />
          <Bar x={80} y={136 + i * 72} w={188} />
          <Bar x={80} y={150 + i * 72} w={172} />
          <Bar x={80} y={164 + i * 72} w={120} />
        </g>
      ))}
      <circle cx={262} cy={322} r={22} className="fill-celebration-gold-subtle stroke-celebration-gold" strokeWidth={2} />
      <Tick cx={262} cy={322} s={1.3} className="stroke-celebration-gold-text" />

      {/* what happens to it */}
      <Pill x={338} y={46} w={78} tone="line">
        Draft
      </Pill>
      <path d="M420 59 H 438" className="stroke-primary-text/70" />
      <Pill x={442} y={46} w={78} tone="gold">
        Terbit
      </Pill>

      <Card x={338} y={112} w={182} h={92} r={16} />
      <rect x={356} y={132} width={38} height={50} rx={6} className="fill-secondary stroke-primary-text/40" />
      <Label x={375} y={163} size={13.5} anchor="middle" tone="teal" weight={700}>
        PDF
      </Label>
      <Label x={408} y={150} size={14} tone="ink" weight={650}>
        Cetak
      </Label>
      <Label x={408} y={168} size={13.5}>
        atau unduh
      </Label>

      <Card x={338} y={222} w={182} h={128} r={16} />
      <rect x={366} y={236} width={50} height={102} rx={10} className="fill-secondary stroke-foreground/30" />
      <Bar x={374} y={252} w={34} h={5} />
      <Bar x={374} y={264} w={26} h={5} />
      <Bar x={374} y={276} w={30} h={5} />
      <rect x={374} y={302} width={34} height={14} rx={7} className="fill-primary stroke-none" />
      <Label x={432} y={282} size={14} tone="ink" weight={650}>
        Dibaca
      </Label>
      <Label x={432} y={300} size={13.5}>
        di ponsel
      </Label>
      <Label x={432} y={316} size={13.5}>
        orang tua
      </Label>
    </Art>
  );
}
