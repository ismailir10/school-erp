import Image from "next/image";
import { ChevronRight, ClipboardCheck, FileSpreadsheet, FileUp, GraduationCap, LayoutDashboard, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { Browser, Float } from "./frames";
import { Stage } from "./stage";

const RAIL = [
  { icon: LayoutDashboard },
  { icon: GraduationCap },
  { icon: ClipboardCheck, active: true },
  { icon: Wallet },
  { icon: Users },
];

const THEMES = [
  { name: "Diriku", sub: "Urutan 1 · 3 subtema", selected: false },
  { name: "Keluargaku", sub: "Urutan 2 · 3 subtema", selected: true },
  { name: "Tempat Tinggalku", sub: "Urutan 3 · 2 subtema", selected: false },
  { name: "Alam Sekitarku", sub: "Urutan 4 · 3 subtema", selected: false },
];

const SUBTHEMES = [
  { name: "Anggota keluarga", sub: "Urutan 1 · 2 pekan", selected: true },
  { name: "Tugas di rumah", sub: "Urutan 2 · 2 pekan", selected: false },
];

const WEEKS = [
  { name: "Pekan 1", sub: "20 – 24 Jul 2026" },
  { name: "Pekan 2", sub: "27 – 31 Jul 2026" },
];

const PREVIEW = [
  { element: "Nilai Agama & Budi Pekerti", tp: "TP 1", text: "Anak mengenal Allah lewat ciptaan-Nya" },
  { element: "Jati Diri", tp: "TP 2", text: "Anak menyebutkan anggota keluarganya" },
  { element: "Motorik", tp: "TP 3", text: "Anak melompat dengan dua kaki" },
];

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-5 w-fit items-center whitespace-nowrap rounded-full px-2 text-xs font-medium", tone)}>{children}</span>;
}

/** One column of the real Tema / Subtema / Pekan page: a card with a title and a stack of selectable rows. */
function Column({
  title,
  parent,
  rows,
}: {
  title: string;
  parent?: string;
  rows: { name: string; sub: string; selected?: boolean }[];
}) {
  return (
    <div className="min-w-0 rounded-xl bg-card py-2.5 ring-1 ring-border">
      <p className="truncate px-3 pb-2 text-sm font-semibold">
        {title}
        {parent && <span className="text-xs font-normal text-muted-foreground"> · {parent}</span>}
      </p>
      <div className="space-y-1.5 px-3">
        {rows.map((r) => (
          <div
            key={r.name}
            className={cn("flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5", r.selected && "bg-muted ring-1 ring-primary/20")}
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{r.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{r.sub}</p>
            </div>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Semester page: Tema, Subtema and Pekan side by side as the admin builds them, with the PROMES import preview (Tujuan Pembelajaran) lifted over it. */
export function CurriculumMock() {
  return (
    <Stage label="curriculum">
      <Browser url="/admin/semesters/semester-1/themes" className="left-3 top-3 h-[400px] w-[656px]">
        <div className="flex h-[calc(100%-32px)]">
          <div className="flex w-10 shrink-0 flex-col items-center gap-2 bg-sidebar py-3">
            <Image src="/logo.png" alt="" width={22} height={22} className="mb-2 rounded-md" />
            {RAIL.map(({ icon: Icon, active }, i) => (
              <span
                key={i}
                className={cn("grid size-7 place-items-center rounded-md", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground")}
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-hidden bg-background px-4 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-h1 font-bold leading-tight tracking-tight">2026/2027 · Semester 1</h1>
                <p className="truncate text-xs text-muted-foreground">Periode 13 Jul 2026 – 18 Des 2026. Atur tema, subtema, dan pekan.</p>
              </div>
              <Chip tone="bg-status-present-subtle text-status-present-text">Aktif</Chip>
            </div>

            <div className="mt-2 flex">
              <span className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs">
                <FileUp className="size-3.5" />
                Impor PROMES (Program Semester)
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Column title="Tema" rows={THEMES} />
              <Column title="Subtema" parent="Keluargaku" rows={SUBTHEMES} />
              <Column title="Pekan" rows={WEEKS} />
            </div>
          </div>
        </div>
      </Browser>

      <Float className="left-[222px] top-[232px] w-[446px] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="truncate text-sm font-semibold">Impor PROMES (Program Semester)</p>
          <Chip tone="bg-status-leave-subtle text-status-leave-text">Pratinjau</Chip>
        </div>

        <div className="px-4 pt-2.5">
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-1.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-success-subtle text-success-text">
              <FileSpreadsheet className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">PROMES-TK-A-2026.xlsx</p>
              <p className="truncate text-[11px] text-muted-foreground">TK A · 24 tujuan pembelajaran · 31 indikator</p>
            </div>
          </div>

          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <div className="grid grid-cols-[150px_44px_1fr] gap-2 bg-muted/50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Elemen</span>
              <span>TP</span>
              <span>Tujuan Pembelajaran</span>
            </div>
            {PREVIEW.map((r) => (
              <div key={r.tp} className="grid grid-cols-[150px_44px_1fr] items-center gap-2 border-t border-border px-2.5 py-1">
                <span className="truncate text-xs">{r.element}</span>
                <span className="text-xs font-medium">{r.tp}</span>
                <span className="truncate text-xs text-muted-foreground">{r.text}</span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">… dan 21 TP lainnya akan ikut disimpan.</p>
        </div>

        <div className="flex justify-end gap-1.5 px-4 pb-3 pt-2">
          <span className="flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium">Mulai ulang</span>
          <span className="flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Konfirmasi &amp; simpan</span>
        </div>
      </Float>
    </Stage>
  );
}
