import Image from "next/image";
import { CountUp } from "@/components/reactbits/count-up";

/** Slide 1 — the school's own photo, and three plain facts. */
const FACTS = [
  { value: 2, suffix: "", label: "kampus" },
  { value: 40, suffix: "+", label: "guru" },
  { value: 500, suffix: "+", label: "siswa" },
];

export function CoverArt() {
  return (
    <figure className="relative">
      <Image
        src="/school/guru.webp"
        alt="Para guru An Nisaa' Sekolahku berfoto bersama di ruang kelas"
        width={960}
        height={720}
        priority
        sizes="(min-width: 1024px) 480px, calc(100vw - 40px)"
        className="aspect-[16/11] w-full rounded-3xl object-cover object-[50%_35%] outline -outline-offset-1 outline-black/10 sm:aspect-[4/3]"
      />
      <dl className="absolute inset-x-3 -bottom-5 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-card/95 py-3 shadow-card-elevated backdrop-blur-sm sm:inset-x-6">
        {FACTS.map((f) => (
          <div key={f.label} className="flex flex-col px-3 text-center sm:px-5">
            <dt className="order-2 mt-0.5 text-xs text-muted-foreground">{f.label}</dt>
            <dd className="order-1 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
              <CountUp value={f.value} />
              {f.suffix}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
