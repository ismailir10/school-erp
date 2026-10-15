import { cn } from "@/lib/utils";

/** Slide 10 — who can open what, by default. Derived from lib/permissions.ts and the portal layouts. */
type Level = "full" | "part" | "none";

const COLUMNS = ["Pemilik", "Admin sekolah", "Guru"] as const;

const ROWS: { area: string; levels: [Level, Level, Level]; note?: string }[] = [
  { area: "Siswa dan pendaftaran", levels: ["full", "full", "part"], note: "guru: kelasnya" },
  { area: "Kehadiran siswa", levels: ["full", "full", "part"], note: "guru: kelasnya" },
  { area: "Penilaian dan kurikulum", levels: ["full", "part", "part"], note: "admin: baca dan koreksi" },
  { area: "Rapor", levels: ["full", "full", "none"] },
  { area: "Tagihan dan pembayaran", levels: ["full", "full", "none"] },
  { area: "Pegawai dan gaji", levels: ["full", "none", "part"], note: "guru: data sendiri" },
  { area: "Pengaturan dan pengguna", levels: ["full", "full", "none"] },
];

function Mark({ level, label }: { level: Level; label: string }) {
  return (
    <span className="grid place-items-center">
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" focusable="false">
        {level === "full" && <circle cx="10" cy="10" r="6.5" className="fill-primary" />}
        {level === "part" && (
          <>
            <circle cx="10" cy="10" r="6.5" className="fill-none stroke-primary-text" strokeWidth="1.6" />
            <path d="M10 3.5 a6.5 6.5 0 0 1 0 13 z" className="fill-primary" />
          </>
        )}
        {level === "none" && <path d="M6 10 h8" className="stroke-foreground/30" strokeWidth="1.6" strokeLinecap="round" />}
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

const LEVEL_LABEL: Record<Level, string> = {
  full: "Akses penuh",
  part: "Akses terbatas",
  none: "Tidak ada akses",
};

export function AccessMatrix() {
  return (
    <div>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Akses awal tiap peran pada tiap bagian Talib</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="pb-3 pr-2 font-medium">
              Bagian
            </th>
            {COLUMNS.map((c) => (
              <th key={c} scope="col" className="px-1 pb-3 text-center font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={r.area} className={cn(i > 0 && "border-t border-border/70")}>
              <th scope="row" className="py-2.5 pr-2 font-medium">
                {r.area}
                {r.note && (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{r.note}</span>
                )}
              </th>
              {r.levels.map((l, j) => (
                <td key={j} className="px-1 py-2.5">
                  <Mark level={l} label={LEVEL_LABEL[l]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
        {(["full", "part", "none"] as const).map((l) => (
          <li key={l} className="flex items-center gap-1.5" aria-hidden="true">
            <Mark level={l} label="" />
            {LEVEL_LABEL[l]}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Ini akses awal tiap peran. Peran khusus bisa disusun di Pengaturan, Peran dan izin.
      </p>
    </div>
  );
}
