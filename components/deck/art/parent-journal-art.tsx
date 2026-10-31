import { Art, Bar, Label, Pill, Tick } from "./kit";

/** Parent journal — the Buku Penghubung "Di rumah" tab with home habits, and the school↔home thread. */
const HABITS = [
  { t: "Shalat subuh", done: true },
  { t: "Membaca", done: true },
  { t: "Tidur siang", done: false },
];

export function ParentJournalArt() {
  return (
    <Art label="parent-journal">
      {/* phone */}
      <rect x={24} y={20} width={250} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={111} y={30} width={76} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={46} y={74} size={15.5} tone="ink" weight={700}>
        Buku Penghubung
      </Label>

      {/* tabs */}
      <Label x={46} y={116} size={13}>
        Di sekolah
      </Label>
      <Pill x={127} y={98} w={76} h={26} size={13}>
        Di rumah
      </Pill>
      <Label x={216} y={116} size={13}>
        Catatan
      </Label>

      {/* habits */}
      {HABITS.map(({ t, done }, i) => {
        const y = 144 + i * 48;
        return (
          <g key={t}>
            <rect x={40} y={y} width={218} height={38} rx={12} className="fill-card stroke-foreground/15" />
            {done ? (
              <>
                <rect x={52} y={y + 8} width={22} height={22} rx={7} className="fill-primary/25 stroke-primary-text/40" />
                <Tick cx={63} cy={y + 19} s={0.8} />
              </>
            ) : (
              <rect x={52} y={y + 8} width={22} height={22} rx={7} className="fill-card stroke-foreground/35" />
            )}
            <Label x={88} y={y + 24} size={14} tone="ink" weight={550}>
              {t}
            </Label>
          </g>
        );
      })}

      <rect x={40} y={298} width={218} height={58} rx={12} className="fill-secondary stroke-primary-text/20" />
      <Bar x={54} y={314} w={150} />
      <Bar x={54} y={330} w={96} />

      {/* thread */}
      <rect x={298} y={100} width={232} height={62} rx={16} className="fill-secondary stroke-primary-text/25" />
      <Label x={314} y={126} size={13.5} tone="ink" weight={550}>
        Aisyah makan siangnya habis
      </Label>
      <Label x={314} y={148} size={13}>
        Bu Guru
      </Label>

      <rect x={338} y={188} width={192} height={62} rx={16} className="fill-card stroke-foreground/20" />
      <Label x={354} y={214} size={13.5} tone="ink" weight={550}>
        Terima kasih, Bu Guru
      </Label>
      <Label x={354} y={236} size={13}>
        Bu Nur
      </Label>
      <circle cx={522} cy={194} r={6} className="fill-celebration-gold stroke-card" strokeWidth={2} />
    </Art>
  );
}
