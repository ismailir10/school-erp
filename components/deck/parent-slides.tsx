import { CoverArt } from "./cover-art";
import type { Slide } from "./types";

/*
 * The parent tour, presented at parent meetings and reopened from Profil. Parent register
 * (.claude/standards/voice.md): warmest of the three, child-framed, gentle on money.
 */
export const PARENT_SLIDES: Slide[] = [
  {
    id: "sampul",
    nav: "Sampul",
    kicker: "Panduan orang tua",
    title: "Talib untuk Ayah dan Bunda",
    lead: "Kabar sekolah anak, dari kehadiran sampai rapor dan tagihan, dalam satu portal di ponsel.",
    variant: "cover",
    art: <CoverArt />,
  },
];
