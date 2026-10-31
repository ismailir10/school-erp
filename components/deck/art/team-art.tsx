import { Art, Avatar, Bar, Card, Label, Pill } from "./kit";

/** Slide 9 — staff attendance, leave, and the owner-gated payroll. */
const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum"] as const;
// 0 hadir, 1 terlambat, 2 cuti
const GRID = [
  [0, 0, 1, 0, 0],
  [0, 0, 0, 0, 2],
  [0, 1, 0, 0, 0],
  [2, 2, 0, 0, 0],
] as const;

export function TeamArt() {
  return (
    <Art label="team">
      {/* attendance */}
      <Card x={28} y={28} w={268} h={194} r={16} />
      <Label x={46} y={56} size={14} tone="ink" weight={650}>
        Kehadiran
      </Label>
      <Label x={46} y={74} size={13.5}>
        Catat masuk dan pulang
      </Label>
      {DAYS.map((d, i) => (
        <Label key={d} x={78 + i * 44} y={102} size={13} anchor="middle">
          {d}
        </Label>
      ))}
      {GRID.map((row, r) =>
        row.map((v, c) => (
          <circle
            key={`${r}-${c}`}
            cx={78 + c * 44}
            cy={126 + r * 24}
            r={8}
            className={
              v === 0
                ? "fill-primary/55 stroke-none"
                : v === 1
                  ? "fill-celebration-gold stroke-none"
                  : "fill-transparent stroke-foreground/35"
            }
            strokeDasharray={v === 2 ? "2 3" : undefined}
          />
        )),
      )}

      {/* leave */}
      <Card x={312} y={28} w={220} h={194} r={16} />
      <Label x={330} y={56} size={14} tone="ink" weight={650}>
        Cuti
      </Label>
      <Label x={330} y={74} size={13.5}>
        Diajukan dari ponsel
      </Label>
      <Avatar cx={348} cy={112} r={14} />
      <Bar x={372} y={104} w={70} h={8} />
      <Bar x={372} y={118} w={44} h={6} />
      <Pill x={330} y={142} w={82} tone="line" size={13.5}>
        Diajukan
      </Pill>
      <path d="M416 155 H 430" className="stroke-primary-text/70" />
      <Pill x={434} y={142} w={82} tone="teal" size={13.5}>
        Disetujui
      </Pill>
      <Bar x={330} y={184} w={150} />
      <Bar x={330} y={198} w={100} />

      {/* payroll */}
      <Card x={28} y={242} w={504} h={130} r={16} />
      <Label x={46} y={270} size={14} tone="ink" weight={650}>
        Penggajian
      </Label>
      <Label x={46} y={288} size={13.5}>
        Komponen, proses bulanan, persetujuan
      </Label>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Bar x={46} y={312 + i * 16} w={120 + i * 14} />
          <Bar x={206} y={312 + i * 16} w={44} className="fill-primary/40" />
        </g>
      ))}

      {/* own payslip */}
      <rect x={382} y={256} width={128} height={104} rx={12} className="fill-secondary stroke-foreground/20" />
      <Label x={398} y={282} size={13} tone="ink" weight={650}>
        Slip gaji
      </Label>
      <Bar x={398} y={296} w={72} />
      <Bar x={398} y={310} w={52} />
      <Bar x={398} y={324} w={62} />
      <Label x={398} y={348} size={13} tone="teal" weight={600}>
        milik sendiri
      </Label>

      {/* lock */}
      <g transform="translate(302 290)">
        <rect x={0} y={14} width={44} height={36} rx={9} className="fill-celebration-gold-subtle stroke-celebration-gold" strokeWidth={2} />
        <path d="M9 14 v-7 a13 13 0 0 1 26 0 v7" className="stroke-celebration-gold" strokeWidth={2} />
        <circle cx={22} cy={32} r={4} className="fill-celebration-gold stroke-none" />
      </g>
      <Label x={324} y={354} size={13} anchor="middle" tone="gold" weight={600}>
        hanya pemilik
      </Label>
    </Art>
  );
}
