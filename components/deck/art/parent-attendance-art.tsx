import { Art, Bar, Card, INK, Label, Pill, Tick } from "./kit";

/** Parent attendance — the week grid for one child (Sen–Jum, today highlighted), a teacher note, and the legend. */
const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum"];
const DATES = ["27", "28", "29", "30", "31"];
const MARKS: ("H" | "S" | "I")[] = ["H", "H", "S", "I", "H"];
const TODAY = 4;
const COL = (c: number) => 71 + c * 38;
const TOP = 132;
const ROW_CY = 208;

export function ParentAttendanceArt() {
  return (
    <Art label="parent-attendance">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={56} y={74} size={15.5} tone="ink" weight={700}>
        Kehadiran
      </Label>
      <Pill x={170} y={56} w={74} h={26} size={13}>
        Aisyah
      </Pill>

      {/* week navigator */}
      <path d="M66 100 l-6 7 l6 7" className={INK} strokeWidth={2} />
      <Label x={147} y={112} size={14.5} anchor="middle" tone="ink" weight={600}>
        27 – 31 Okt
      </Label>
      <path d="M228 100 l6 7 l-6 7" className={INK} strokeWidth={2} />

      {/* week table: today's column, then headers and the status row */}
      <rect x={COL(TODAY) - 19} y={TOP} width={38} height={96} className="fill-primary/10 stroke-none" />
      <rect x={COL(TODAY) - 19} y={TOP} width={38} height={3} className="fill-primary stroke-none" />
      <line x1={52} x2={242} y1={TOP + 96} y2={TOP + 96} className="stroke-foreground/15" />
      {DAYS.map((d, c) => (
        <g key={d}>
          <Label x={COL(c)} y={TOP + 24} size={13} anchor="middle" tone={c === TODAY ? "teal" : "muted"} weight={c === TODAY ? 700 : 600}>
            {d}
          </Label>
          <Label x={COL(c)} y={TOP + 44} size={13} anchor="middle" tone={c === TODAY ? "teal" : "muted"} weight={500}>
            {DATES[c]}
          </Label>
        </g>
      ))}
      {MARKS.map((mark, c) => {
        const cx = COL(c);
        if (mark === "H") return <Tick key={c} cx={cx} cy={ROW_CY} s={1.1} />;
        if (mark === "S") {
          return (
            <g key={c}>
              <rect x={cx - 14} y={ROW_CY - 13} width={28} height={26} rx={9} className="fill-celebration-gold-subtle stroke-celebration-gold/60" />
              <Label x={cx} y={ROW_CY + 5} size={14} anchor="middle" tone="gold" weight={700}>
                S
              </Label>
            </g>
          );
        }
        return (
          <g key={c}>
            <rect x={cx - 14} y={ROW_CY - 13} width={28} height={26} rx={9} className="fill-secondary stroke-primary-text/30" />
            <Label x={cx} y={ROW_CY + 5} size={14} anchor="middle" tone="teal" weight={700}>
              I
            </Label>
          </g>
        );
      })}

      {/* note from Bu Guru */}
      <Card x={52} y={254} w={190} h={88} r={14} />
      <Label x={66} y={282} size={13} tone="ink" weight={600}>
        Catatan dari Bu Guru
      </Label>
      <Bar x={66} y={296} w={150} />
      <Bar x={66} y={312} w={104} />

      {/* legend */}
      <Card x={304} y={90} w={216} h={216} r={16} />
      <Label x={324} y={128} size={14} tone="ink" weight={650}>
        Keterangan
      </Label>
      {[
        { t: "Hadir", y: 150 },
        { t: "Sakit", y: 188 },
        { t: "Izin", y: 226 },
        { t: "Alpa", y: 264 },
      ].map(({ t, y }, i) => (
        <g key={t}>
          {i === 0 && (
            <>
              <circle cx={342} cy={y + 8} r={12} className="fill-primary/25 stroke-none" />
              <Tick cx={342} cy={y + 8} s={0.75} />
            </>
          )}
          {i === 1 && (
            <>
              <rect x={328} y={y - 5} width={28} height={26} rx={9} className="fill-celebration-gold-subtle stroke-celebration-gold/60" />
              <Label x={342} y={y + 13} size={14} anchor="middle" tone="gold" weight={700}>
                S
              </Label>
            </>
          )}
          {i === 2 && (
            <>
              <rect x={328} y={y - 5} width={28} height={26} rx={9} className="fill-secondary stroke-primary-text/30" />
              <Label x={342} y={y + 13} size={14} anchor="middle" tone="teal" weight={700}>
                I
              </Label>
            </>
          )}
          {i === 3 && (
            <>
              <rect x={328} y={y - 5} width={28} height={26} rx={9} className="fill-card stroke-foreground/30" />
              <Label x={342} y={y + 13} size={14} anchor="middle" weight={700}>
                A
              </Label>
            </>
          )}
          <Label x={372} y={y + 14} size={14} tone="ink" weight={550}>
            {t}
          </Label>
        </g>
      ))}
    </Art>
  );
}
