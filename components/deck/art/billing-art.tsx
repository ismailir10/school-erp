import { Art, Arrow, Bar, Card, Label, Pill, Tick } from "./kit";

/** Slide 8 — fee → three-step wizard → invoices → payment and receipt, with the status path. */
export function BillingArt() {
  return (
    <Art label="billing">
      {/* 1 fee */}
      <Card x={28} y={44} w={106} h={128} r={14} />
      <Label x={44} y={70} size={13.5} tone="ink" weight={650}>
        Biaya
      </Label>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Bar x={44} y={88 + i * 24} w={44} />
          <Bar x={96} y={88 + i * 24} w={24} className="fill-primary/40" />
        </g>
      ))}
      <Label x={44} y={164} size={13}>
        per program
      </Label>

      <Arrow d="M138 108 H 160" head={[162, 108, 0]} />

      {/* 2 wizard */}
      <Card x={166} y={44} w={140} h={128} r={14} />
      <Label x={182} y={70} size={13.5} tone="ink" weight={650}>
        Buat tagihan
      </Label>
      {["Cakupan", "Tinjau", "Komit"].map((t, i) => (
        <g key={t}>
          <circle
            cx={190}
            cy={94 + i * 24}
            r={7}
            className={i === 2 ? "fill-primary stroke-none" : "fill-secondary stroke-primary-text/60"}
          />
          <Label x={204} y={99 + i * 24} size={13.5} tone={i === 2 ? "ink" : "muted"}>
            {t}
          </Label>
        </g>
      ))}

      <Arrow d="M310 108 H 332" head={[334, 108, 0]} />

      {/* 3 invoices */}
      <Card x={338} y={52} w={104} h={112} r={14} className="stroke-foreground/10" />
      <Card x={346} y={46} w={104} h={112} r={14} className="stroke-foreground/20" />
      <Card x={354} y={40} w={104} h={112} r={14} className="stroke-foreground/30" />
      <Label x={370} y={66} size={13} tone="ink" weight={650}>
        Tagihan
      </Label>
      <Bar x={370} y={80} w={60} />
      <Bar x={370} y={94} w={44} />
      <line x1={370} x2={442} y1={112} y2={112} className="stroke-foreground/15" />
      <Label x={370} y={134} size={13} tone="teal" weight={700}>
        Rp
      </Label>
      <Bar x={394} y={128} w={46} h={9} className="fill-foreground/25" />

      <Arrow d="M462 96 H 478" head={[480, 96, 0]} />

      {/* 4 paid */}
      <Card x={486} y={58} w={52} h={74} r={12} />
      <circle cx={512} cy={84} r={14} className="fill-primary/25 stroke-none" />
      <Tick cx={512} cy={84} />
      <Bar x={496} y={108} w={32} h={5} />
      <Bar x={496} y={118} w={22} h={5} />

      {/* status path */}
      <Label x={28} y={228} size={13.5} weight={600}>
        STATUS TAGIHAN
      </Label>
      <Pill x={28} y={244} w={78} tone="line">
        Draft
      </Pill>
      <path d="M110 257 H 128" className="stroke-primary-text/70" />
      <Pill x={132} y={244} w={104} tone="pale">
        Link dibuat
      </Pill>
      <path d="M240 257 H 258" className="stroke-primary-text/70" />
      <Pill x={262} y={244} w={124} tone="pale">
        Dibayar sebagian
      </Pill>
      <path d="M390 257 H 408" className="stroke-primary-text/70" />
      <Pill x={412} y={244} w={72} tone="teal">
        Lunas
      </Pill>
      <Pill x={132} y={290} w={110} tone="gold">
        Lewat tempo
      </Pill>
      <path d="M186 270 V 288" className="stroke-celebration-gold/70" strokeDasharray="2 5" />

      <Card x={286} y={288} w={234} h={80} r={14} />
      <Label x={304} y={314} size={13} tone="ink" weight={650}>
        Pembayaran
      </Label>
      <Label x={304} y={334} size={13.5}>
        Daring lewat DOKU, atau manual
      </Label>
      <Label x={304} y={352} size={13.5}>
        dengan tinjauan. Kuitansi PDF.
      </Label>
    </Art>
  );
}
