import { Art, Avatar, Bar, Card, INK, Label } from "./kit";

/** Slide 3 — catat pertanyaan → Kirim Formulir (one tap) → formulir masuk (parent pays after sending) → student. Numbers match the list beside it. */
const NODES = [
  { cx: 84, cy: 296, title: "Pertanyaan", sub: "dicatat admin" },
  { cx: 214, cy: 148, title: "Kirim Formulir", sub: "satu ketukan, tautan" },
  { cx: 346, cy: 296, title: "Formulir masuk", sub: "7 langkah, lalu bayar" },
  { cx: 478, cy: 148, title: "Siswa", sub: "Terima & Jadikan Siswa" },
] as const;

const GLYPH: Record<number, React.ReactNode> = {
  0: (
    <g className={INK}>
      <rect x={-20} y={-17} width={40} height={28} rx={9} className="fill-secondary" />
      <path d="M-6 11 l-4 8 l12 -8" className="fill-secondary" />
      <Label x={0} y={6} size={22} anchor="middle" tone="teal" weight={700}>
        ?
      </Label>
    </g>
  ),
  1: (
    <g className={INK}>
      <rect x={-21} y={-14} width={42} height={29} rx={6} className="fill-secondary" />
      <path d="M-20 -12 L0 3 L20 -12" />
    </g>
  ),
  2: (
    <g className={INK}>
      <rect x={-16} y={-22} width={32} height={42} rx={5} className="fill-secondary" />
      <Bar x={-9} y={-14} w={18} h={4} />
      <Bar x={-9} y={-6} w={13} h={4} />
      <path d="M-10 10 q4 -9 8 0 t8 0 t6 -2" className="stroke-primary-text" strokeWidth={2} />
    </g>
  ),
  3: (
    <g className={INK}>
      <rect x={-23} y={-15} width={46} height={30} rx={6} className="fill-secondary" />
      <Avatar cx={-10} cy={0} r={9} tone="teal" />
      <Bar x={3} y={-6} w={15} h={4} />
      <Bar x={3} y={2} w={10} h={4} />
    </g>
  ),
};

export function JourneyArt() {
  const seg = (p: (typeof NODES)[number], q: (typeof NODES)[number]) => {
    const mx = (p.cx + q.cx) / 2;
    return `C${mx} ${p.cy} ${mx} ${q.cy} ${q.cx} ${q.cy}`;
  };
  const [a, b, c, d] = NODES;
  return (
    <Art label="journey">
      <path
        d={`M${a.cx} ${a.cy} ${seg(a, b)} ${seg(b, c)} ${seg(c, d)}`}
        strokeWidth={2.5}
        strokeDasharray="1 9"
        className="stroke-primary-text/75"
      />
      {NODES.map((n, i) => {
        const above = n.cy < 200;
        const last = i === NODES.length - 1;
        return (
          <g key={n.title}>
            <g transform={`translate(${n.cx} ${n.cy}) scale(1.22)`}>
              <Card x={-42} y={-42} w={84} h={84} r={18} className={last ? "stroke-celebration-gold/80" : undefined} />
              {GLYPH[i]}
              <circle cx={-36} cy={-36} r={10} className="fill-primary stroke-card" strokeWidth={2.5} />
              <Label x={-36} y={-31.5} size={13.5} anchor="middle" tone="onTeal" weight={700}>
                {i + 1}
              </Label>
            </g>
            <Label x={n.cx} y={above ? n.cy - 82 : n.cy + 78} size={17} anchor="middle" tone="ink" weight={650}>
              {n.title}
            </Label>
            <Label x={n.cx} y={above ? n.cy - 63 : n.cy + 97} size={13} anchor="middle">
              {n.sub}
            </Label>
          </g>
        );
      })}
    </Art>
  );
}
