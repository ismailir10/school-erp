import { Art, Avatar, Bar, Card, Label, Tick } from "./kit";

/** Slide 5 — the class attendance screen, the school↔home thread, and the monthly recap. */
const ROWS = [
  { y: 112, mark: "hadir" },
  { y: 150, mark: "hadir" },
  { y: 188, mark: "S" },
  { y: 226, mark: "hadir" },
  { y: 264, mark: "I" },
] as const;

export function DayArt() {
  return (
    <Art label="day">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={56} y={74} size={15.5} tone="ink" weight={700}>
        Absensi kelas
      </Label>
      <Label x={56} y={92} size={13.5}>
        Hadir 3 · Sakit 1 · Izin 1
      </Label>

      {ROWS.map((r) => (
        <g key={r.y}>
          <Avatar cx={70} cy={r.y + 8} r={13} />
          <Bar x={92} y={r.y + 3} w={62} h={8} />
          {r.mark === "hadir" ? (
            <g>
              <rect x={206} y={r.y - 6} width={30} height={28} rx={9} className="fill-primary/25 stroke-none" />
              <Tick cx={221} cy={r.y + 8} />
            </g>
          ) : (
            <g>
              <rect x={206} y={r.y - 6} width={30} height={28} rx={9} className="fill-celebration-gold-subtle stroke-celebration-gold/60" />
              <Label x={221} y={r.y + 13} size={14} anchor="middle" tone="gold" weight={700}>
                {r.mark}
              </Label>
            </g>
          )}
        </g>
      ))}

      <rect x={52} y={316} width={190} height={42} rx={14} className="fill-primary stroke-none" />
      <Label x={147} y={342} size={13.5} anchor="middle" tone="onTeal" weight={700}>
        Tandai sisanya Hadir
      </Label>

      {/* thread */}
      <Label x={300} y={40} size={13.5} weight={600}>
        BUKU PENGHUBUNG
      </Label>
      <rect x={300} y={52} width={220} height={52} rx={16} className="fill-secondary stroke-primary-text/25" />
      <Label x={316} y={74} size={13.5} tone="ink" weight={550}>
        Makan siang habis
      </Label>
      <Label x={316} y={92} size={13}>
        dari sekolah
      </Label>

      <rect x={332} y={116} width={188} height={52} rx={16} className="fill-card stroke-foreground/20" />
      <Label x={348} y={138} size={13.5} tone="ink" weight={550}>
        Terima kasih, Bu Guru
      </Label>
      <Label x={348} y={156} size={13}>
        dari rumah
      </Label>
      <circle cx={512} cy={122} r={6} className="fill-celebration-gold stroke-card" strokeWidth={2} />

      {/* recap */}
      <Card x={300} y={196} w={220} h={184} r={16} />
      <Label x={318} y={226} size={14} tone="ink" weight={650}>
        Rekap bulanan
      </Label>
      <Label x={318} y={244} size={13.5}>
        Rekap per kelas, ekspor CSV
      </Label>
      {[56, 74, 62, 84, 70, 90, 66].map((h, i) => (
        <rect
          key={i}
          x={322 + i * 28}
          y={356 - h}
          width={16}
          height={h}
          rx={5}
          className={i === 5 ? "fill-primary stroke-none" : "fill-primary/30 stroke-none"}
        />
      ))}
    </Art>
  );
}
