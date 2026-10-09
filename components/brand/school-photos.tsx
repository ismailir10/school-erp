import Image from "next/image";
import { cn } from "@/lib/utils";

// Photos come from the school's own website, faces already blurred by the
// school. They are served from /public/school (not hot-linked) and must be
// used as-is: never re-crop one to enlarge a face.
const OUTLINE = "outline -outline-offset-1 outline-black/10 dark:outline-white/10";

/**
 * Hero photo for the public registration pages. "full" is the /daftar
 * version (capped ~200px tall on a phone); "slim" is the shorter banner on
 * the emailed invite form.
 */
export function SchoolHero({ variant = "full" }: { variant?: "full" | "slim" }) {
  const slim = variant === "slim";
  return (
    <figure className="mb-6 sm:mb-8">
      <Image
        src="/school/suasana-kelas.webp"
        alt="Guru dan murid kelas Taman Aster menunjukkan kaos hasil lukisan mereka"
        width={960}
        height={540}
        priority
        sizes="(min-width: 672px) 632px, calc(100vw - 40px)"
        className={cn(
          "w-full overflow-hidden rounded-2xl object-cover",
          OUTLINE,
          slim ? "aspect-[3/1] object-[50%_35%]" : "aspect-[16/9] sm:aspect-[2/1]",
        )}
      />
      {!slim && (
        <figcaption className="mt-2 text-xs text-muted-foreground">
          Suasana belajar di An Nisaa&apos; Sekolahku
        </figcaption>
      )}
    </figure>
  );
}

const GALLERY = [
  {
    src: "/school/fun-cooking.webp",
    width: 960,
    height: 720,
    caption: "Fun cooking",
    alt: "Anak-anak memakai topi koki belajar memasak bersama guru",
  },
  {
    src: "/school/manasik-haji.webp",
    width: 508,
    height: 330,
    caption: "Manasik haji",
    alt: "Anak-anak berpakaian putih mempraktikkan manasik haji di depan replika Ka'bah",
  },
  {
    src: "/school/hari-profesi.webp",
    width: 500,
    height: 375,
    caption: "Hari profesi",
    alt: "Anak-anak berdandan sebagai berbagai profesi pada Hari Profesi",
  },
] as const;

/** Three-photo strip shown under the /daftar form. Always three columns. */
export function SchoolGallery() {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">
        Sekilas kegiatan di An Nisaa&apos; Sekolahku
      </h2>
      {/* role="list": Tailwind preflight removes bullets, which makes Safari/VoiceOver drop list semantics. */}
      <ul role="list" className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        {GALLERY.map((photo) => (
          <li key={photo.src}>
            <figure>
              <Image
                src={photo.src}
                alt={photo.alt}
                width={photo.width}
                height={photo.height}
                loading="lazy"
                sizes="(min-width: 672px) 210px, 30vw"
                className={cn("aspect-[4/3] w-full rounded-xl object-cover", OUTLINE)}
              />
              <figcaption className="mt-1.5 text-xs text-muted-foreground">
                {photo.caption}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
