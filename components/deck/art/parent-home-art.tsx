import { Art, Bar, Card, Label, Pill, Tick } from "./kit";

/** Parent Beranda on a phone — child switcher, attendance, family invoice, message thread — with report and progress cards. */
export function ParentHomeArt() {
  return (
    <Art label="parent-home">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={50} y={64} size={13.5} tone="ink" weight={700}>
        Assalamu&apos;alaikum, Bu Nur
      </Label>
      <Pill x={50} y={74} w={76} h={26} size={13.5} tone="teal">
        Aisyah
      </Pill>
      <Pill x={134} y={74} w={66} h={26} size={13.5} tone="line">
        Umar
      </Pill>

      {/* attendance */}
      <Card x={50} y={108} w={194} h={42} r={12} />
      <Label x={62} y={133} size={13} tone="ink" weight={600}>
        Aisyah hadir hari ini
      </Label>
      <circle cx={228} cy={129} r={10} className="fill-primary/25 stroke-none" />
      <Tick cx={228} cy={129} s={0.8} />

      {/* family invoice */}
      <Card x={50} y={158} w={194} h={78} r={12} />
      <Label x={64} y={180} size={14} tone="ink" weight={650}>
        Tagihan keluarga
      </Label>
      <Bar x={64} y={189} w={96} h={8} />
      <Pill x={64} y={202} w={114} h={24} size={13} tone="gold">
        Belum dibayar
      </Pill>

      {/* message thread */}
      <Card x={50} y={244} w={194} h={72} r={12} />
      <Label x={64} y={266} size={14} tone="ink" weight={650}>
        Buku Penghubung
      </Label>
      <Label x={64} y={284} size={13}>
        Catatan baru
      </Label>
      <Label x={64} y={299} size={13}>
        dari Bu Guru
      </Label>
      <circle cx={226} cy={262} r={6} className="fill-celebration-gold stroke-card" strokeWidth={2} />

      {/* bottom nav */}
      <line x1={34} x2={260} y1={328} y2={328} className="stroke-foreground/15" />
      {[72, 111, 150, 189, 228].map((cx, i) => (
        <circle
          key={cx}
          cx={cx}
          cy={352}
          r={i === 0 ? 6 : 5}
          className={i === 0 ? "fill-primary stroke-none" : "fill-foreground/25 stroke-none"}
        />
      ))}

      {/* report */}
      <Card x={300} y={84} w={232} h={102} r={16} />
      <Label x={320} y={116} size={14.5} tone="ink" weight={650}>
        Rapor
      </Label>
      <Bar x={320} y={128} w={96} />
      <Pill x={320} y={146} w={96} h={26} size={13} tone="pale">
        Unduh PDF
      </Pill>
      <rect x={484} y={100} width={32} height={40} rx={6} className="fill-secondary stroke-primary-text/25" />
      <Bar x={491} y={112} w={18} h={5} />
      <Bar x={491} y={123} w={12} h={5} />

      {/* progress */}
      <Card x={316} y={212} w={216} h={102} r={16} />
      <Label x={336} y={244} size={14.5} tone="ink" weight={650}>
        Perkembangan
      </Label>
      <Pill x={336} y={262} w={78} h={26} size={13} tone="pale">
        Mampu
      </Pill>
      {[14, 22, 31, 40].map((h, i) => (
        <rect
          key={h}
          x={442 + i * 20}
          y={296 - h}
          width={12}
          height={h}
          rx={4}
          className={i === 3 ? "fill-primary stroke-none" : "fill-primary/30 stroke-none"}
        />
      ))}
    </Art>
  );
}
