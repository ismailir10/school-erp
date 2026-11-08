import type { Metadata } from "next";
import { getSession, isAdminRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { AdminWorkQueue } from "@/components/admin/dashboard/admin-work-queue";
import { buildAdminWorkQueue, summarizeQueue, unavailableAdminQueueSections, type AdminWorkKind } from "@/lib/dashboard/admin-work-queue";
import { loadAdminQueueSources } from "@/lib/dashboard/queue-sources";

export const metadata: Metadata = { title: "Antrean Pekerjaan" };

const VALID_KINDS: readonly AdminWorkKind[] = ["inquiry", "enrollment", "leave", "invoice", "payroll"];

function parseKind(value: string | undefined): AdminWorkKind | undefined {
  return VALID_KINDS.includes(value as AdminWorkKind) ? (value as AdminWorkKind) : undefined;
}

export default async function AdminWorkQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await getSession();
  if (!session || !isAdminRole(session.role) || !session.tenantId) redirect("/");

  const params = await searchParams;
  const initialKind = parseKind(params.kind);
  const tenantId = session.tenantId;

  const sources = await loadAdminQueueSources({ ...session, tenantId }, { take: 200 });
  const items = buildAdminWorkQueue(sources);
  const unavailable = unavailableAdminQueueSections(sources);
  const totalCount = summarizeQueue(sources).total;

  return <>
    <PageHeader title="Antrean pekerjaan" description="Semua pekerjaan yang menunggu keputusan Anda." />
    <AdminWorkQueue items={items} unavailable={unavailable} initialKind={initialKind} totalCount={totalCount} />
  </>;
}
