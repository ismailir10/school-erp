import { Art, Avatar, Bar, Card, Label } from "./kit";

/** The admin Dasbor — the "Perlu ditangani" queue tiles and urgent rows, beside the Analitik attendance strip. */
const TILES = [
  { x: 28, n: "2", a: "Formulir", b: "masuk" },
  { x: 128, n: "1", a: "Link", b: "pembayaran" },
  { x: 228, n: "1", a: "Pengajuan", b: "cuti" },
] as const;

const HEIGHTS = [38, 42, 40, 44, 41, 36, 43, 45, 40, 42, 44, 39, 41, 43, 45, 42, 40, 44, 38, 41, 43, 45, 40, 36, 30, 34, 26, 32, 22, 28];

export function DashboardArt() {
  return (
    <Art label="dashboard">
      {/* queue card */}
      <Card x={16} y={20} w={320} h={360} r={16} />
      <Label x={28} y={52} size={15.5} tone="ink" weight={700}>
        Perlu ditangani
      </Label>

      {TILES.map((t, i) => (
        <g key={t.x}>
          <rect x={t.x} y={68} width={94} height={104} rx={12} className="fill-secondary stroke-primary-text/25" />
          <Label x={t.x + 47} y={110} size={32} anchor="middle" tone={i === 0 ? "teal" : "ink"} weight={700}>
            {t.n}
          </Label>
          <Label x={t.x + 47} y={138} size={13} anchor="middle" tone="ink" weight={500}>
            {t.a}
          </Label>
          <Label x={t.x + 47} y={156} size={13} anchor="middle" tone="ink" weight={500}>
            {t.b}
          </Label>
        </g>
      ))}

      {[0, 1].map((i) => (
        <g key={i}>
          <Card x={28} y={190 + i * 64} w={296} h={54} r={10} />
          <Avatar cx={54} cy={217 + i * 64} r={16} />
          <Bar x={82} y={207 + i * 64} w={120 - i * 24} h={8} className="fill-foreground/25" />
          <Bar x={82} y={223 + i * 64} w={78} h={7} />
          <rect x={268} y={207 + i * 64} width={42} height={20} rx={10} className="fill-primary/25 stroke-none" />
        </g>
      ))}

      <Label x={28} y={344} size={14} tone="teal" weight={600}>
        Lihat semua
      </Label>
      <line x1={28} x2={106} y1={350} y2={350} className="stroke-primary-text/50" />

      {/* analytics card */}
      <Card x={348} y={20} w={196} h={360} r={16} />
      <Label x={364} y={52} size={15.5} tone="ink" weight={700}>
        Analitik
      </Label>
      <Label x={364} y={84} size={13.5}>
        Kehadiran siswa
      </Label>
      {HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={364 + i * 5.4}
          y={170 - h}
          width={3.6}
          height={h}
          rx={1.8}
          className={i > 23 ? "fill-primary stroke-none" : "fill-primary/30 stroke-none"}
        />
      ))}
      <line x1={364} x2={526} y1={176} y2={176} className="stroke-foreground/15" />
      <Label x={364} y={196} size={13}>
        30 hari
      </Label>

      <rect x={364} y={222} width={164} height={50} rx={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={446} y={244} size={13.5} anchor="middle" tone="gold" weight={650}>
        Kelas perlu
      </Label>
      <Label x={446} y={262} size={13.5} anchor="middle" tone="gold" weight={650}>
        perhatian
      </Label>

      {[0, 1, 2].map((i) => (
        <g key={i}>
          <Bar x={364} y={298 + i * 26} w={64 + (i % 2) * 18} />
          <Bar x={496} y={298 + i * 26} w={32} className="fill-primary/30" />
        </g>
      ))}
    </Art>
  );
}
