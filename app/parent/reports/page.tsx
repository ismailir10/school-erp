import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChildSelectorTabs } from "@/components/parent/child-selector-tabs";
import {
  getParentWithChildren,
  getPublishedReportCardsForStudent,
  resolveSelectedChild,
} from "@/lib/parent-helpers";
import { ReportCardsList } from "@/app/parent/report-cards-list";
import { PageHeader } from "@/components/portal/page-header";
import { ContextStrip } from "@/components/portal/context-strip";

export default async function ParentReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN" || !session.tenantId) redirect("/");

  const { parent, children } = await getParentWithChildren(session);
  if (!parent || children.length === 0) redirect("/parent");

  const params = await searchParams;
  const selected = resolveSelectedChild(children, params.child);
  if (!selected) redirect("/parent");

  // Published admin-authored raports (ReportCardEntry) for this child — the
  // legacy StudentAssessment read path is gone.
  const reportCards = await getPublishedReportCardsForStudent(
    selected.studentId,
    session.tenantId,
  );

  const childTabsData = children.map((c) => ({
    studentId: c.studentId,
    studentName: c.studentName,
    studentNickname: c.studentNickname,
    className: c.className,
  }));

  return (
    <div>
      <ChildSelectorTabs
        items={childTabsData}
        selectedChildId={selected.studentId}
        sticky
      />

      <ContextStrip
        name={selected.studentName}
        detail={[selected.className, selected.programName].filter(Boolean).join(" · ") || "Rapor anak terpilih"}
        className="mb-6 rounded-lg border-x border-t"
      />

      <PageHeader title="Rapor" subtitle="Laporan perkembangan tiap triwulan" />

      <ReportCardsList
        data={reportCards}
        studentId={selected.studentId}
        childName={selected.studentNickname ?? selected.studentName.split(" ")[0]}
      />
    </div>
  );
}
