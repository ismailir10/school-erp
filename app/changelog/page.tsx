import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, homePathForRole } from "@/lib/auth";
import { ChangelogView } from "@/components/changelog/changelog-view";
import { audienceForRole } from "@/lib/changelog/filter";
import { RELEASES } from "@/lib/changelog/releases";

export const metadata: Metadata = {
  title: "Apa yang Baru",
  description: "Pembaruan Talib untuk admin, guru, dan orang tua.",
};

const HOME_LABEL: Record<string, string> = {
  GUARDIAN: "Beranda orang tua",
  TEACHER: "Beranda guru",
};

/**
 * What changed in each release. Any signed-in role may read it. The proxy already sends signed-out
 * requests to "/"; the session check here keeps the page from rendering without one.
 */
export default async function ChangelogPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <ChangelogView
      releases={RELEASES}
      audience={audienceForRole(session.role)}
      homeHref={homePathForRole(session.role)}
      homeLabel={HOME_LABEL[session.role] ?? "Dasbor admin"}
    />
  );
}
