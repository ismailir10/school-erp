import { BookHeart, CalendarDays, ChevronLeft, ChevronRight, Home, MessageCircle, MoreHorizontal, Phone as PhoneIcon, Presentation, Receipt, School } from "lucide-react";
import { BottomNav, Float, Phone, PortalHeader } from "./frames";
import { Stage } from "./stage";

const NAV = [
  { label: "Beranda", icon: Home },
  { label: "Tagihan", icon: Receipt },
  { label: "Kehadiran", icon: CalendarDays },
  { label: "Jurnal", icon: BookHeart },
  { label: "Lainnya", icon: MoreHorizontal },
];

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</p>;
}

/** A row card as the profile draws them: tinted icon tile, bold line, muted line. */
function RowCard({ icon: Icon, primary, secondary, chevron }: { icon: typeof School; primary: string; secondary: string; chevron?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-1.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{primary}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      {chevron ? <ChevronRight size={18} className="shrink-0 text-muted-foreground" /> : null}
    </div>
  );
}

/** Parent Profil: who is signed in, how to reach the school, the children and the tour, beside the WhatsApp chat that Chat WhatsApp opens. */
export function ProfileMock() {
  return (
    <Stage label="profile">
      <Phone className="left-6 top-3" height={476}>
        <PortalHeader initials="NR" name="Bu Nur" />
        <div className="min-h-0 flex-1 overflow-hidden bg-background px-4 pt-1">
          <div className="flex items-center gap-1">
            <ChevronLeft size={20} className="-ml-1 shrink-0" />
            <h1 className="text-h2 font-bold leading-tight tracking-tight">Profil</h1>
          </div>

          <div className="flex items-center gap-3 py-1">
            <div className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-secondary text-sm font-semibold text-primary-text">NR</div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">Nur Hasanah</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Wali murid · 2 anak terdaftar</p>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <SectionLabel>Hubungi sekolah</SectionLabel>
              <div className="space-y-1.5">
                <RowCard icon={School} primary="Bagian tata usaha" secondary="Untuk tagihan atau data diri" />
                <div className="flex gap-2">
                  <div className="flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-1 text-[0.8125rem] font-medium">
                    <MessageCircle size={16} /> Chat WhatsApp
                  </div>
                  <div className="flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-1 text-[0.8125rem] font-medium">
                    <PhoneIcon size={16} /> Telepon sekolah
                  </div>
                </div>
              </div>
            </div>

            <div>
              <SectionLabel>Anak Anda</SectionLabel>
              <RowCard icon={School} primary="Aisyah Putri" secondary="TK A · Al-Fatih" chevron />
            </div>

            <div>
              <SectionLabel>Bantuan</SectionLabel>
              <RowCard icon={Presentation} primary="Panduan Talib" secondary="Cara memakai portal orang tua" chevron />
            </div>
          </div>
        </div>
        <BottomNav items={NAV} active="Lainnya" />
      </Phone>

      <Float className="left-[384px] top-[120px] w-[272px] space-y-3 p-0">
        <div className="flex items-center gap-2.5 rounded-t-2xl bg-status-present-subtle px-4 py-3 text-status-present-text">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-status-present text-white">
            <MessageCircle size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">Bagian tata usaha</p>
            <p className="text-xs leading-tight">WhatsApp</p>
          </div>
        </div>
        <div className="px-4 pb-4 pt-1">
          <div className="max-w-[92%] rounded-xl rounded-tr-sm bg-secondary px-3 py-2 text-sm leading-snug">
            Assalamu&apos;alaikum, saya Bu Nur, wali Aisyah Putri (TK A Al-Fatih). Saya ingin menanyakan tagihan SPP November.
          </div>
        </div>
      </Float>
    </Stage>
  );
}
