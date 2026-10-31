import { Art, Avatar, Bar, Card, Label, Pill, Tick } from "./kit";

/** The Buku Penghubung week grid — one tick per child is enough, Rabu is a no-book day. */
const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum"] as const;
const CX = [200, 262, 324, 386, 448];
const RY = [130, 170, 210, 250];
// 1 = tick, 0 = empty, Rab (index 2) is always a dash
const ROWS = [
  [1, 1, 0, 1, 1],
  [1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0],
  [1, 1, 0, 1, 1],
];

export function JournalArt() {
  return (
    <Art label="journal">
      <Card x={14} y={24} w={532} h={346} r={16} />
      <Label x={32} y={56} size={15.5} tone="ink" weight={700}>
        Buku Penghubung · Kelas A
      </Label>

      {/* Rab band */}
      <rect x={297} y={78} width={54} height={196} rx={12} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      {DAYS.map((d, i) => (
        <Label key={d} x={CX[i]} y={102} size={14} anchor="middle" tone={i === 2 ? "gold" : "muted"} weight={600}>
          {d}
        </Label>
      ))}

      {RY.map((y, r) => (
        <g key={y}>
          <Avatar cx={48} cy={y} r={14} />
          <Bar x={70} y={y - 4} w={74 - (r % 2) * 14} h={8} />
          {CX.map((c, i) =>
            i === 2 ? (
              <path key={c} d={`M${c - 7} ${y} h14`} strokeWidth={2.5} className="stroke-celebration-gold" />
            ) : (
              <g key={c}>
                <rect x={c - 22} y={y - 15} width={44} height={30} rx={8} className="fill-secondary stroke-none" />
                {ROWS[r][i] ? <Tick cx={c} cy={y} /> : null}
              </g>
            ),
          )}
        </g>
      ))}
      <Pill x={474} y={197} w={68} h={26} size={13}>
        Lengkap
      </Pill>

      {/* callout */}
      <path d="M324 274 V 290" strokeDasharray="2 5" className="stroke-celebration-gold/70" />
      <rect x={30} y={290} width={340} height={60} rx={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={46} y={314} size={14} tone="gold" weight={650}>
        Rabu: hari tanpa buku penghubung
      </Label>
      <Label x={46} y={334} size={13.5} tone="gold">
        Renang
      </Label>

      {/* note from the teacher */}
      <rect x={388} y={290} width={146} height={60} rx={16} className="fill-secondary stroke-primary-text/25" />
      <Label x={404} y={314} size={13.5} tone="ink" weight={550}>
        Catatan dari
      </Label>
      <Label x={404} y={334} size={13.5} tone="ink" weight={550}>
        Bu Guru
      </Label>
    </Art>
  );
}
