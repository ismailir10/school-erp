import Image from "next/image";

/** Parent deck cover — the school's own photo; no figures, parents came for their child, not for the school's size. */
export function ParentCoverArt() {
  return (
    <figure>
      <Image
        src="/school/area-bermain.webp"
        alt="Area bermain An Nisaa' Sekolahku"
        width={960}
        height={720}
        priority
        sizes="(min-width: 1024px) 480px, calc(100vw - 40px)"
        className="aspect-[16/11] w-full rounded-3xl object-cover outline -outline-offset-1 outline-black/10 sm:aspect-[4/3]"
      />
    </figure>
  );
}
