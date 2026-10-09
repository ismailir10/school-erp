import { Art, Arrow, Avatar, Card, Label, Pill } from "./kit";

/** Slide 4 — school year → semesters → classes → teachers, with roll-forward and substitute swap. */
const CLASSES = [
  { x: 40, name: "Kelas A" },
  { x: 208, name: "Kelas B" },
  { x: 376, name: "Kelas C" },
] as const;

export function StructureArt() {
  return (
    <Art label="structure">
      {/* last year, ghosted, copied into this year */}
      <rect
        x={40}
        y={36}
        width={150}
        height={46}
        rx={12}
        strokeDasharray="4 6"
        className="fill-transparent stroke-foreground/30"
      />
      <Label x={115} y={65} size={14} anchor="middle">
        Tahun lalu
      </Label>
      <Arrow d="M196 59 H 272" head={[274, 59, 0]} />
      <Label x={235} y={46} size={13.5} anchor="middle" tone="teal" weight={600}>
        Salin kelas
      </Label>

      <rect x={284} y={36} width={236} height={72} rx={14} className="fill-primary stroke-none" />
      <Label x={402} y={62} size={15.5} anchor="middle" tone="onTeal" weight={700}>
        Tahun ajaran baru
      </Label>
      <rect x={296} y={72} width={100} height={26} rx={13} className="fill-card/90 stroke-none" />
      <rect x={408} y={72} width={100} height={26} rx={13} className="fill-card/90 stroke-none" />
      <Label x={346} y={89.5} size={13.5} anchor="middle" tone="ink">
        Semester 1
      </Label>
      <Label x={458} y={89.5} size={13.5} anchor="middle" tone="ink">
        Semester 2
      </Label>

      {/* the year owns the classes */}
      <g className="stroke-foreground/25">
        <path d="M402 108 V 142 M 112 142 H 448 M 112 142 V 168 M 280 142 V 168 M 448 142 V 168" />
      </g>

      {CLASSES.map((c, i) => (
        <g key={c.name}>
          <Card x={c.x} y={168} w={144} h={132} r={14} />
          <Label x={c.x + 16} y={196} size={15.5} tone="ink" weight={650}>
            {c.name}
          </Label>
          <Label x={c.x + 16} y={216} size={13.5}>
            Guru kelas
          </Label>
          <Avatar cx={c.x + 30} cy={252} r={17} tone="teal" />
          <Avatar cx={c.x + 68} cy={252} r={17} />
          {i === 1 && (
            <g>
              <Avatar cx={c.x + 106} cy={252} r={17} tone="gold" />
              <Label x={c.x + 106} y={288} size={13} anchor="middle" tone="gold" weight={600}>
                pengganti
              </Label>
            </g>
          )}
        </g>
      ))}

      {/* students move up a class together */}
      <Arrow d="M112 312 C 140 352 252 352 276 316" head={[278, 314, -62]} className="stroke-primary-text/60" />
      <Pill x={142} y={344} w={108} tone="pale">
        Naik kelas
      </Pill>
    </Art>
  );
}
