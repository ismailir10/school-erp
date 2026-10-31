import { Art, Avatar, Bar, Card, Label, Pill } from "./kit";

/** Parent: the Profil screen — Hubungi sekolah, Anak Anda, and the Panduan Talib row. */
export function ContactArt() {
  return (
    <Art label="contact">
      {/* phone */}
      <rect x={120} y={20} width={320} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={243} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={144} y={72} size={15.5} tone="ink" weight={700}>
        Profil
      </Label>

      <Avatar cx={176} cy={116} r={28} tone="teal" />
      <Bar x={218} y={106} w={130} h={10} />
      <Bar x={218} y={126} w={84} h={7} />

      <Label x={144} y={178} size={13.5} weight={600}>
        Hubungi sekolah
      </Label>
      <rect x={144} y={188} width={131} height={42} rx={12} className="fill-card stroke-foreground/35" />
      <Label x={209.5} y={214} size={13.5} anchor="middle" tone="teal" weight={650}>
        Chat WhatsApp
      </Label>
      <rect x={285} y={188} width={131} height={42} rx={12} className="fill-card stroke-foreground/35" />
      <Label x={350.5} y={214} size={13.5} anchor="middle" tone="teal" weight={650}>
        Telepon sekolah
      </Label>

      <Label x={144} y={256} size={13.5} weight={600}>
        Anak Anda
      </Label>
      <Card x={144} y={266} w={272} h={46} r={12} />
      <Avatar cx={168} cy={289} r={14} />
      <Bar x={192} y={285} w={96} h={8} />
      <Pill x={346} y={276} w={56} h={26} size={13}>
        TK A
      </Pill>

      <rect x={144} y={328} width={272} height={40} rx={12} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={162} y={353} size={14.5} tone="gold" weight={700}>
        Panduan Talib
      </Label>
      <path d="M392 341 l7 6 l-7 6" strokeWidth={2} className="stroke-celebration-gold" />
    </Art>
  );
}
