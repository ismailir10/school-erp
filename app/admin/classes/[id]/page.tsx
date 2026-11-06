import type { Metadata } from "next";
import { assertPermission } from "@/lib/auth-guards";
import { hasPermission } from "@/lib/permissions";
import { ClassDetailClient } from "./client";

export const metadata: Metadata = { title: "Detail Kelas" };

// Admin Kelas detail — the consolidated per-class hub that mirrors the old
// /admin/class-sections/[id] surface and folds in roster + teaching
// assignments + ringkasan health metrics into a Recipe 2b "dossier" (see
// .claude/standards/patterns.md — classes/[id] was the retrofit backlog
// entry named alongside guardians/[id] and employees/[id]). ClassTrack stays
// in the schema as plumbing; the UI vocabulary is "Kelas".
//
// Server-side `academic.view` gate; write actions (`academic.edit`) are
// resolved here and passed as `canWrite` so read-only personas see the
// content but not the mutate buttons. Body is client-side because every
// section is interactive (dialogs, calendar, swap drawer).
//
// Cross-checked against .claude/standards/design-system.html §Page header +
// §DataTable + §Dialog + §Calendar grid + §Sheet (frontend gate); dossier
// chrome (DetailPageHeader/DossierNav/DossierSection/DetailRail) matches
// app/admin/students/[id]/page.tsx.
export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await assertPermission("academic.view");
  const { id } = await params;
  return (
    <ClassDetailClient
      classId={id}
      canWrite={hasPermission(session, "academic.edit")}
    />
  );
}
