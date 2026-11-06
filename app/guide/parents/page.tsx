import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, homePathForRole } from "@/lib/auth";
import { Deck } from "@/components/deck/deck";
import { PARENT_SLIDES } from "@/components/deck/parent-slides";

export const metadata: Metadata = {
  title: "Panduan Talib untuk orang tua",
  description: "Tur singkat portal orang tua Talib.",
};

const HOME_LABEL: Record<string, string> = {
  GUARDIAN: "Beranda orang tua",
  TEACHER: "Beranda guru",
};

/**
 * The parent tour. Unlike the staff tour, every signed-in role may open it: admins present it at parent
 * meetings from their own account, and a parent can reopen it from Profil. The proxy already sends
 * signed-out requests to "/"; the session check here keeps the deck from rendering without one.
 */
export default async function PanduanOrangTuaPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <Deck
      slides={PARENT_SLIDES}
      title="Panduan orang tua"
      homeHref={homePathForRole(session.role)}
      homeLabel={HOME_LABEL[session.role] ?? "Dasbor admin"}
    />
  );
}
