import Image from "next/image";
import { BadgeCheck, CalendarCheck2, Check, CreditCard, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Float, Phone } from "./frames";
import { Stage } from "./stage";

const CAPABILITIES = [
  { icon: CalendarCheck2, title: "Kehadiran harian", detail: "Tercatat rapi, terlihat orang tua" },
  { icon: NotebookPen, title: "Jurnal & perkembangan", detail: "Catatan guru sampai ke rumah" },
  { icon: CreditCard, title: "Tagihan sekolah", detail: "Bayar dan lihat riwayatnya" },
];

const ACCOUNTS = [
  { initials: "NH", name: "Nur Hasanah", email: "nur.hasanah@gmail.com", picked: true },
  { initials: "NR", name: "Nur Rahma", email: "nurrahma.kerja@gmail.com", picked: false },
];

/** The sign-in screen with its single Google action, beside the account chooser where the registered email is the one to pick. */
export function SignInMock() {
  return (
    <Stage label="sign-in">
      <Phone className="left-6 top-3" height={476}>
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          <div className="bg-card px-6 pb-4 pt-3">
            <div className="mb-3 flex items-center gap-3">
              <Image src="/logo.png" alt="" width={44} height={44} className="rounded-[13px] outline -outline-offset-1 outline-black/10" />
              <span className="inline-flex flex-col leading-none">
                <span className="text-lg font-semibold tracking-tight">Talib</span>
                <span className="mt-0.5 text-xs text-muted-foreground">by An Nisaa&apos; Sekolahku</span>
              </span>
            </div>
            <h1 className="text-h1 tracking-tight">Masuk ke Talib</h1>
            <p className="mt-1.5 max-w-[36ch] text-body leading-relaxed text-muted-foreground">
              Akses hanya untuk staf dan orang tua yang diundang sekolah.
            </p>
            <div className="mt-3.5 flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-border bg-card text-sm font-semibold shadow-xs">
              <span className="grid size-[18px] place-items-center rounded-full border border-foreground/40 text-[11px] font-bold leading-none">G</span>
              Masuk dengan Google
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              Gunakan akun Google yang terdaftar di sekolah. Belum punya akses? Hubungi admin sekolah.
            </p>
          </div>
          <div className="bg-secondary px-6 py-3">
            <p className="text-h2 font-semibold leading-tight tracking-tight">Sahabat belajar anak</p>
            <ul className="mt-2 grid gap-1.5">
              {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
                <li key={title} className="flex items-start gap-2.5">
                  <Icon className="mt-0.5 size-[18px] shrink-0 text-primary-text" />
                  <span>
                    <span className="block text-body font-semibold leading-tight">{title}</span>
                    <span className="block text-xs text-muted-foreground">{detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Phone>

      <Float className="left-[384px] top-[150px] w-[272px] space-y-3">
        <div>
          <p className="text-h2 font-semibold leading-tight">Pilih akun</p>
          <p className="mt-0.5 text-xs text-muted-foreground">untuk melanjutkan ke Talib</p>
        </div>
        <div className="space-y-2">
          {ACCOUNTS.map((a) => (
            <div
              key={a.email}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2.5",
                a.picked ? "border-primary bg-secondary/60" : "border-border bg-background",
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  a.picked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {a.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email}</p>
              </div>
              {a.picked ? (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-status-present-subtle px-2.5 py-1.5 text-xs font-medium text-status-present-text">
          <BadgeCheck className="size-4 shrink-0" />
          Email yang terdaftar di sekolah
        </div>
      </Float>
    </Stage>
  );
}
