import Image from "next/image";
import { cn } from "@/lib/utils";

// Photos are the school's own and were chosen so that no child's face is the
// subject: teachers, a place, or children seen from behind or from above. They
// are served from /public/school (not hot-linked). Never re-crop one to enlarge
// a face, and never replace one with an unblurred photo of children.
const OUTLINE = "outline -outline-offset-1 outline-black/10 dark:outline-white/10";

/**
 * Hero photo for the public registration pages. "full" is the /daftar
 * version (capped ~200px tall on a phone); "slim" is the shorter banner on
 * the emailed invite form.
 */
export function SchoolHero({ variant = "full" }: { variant?: "full" | "slim" }) {
  const slim = variant === "slim";
  const photo = slim
    ? {
        src: "/school/area-bermain.webp",
        width: 960,
        height: 540,
        alt: "Area bermain dalam ruangan yang aman dan berwarna-warni",
      }
    : {
        src: "/school/guru.webp",
        width: 960,
        height: 720,
        alt: "Para guru An Nisaa' Sekolahku berfoto bersama di ruang kelas",
      };
  return (
    <figure className="mb-6 sm:mb-8">
      <Image
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        priority
        sizes="(min-width: 672px) 632px, calc(100vw - 40px)"
        className={cn(
          "w-full overflow-hidden rounded-2xl object-cover",
          OUTLINE,
          slim
            ? "aspect-[3/1] object-[50%_60%]"
            : "aspect-[16/9] object-[50%_35%] sm:aspect-[2/1]",
        )}
      />
      {!slim && (
        <figcaption className="mt-2 text-xs text-muted-foreground">
          Tim pengajar An Nisaa&apos; Sekolahku
        </figcaption>
      )}
    </figure>
  );
}

const GALLERY = [
  {
    src: "/school/manasik-haji.webp",
    width: 508,
    height: 330,
    caption: "Manasik haji",
    alt: "Anak-anak berpakaian putih mempraktikkan manasik haji di depan replika Ka'bah",
  },
  {
    src: "/school/tk-a.webp",
    width: 540,
    height: 720,
    caption: "Kegiatan TK A",
    alt: "Anak-anak TK A berbaring membentuk bintang di atas rumput, difoto dari atas",
  },
  {
    src: "/school/area-bermain.webp",
    width: 960,
    height: 540,
    caption: "Area bermain",
    alt: "Area bermain dalam ruangan yang aman dan berwarna-warni",
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
