import { Art, Bar, Card, Label, Pill, Tick } from "./kit";

/** Teacher Beranda on a phone — clock-in, the class card, open tasks — with payslip and leave cards beside it. */
export function TeacherHomeArt() {
  return (
    <Art label="teacher-home">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />
      <Label x={50} y={68} size={15} tone="ink" weight={700}>
        Selamat pagi, Bu Guru
      </Label>

      <rect x={50} y={82} width={194} height={40} rx={12} className="fill-primary stroke-none" />
      <Label x={147} y={107} size={14} anchor="middle" tone="onTeal" weight={700}>
        Catat masuk
      </Label>

      <Card x={50} y={134} w={194} h={86} r={14} />
      <Label x={64} y={158} size={14.5} tone="ink" weight={650}>
        Kelas A
      </Label>
      <Bar x={64} y={166} w={64} h={6} />
      <Pill x={64} y={182} w={166} h={28} size={13} tone="pale">
        Buka absensi kelas
      </Pill>

      <Label x={50} y={246} size={13} weight={600}>
        Yang perlu diselesaikan
      </Label>
      <circle cx={62} cy={268} r={9} className="fill-primary/25 stroke-none" />
      <Tick cx={62} cy={268} s={0.8} />
      <Bar x={82} y={264} w={112} h={8} />
      <circle cx={62} cy={298} r={9} className="fill-card stroke-celebration-gold" strokeWidth={2} />
      <Bar x={82} y={294} w={90} h={8} />

      {/* bottom nav */}
      <line x1={34} x2={260} y1={324} y2={324} className="stroke-foreground/15" />
      <Pill x={48} y={338} w={68} h={28} size={13} tone="pale">
        Beranda
      </Pill>
      {[148, 176, 204, 232].map((cx) => (
        <circle key={cx} cx={cx} cy={352} r={5} className="fill-foreground/25 stroke-none" />
      ))}

      {/* payslip */}
      <Card x={300} y={84} w={232} h={100} r={16} />
      <Label x={320} y={116} size={14.5} tone="ink" weight={650}>
        Slip gaji
      </Label>
      <Pill x={436} y={98} w={80} h={26} size={13} tone="teal">
        Tersedia
      </Pill>
      <Bar x={320} y={140} w={112} />
      <Bar x={320} y={156} w={72} />

      {/* leave */}
      <Card x={316} y={212} w={216} h={100} r={16} />
      <Label x={336} y={244} size={14.5} tone="ink" weight={650}>
        Ajukan cuti
      </Label>
      <rect x={484} y={228} width={32} height={30} rx={7} className="fill-secondary stroke-primary-text/25" />
      <line x1={484} x2={516} y1={238} y2={238} className="stroke-primary-text/25" />
      <circle cx={494} cy={248} r={2.5} className="fill-primary stroke-none" />
      <circle cx={506} cy={248} r={2.5} className="fill-foreground/25 stroke-none" />
      <Bar x={336} y={268} w={120} />
      <Bar x={336} y={284} w={80} />
    </Art>
  );
}
