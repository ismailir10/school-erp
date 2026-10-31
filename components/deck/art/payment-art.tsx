import { Art, Arrow, Bar, Card, Label, Pill, Tick } from "./kit";

/** Invoice lifecycle — tagihan, DOKU link, paid with receipt, the expired-link branch, and a reminder. */
export function PaymentArt() {
  return (
    <Art label="payment">
      {/* 1 tagihan */}
      <Card x={28} y={40} w={140} h={104} r={14} />
      <Label x={44} y={68} size={14} tone="ink" weight={650}>
        Tagihan SPP
      </Label>
      <Pill x={44} y={80} w={108} h={26} size={13.5} tone="line">
        Belum lunas
      </Pill>
      <Bar x={44} y={122} w={72} />

      <Arrow d="M172 92 H 198" head={[206, 92, 0]} />

      {/* 2 DOKU link */}
      <Card x={210} y={40} w={140} h={104} r={14} />
      <Label x={226} y={68} size={14} tone="ink" weight={650}>
        Link DOKU
      </Label>
      <Bar x={226} y={80} w={92} h={8} className="fill-primary/35" />
      <Label x={226} y={116} size={13}>
        Ada masa berlaku
      </Label>

      <Arrow d="M354 92 H 380" head={[388, 92, 0]} />

      {/* 3 paid */}
      <Card x={392} y={40} w={140} h={104} r={14} />
      <Pill x={408} y={54} w={68} h={26} size={13.5} tone="teal">
        Lunas
      </Pill>
      <circle cx={508} cy={67} r={13} className="fill-primary/25 stroke-none" />
      <Tick cx={508} cy={67} />
      <Label x={408} y={106} size={13}>
        Kuitansi PDF
      </Label>
      <Bar x={408} y={118} w={64} h={6} />

      {/* expired branch */}
      <Arrow d="M280 148 V 178" head={[280, 186, 90]} />
      <Card x={190} y={190} w={180} h={84} r={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={206} y={216} size={14} tone="gold" weight={650}>
        Link kedaluwarsa
      </Label>
      <Pill x={206} y={230} w={132} h={28} size={13} tone="teal">
        Buat link baru
      </Pill>
      <Arrow d="M186 232 C 146 232 150 168 220 152" head={[226, 150, -16]} />

      {/* reminder */}
      <rect x={28} y={304} width={216} height={62} rx={16} className="fill-secondary stroke-primary-text/25" />
      <path d="M46 366 L38 378 L66 366 Z" className="fill-secondary stroke-none" />
      <Label x={44} y={329} size={14} tone="ink" weight={600}>
        Pengingat WhatsApp
      </Label>
      <Bar x={44} y={343} w={128} />

      {/* alert */}
      <Card x={330} y={304} w={202} h={62} r={14} />
      <circle cx={354} cy={326} r={6} className="fill-celebration-gold stroke-card" strokeWidth={2} />
      <Label x={372} y={331} size={14} tone="ink" weight={600}>
        Perlu dicek
      </Label>
      <Bar x={372} y={344} w={110} />
    </Art>
  );
}
