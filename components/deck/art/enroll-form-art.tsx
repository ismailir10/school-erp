import { Art, Bar, Card, Label, Pill, Tick } from "./kit";

/** Parent: the pendaftaran formulir — stepper, Kode pos auto-fill, tanda tangan and biaya pendaftaran. */
export function EnrollFormArt() {
  return (
    <Art label="enroll-form">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />

      {/* 7-dot stepper */}
      <line x1={64} x2={238} y1={62} y2={62} className="stroke-foreground/15" />
      {Array.from({ length: 7 }, (_, i) => (
        <circle
          key={i}
          cx={64 + i * 29}
          cy={62}
          r={i === 0 ? 8 : 5.5}
          className={i === 0 ? "fill-primary stroke-none" : "fill-secondary stroke-primary-text/40"}
        />
      ))}
      <Label x={52} y={92} size={14} tone="teal" weight={700}>
        Data Anak
      </Label>

      {/* fields */}
      {[104, 140].map((y, i) => (
        <g key={y}>
          <rect x={52} y={y} width={190} height={28} rx={10} className="fill-card stroke-foreground/25" />
          <Bar x={64} y={y + 10} w={i === 0 ? 96 : 70} h={8} />
        </g>
      ))}
      <Label x={52} y={190} size={13} weight={600}>
        Kode pos
      </Label>
      <rect x={52} y={198} width={190} height={30} rx={10} className="fill-card stroke-primary-text/60" />
      <Label x={64} y={218} size={14} tone="ink" weight={650}>
        12345
      </Label>

      {/* auto-filled address */}
      <rect x={52} y={238} width={190} height={72} rx={12} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Tick cx={69} cy={256} />
      <Label x={83} y={261} size={13} tone="gold" weight={700}>
        Alamat terisi
      </Label>
      <Bar x={66} y={274} w={150} className="fill-celebration-gold/30" />
      <Bar x={66} y={290} w={104} className="fill-celebration-gold/30" />

      <Pill x={52} y={326} w={190} h={40} tone="teal" size={14}>
        Kirim Formulir
      </Pill>

      {/* tanda tangan */}
      <Card x={284} y={52} w={246} h={152} r={16} />
      <Label x={302} y={80} size={14} tone="ink" weight={650}>
        Tanda tangan
      </Label>
      <rect x={302} y={94} width={210} height={90} rx={10} className="fill-secondary stroke-primary-text/25" />
      <line x1={318} x2={496} y1={162} y2={162} className="stroke-foreground/20" strokeDasharray="2 5" />
      <path
        d="M324 150 C332 112 348 108 346 136 C345 154 358 150 366 128 C372 112 382 116 380 136 C379 152 394 148 404 124 C410 110 418 116 416 134 C415 150 430 150 440 134 C448 122 458 130 470 138 C478 143 486 138 492 128"
        strokeWidth={2.5}
        className="stroke-primary-text"
      />

      {/* biaya */}
      <Card x={284} y={220} w={246} h={100} r={16} />
      <Label x={302} y={248} size={14} tone="ink" weight={650}>
        Biaya pendaftaran
      </Label>
      <Label x={302} y={272} size={13.5}>
        Dibayar setelah
      </Label>
      <Label x={302} y={291} size={13.5}>
        formulir dikirim
      </Label>
    </Art>
  );
}
