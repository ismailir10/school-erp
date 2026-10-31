import { Art, Bar, Card, Label, Pill } from "./kit";

/** Parent: a tagihan detail on the phone (amounts, Bayar sekarang, Cara bayar) beside the invoice list. */
const AMOUNTS = [
  { y: 116, label: "Total tagihan", w: 66 },
  { y: 150, label: "Sudah dibayar", w: 54 },
  { y: 192, label: "Sisa tagihan", w: 72 },
] as const;

export function ParentInvoiceArt() {
  return (
    <Art label="parent-invoice">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={52} y={74} size={15} tone="ink" weight={700}>
        Tagihan SPP November
      </Label>

      {AMOUNTS.map((r, i) => (
        <g key={r.label}>
          <Label x={52} y={r.y} size={13.5} tone={i === 2 ? "ink" : "muted"} weight={i === 2 ? 700 : 500}>
            {r.label}
          </Label>
          <Bar
            x={242 - r.w}
            y={r.y - 8}
            w={r.w}
            h={i === 2 ? 10 : 8}
            className={i === 2 ? "fill-primary/45" : undefined}
          />
        </g>
      ))}
      <line x1={52} x2={242} y1={166} y2={166} className="stroke-foreground/15" />

      <rect x={52} y={218} width={190} height={42} rx={14} className="fill-primary stroke-none" />
      <Label x={147} y={244} size={14} anchor="middle" tone="onTeal" weight={700}>
        Bayar sekarang
      </Label>

      <Card x={52} y={278} w={190} h={84} r={14} className="fill-secondary stroke-primary-text/25" />
      <Label x={68} y={302} size={13.5} tone="ink" weight={650}>
        Cara bayar
      </Label>
      <Label x={68} y={322} size={13.5}>
        Transfer bank
      </Label>
      <Label x={68} y={340} size={13.5}>
        (virtual account)
      </Label>

      {/* invoice list */}
      <Card x={284} y={70} w={246} h={210} r={16} />
      <Pill x={300} y={88} w={124} h={28} tone="teal" size={13}>
        Belum dibayar
      </Pill>
      <Pill x={432} y={88} w={64} h={28} tone="line" size={13}>
        Lunas
      </Pill>

      <line x1={300} x2={514} y1={134} y2={134} className="stroke-foreground/15" />
      <Bar x={300} y={152} w={92} h={9} />
      <Bar x={300} y={170} w={64} h={7} />
      <Pill x={410} y={146} w={104} h={26} tone="gold" size={13}>
        Lewat tempo
      </Pill>
      <Bar x={440} y={188} w={74} h={9} className="fill-foreground/25" />

      <line x1={300} x2={514} y1={216} y2={216} className="stroke-foreground/15" />
      <Bar x={300} y={236} w={84} h={9} />
      <Bar x={300} y={254} w={58} h={7} />
      <Bar x={440} y={246} w={74} h={9} className="fill-foreground/25" />
    </Art>
  );
}
