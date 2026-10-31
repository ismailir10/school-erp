import { Art, Card, Label } from "./kit";

/** Slide 6 — the PROMES spine and the three-level scale. */
const COLS = [
  { x: 70, name: "Semester", nodes: [200] },
  { x: 202, name: "Tema", nodes: [150, 250] },
  { x: 334, name: "Subtema", nodes: [118, 182, 238, 302] },
  { x: 466, name: "Pekan", nodes: [96, 140, 184, 228, 272, 316] },
] as const;

export function SpineArt() {
  const links: string[] = [];
  const parentOf = (col: number, i: number) => {
    const prev = COLS[col - 1].nodes;
    const n = COLS[col].nodes.length;
    return prev[Math.min(prev.length - 1, Math.floor((i * prev.length) / n))];
  };
  for (let c = 1; c < COLS.length; c++) {
    COLS[c].nodes.forEach((y, i) => {
      const py = parentOf(c, i);
      const x0 = COLS[c - 1].x + 24;
      const x1 = COLS[c].x - 24;
      const mx = (x0 + x1) / 2;
      links.push(`M${x0} ${py} C${mx} ${py} ${mx} ${y} ${x1} ${y}`);
    });
  }
  return (
    <Art label="spine">
      <g className="stroke-primary-text/45">
        {links.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {COLS.map((col, ci) => (
        <g key={col.name}>
          <Label x={col.x} y={40} size={13.5} anchor="middle" tone="teal" weight={650}>
            {col.name}
          </Label>
          {col.nodes.map((y, i) => (
            <rect
              key={i}
              x={col.x - 24}
              y={y - 12}
              width={48}
              height={24}
              rx={12}
              className={ci === 0 ? "fill-primary stroke-none" : ci === 3 ? "fill-card stroke-primary-text/40" : "fill-secondary stroke-primary-text/40"}
            />
          ))}
        </g>
      ))}

      {/* objectives and the three-level scale */}
      <Card x={40} y={344} w={480} h={38} r={14} />
      <Label x={58} y={368} size={13} tone="ink" weight={650}>
        Indikator
      </Label>
      {[
        { x: 136, name: "Perlu penguatan", fill: "fill-transparent stroke-primary-text" },
        { x: 276, name: "Belum konsisten", fill: "fill-primary/45 stroke-primary-text" },
        { x: 428, name: "Konsisten", fill: "fill-primary stroke-primary-text" },
      ].map((s) => (
        <g key={s.name}>
          <circle cx={s.x} cy={363} r={6} className={s.fill} />
          <Label x={s.x + 12} y={368} size={13.5}>
            {s.name}
          </Label>
        </g>
      ))}
    </Art>
  );
}
