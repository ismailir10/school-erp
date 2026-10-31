import {
  BookOpen,
  CalendarCheck,
  FileText,
  GraduationCap,
  Landmark,
  Layers,
  NotebookPen,
  Receipt,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Spotlight } from "@/components/reactbits/spotlight";
import { Stagger, StaggerItem } from "@/components/reactbits/stagger";

/** Staff deck, slide 2 — the nine modules, and the three doors into them. */
const MODULES: { icon: LucideIcon; name: string; line: string }[] = [
  { icon: Landmark, name: "Dasar", line: "Akun, kampus, kalender libur" },
  { icon: GraduationCap, name: "Kesiswaan", line: "Dari pendaftar sampai siswa" },
  { icon: Layers, name: "Akademik", line: "Tahun ajaran, kelas, guru" },
  { icon: CalendarCheck, name: "Kehadiran", line: "Absensi harian siswa" },
  { icon: BookOpen, name: "Buku Penghubung", line: "Kabar sekolah dan rumah" },
  { icon: NotebookPen, name: "Kurikulum", line: "Tema, pekan, penilaian" },
  { icon: FileText, name: "Rapor", line: "Laporan tiap triwulan" },
  { icon: Receipt, name: "Keuangan", line: "Tagihan dan pembayaran" },
  { icon: Users, name: "SDM", line: "Kehadiran, cuti, gaji" },
];

const DOORS = [
  { name: "Admin", note: "komputer" },
  { name: "Guru", note: "ponsel" },
  { name: "Orang tua", note: "ponsel" },
];

export function ModuleMap() {
  return (
    <div>
      <ul className="flex flex-wrap gap-2" aria-label="Tiga portal">
        {DOORS.map((d) => (
          <li
            key={d.name}
            className="rounded-full border border-border bg-card px-3 py-1 text-sm"
          >
            <span className="font-semibold">{d.name}</span>
            <span className="text-muted-foreground"> · {d.note}</span>
          </li>
        ))}
      </ul>

      <Stagger
        as="ul"
        count={MODULES.length}
        className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3"
        aria-label="Sembilan modul Talib"
      >
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <StaggerItem
              key={m.name}
              as="li"
              className="relative isolate overflow-hidden rounded-2xl border border-border bg-card p-3.5 sm:p-4"
            >
              <Spotlight />
              <Icon className="size-5 text-primary-text" strokeWidth={1.75} aria-hidden="true" />
              <p className="mt-3 text-[0.95rem] font-semibold leading-tight">{m.name}</p>
              <p className="mt-1 text-[0.8rem] leading-snug text-muted-foreground">{m.line}</p>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
