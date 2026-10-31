import { Stagger, StaggerItem } from "@/components/reactbits/stagger";

/** Staff deck, last slide — the first week in Talib, per role. Real HTML: it is a checklist people read. */
const COLUMNS: { who: string; items: string[] }[] = [
  {
    who: "Admin",
    items: [
      "Buka Dasbor setiap pagi, selesaikan yang ada di Perlu ditangani",
      "Periksa Pendaftaran: formulir masuk dan yang belum bayar",
      "Cek Tagihan: Perlu link, Lewat tempo, Perlu dicek",
      "Kirim Pengingat WhatsApp sebelum jatuh tempo",
    ],
  },
  {
    who: "Guru",
    items: [
      "Catat masuk dari Beranda saat tiba",
      "Isi absensi kelas di awal hari",
      "Centang Buku Penghubung, minimal satu indikator per anak",
      "Isi penilaian pekanan atau sentra hari itu",
    ],
  },
];

export function FirstSteps() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {COLUMNS.map((c) => (
        <section key={c.who} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-primary-text">{c.who}</h3>
          <Stagger as="ol" count={c.items.length} className="mt-3 grid gap-2.5">
            {c.items.map((item, i) => (
              <StaggerItem key={item} as="li" className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 text-sm leading-snug">
                <span
                  aria-hidden="true"
                  className="grid size-5 place-items-center rounded-full bg-secondary text-[0.7rem] font-semibold tabular-nums text-primary-text"
                >
                  {i + 1}
                </span>
                <span>{item}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      ))}
    </div>
  );
}
