import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, homePathForRole } from "@/lib/auth";
import { Deck } from "@/components/deck/deck";
import { SLIDES } from "@/components/deck/slides";

export const metadata: Metadata = {
  title: "Panduan Talib",
  description: "Tur singkat modul-modul Talib untuk admin dan guru.",
};

/**
 * Product tour for staff. The proxy already sends signed-out requests to "/"; this guard adds the
 * role check, because parents hold sessions too. Slide content is rendered only after it passes, so
 * a signed-out or parent request never receives it. No data is read: the deck is static copy.
 */
export default async function PanduanPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role === "GUARDIAN") redirect(homePathForRole(session.role));

  const isTeacher = session.role === "TEACHER";
  return (
    <Deck
      slides={SLIDES}
      homeHref={homePathForRole(session.role)}
      homeLabel={isTeacher ? "Beranda guru" : "Dasbor admin"}
    />
  );
}
