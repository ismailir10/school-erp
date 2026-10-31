import { Art, Bar, Card, Label, Tick } from "./kit";

/** Parent sign-in — the Talib sign-in screen on a phone, and the "use the same email" reminder. */
export function SignInArt() {
  return (
    <Art label="sign-in">
      {/* phone */}
      <rect x={34} y={20} width={226} height={360} rx={30} className="fill-card stroke-foreground/35" strokeWidth={2} />
      <rect x={110} y={30} width={74} height={8} rx={4} className="fill-foreground/12 stroke-none" />

      <rect x={126} y={96} width={42} height={42} rx={12} className="fill-primary stroke-none" />
      <path d="M138 112 H 156 M147 112 V 128" strokeWidth={3.5} className="stroke-primary-foreground" />
      <Label x={147} y={172} size={20} anchor="middle" tone="ink" weight={700}>
        Talib
      </Label>

      <rect x={52} y={216} width={190} height={46} rx={14} className="fill-card stroke-foreground/35" strokeWidth={1.5} />
      {/* four-quadrant glyph */}
      <circle cx={72} cy={239} r={9} className="fill-secondary stroke-primary-text/40" />
      <path d="M72 230 A9 9 0 0 1 81 239 H 72 Z" className="fill-primary stroke-none" />
      <path d="M72 248 A9 9 0 0 1 63 239 H 72 Z" className="fill-primary/40 stroke-none" />
      <Label x={88} y={244} size={13} tone="ink" weight={600}>
        Masuk dengan Google
      </Label>

      <Label x={147} y={298} size={13} anchor="middle">
        Untuk orang tua yang
      </Label>
      <Label x={147} y={316} size={13} anchor="middle">
        diundang sekolah
      </Label>

      {/* email card */}
      <Card x={296} y={84} w={232} h={140} r={16} />
      <Label x={314} y={114} size={13} tone="ink" weight={650}>
        Email terdaftar di sekolah
      </Label>
      <rect x={314} y={130} width={196} height={42} rx={12} className="fill-secondary stroke-primary-text/25" />
      <Bar x={328} y={147} w={104} h={8} className="fill-foreground/25" />
      <circle cx={488} cy={151} r={11} className="fill-primary/25 stroke-none" />
      <Tick cx={488} cy={151} s={0.8} />
      <Bar x={314} y={190} w={120} h={6} />
      <Bar x={314} y={204} w={78} h={6} />

      {/* the one thing to look at */}
      <rect x={296} y={252} width={232} height={52} rx={14} className="fill-celebration-gold-subtle stroke-celebration-gold/50" />
      <Label x={412} y={284} size={15} anchor="middle" tone="gold" weight={700}>
        Pakai email yang sama
      </Label>
      <path d="M412 252 V 226" strokeDasharray="2 5" className="stroke-celebration-gold/70" />
    </Art>
  );
}
