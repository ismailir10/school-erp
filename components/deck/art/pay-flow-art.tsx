import { Art, Arrow, Bar, Card, Label, Pill, Tick } from "./kit";

/** Parent: Bayar sekarang → halaman DOKU → back in Talib with the receipt, plus the new-link fallback. */
export function PayFlowArt() {
  return (
    <Art label="pay-flow">
      {/* 1 Bayar sekarang */}
      <Card x={20} y={36} w={130} h={170} r={14} />
      <Bar x={34} y={58} w={64} />
      <Bar x={34} y={76} w={90} />
      <Bar x={34} y={94} w={48} />
      <rect x={27} y={146} width={116} height={40} rx={12} className="fill-primary stroke-none" />
      <Label x={85} y={170} size={13} anchor="middle" tone="onTeal" weight={700}>
        Bayar sekarang
      </Label>
      <Label x={85} y={228} size={13} anchor="middle">
        Di Talib
      </Label>

      <Arrow d="M154 121 H 176" head={[184, 121, 0]} />

      {/* 2 DOKU */}
      <Card x={190} y={36} w={150} h={170} r={14} />
      <Label x={206} y={64} size={14} tone="ink" weight={700}>
        Halaman DOKU
      </Label>
      <Bar x={206} y={80} w={96} />
      <Bar x={206} y={96} w={64} />
      <rect x={206} y={120} width={118} height={66} rx={10} className="fill-secondary stroke-primary-text/25" />
      <Bar x={218} y={136} w={72} className="fill-primary/35" />
      <Bar x={218} y={154} w={94} h={8} />
      <Bar x={218} y={168} w={52} />
      <Label x={265} y={228} size={13} anchor="middle">
        Di DOKU
      </Label>

      <Arrow d="M344 121 H 366" head={[374, 121, 0]} />

      {/* 3 back in Talib */}
      <rect x={380} y={24} width={160} height={182} rx={22} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={433} y={34} width={54} height={6} rx={3} className="fill-foreground/12 stroke-none" />
      <circle cx={460} cy={76} r={18} className="fill-primary/25 stroke-none" />
      <Tick cx={460} cy={76} s={1.2} />
      <Label x={460} y={118} size={13.5} anchor="middle" tone="ink" weight={650}>
        Alhamdulillah,
      </Label>
      <Label x={460} y={136} size={13.5} anchor="middle" tone="ink" weight={650}>
        tagihan terbayar
      </Label>
      <Pill x={402} y={156} w={116} h={28} size={13}>
        Kuitansi PDF
      </Pill>
      <Label x={460} y={228} size={13} anchor="middle">
        Kembali ke Talib
      </Label>

      {/* fallback */}
      <rect x={70} y={262} width={420} height={96} rx={16} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={94} y={304} size={15} tone="gold" weight={700}>
        Link tidak bisa dibuka?
      </Label>
      <Bar x={94} y={320} w={150} className="fill-celebration-gold/30" />
      <Pill x={338} y={292} w={132} h={32} tone="teal" size={13.5}>
        Minta link baru
      </Pill>
    </Art>
  );
}
