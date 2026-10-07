import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getParentInvoiceList,
  getParentOutstandingForStudents,
  getParentWithChildren,
  resolveSelectedChild,
} from "@/lib/parent-helpers";
import { ChildSelectorTabs } from "@/components/parent/child-selector-tabs";
import { InvoicesClient } from "./client";
import { prisma } from "@/lib/db";
import { ContextStrip } from "@/components/portal/context-strip";

export default async function ParentInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; invoice?: string; paymentStatus?: string; xenditStatus?: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN" || !session.tenantId) redirect("/");

  const { parent, children } = await getParentWithChildren(session);
  if (!parent || children.length === 0) redirect("/parent");

  const params = await searchParams;
  let selected = resolveSelectedChild(children, params.child);
  // Gateway callbacks carry an invoice id but legacy sessions omit `child`.
  // Resolve only among this guardian's linked children before showing it.
  if (params.invoice) {
    const returnedInvoice = await prisma.invoice.findFirst({
      where: {
        id: params.invoice,
        tenantId: session.tenantId,
        studentId: { in: children.map((child) => child.studentId) },
      },
      select: { studentId: true },
    });
    if (returnedInvoice) selected = resolveSelectedChild(children, returnedInvoice.studentId);
  }
  if (!selected) redirect("/parent");

  const kidIds = children.map((c) => c.studentId);

  // Two parallel reads:
  // - getParentInvoiceList: cached, single-child, includes PAID for "Riwayat".
  // - getParentOutstandingForStudents: uncached, household-wide, drives the
  //   empty-state copy so it agrees with /parent's Tagihan tile (UAT INV-01).
  const [data, household] = await Promise.all([
    getParentInvoiceList(parent.id, selected.studentId, session.tenantId),
    getParentOutstandingForStudents(kidIds, session.tenantId),
  ]);

  const childTabsData = children.map((c) => ({
    studentId: c.studentId,
    studentName: c.studentName,
    studentNickname: c.studentNickname,
    className: c.className,
  }));

  // Per-child summary derived from the SAME household.items so the banner
  // above the row list cannot disagree with /parent's Tagihan tile by
  // construction. Earliest dueDate is selected as nearestDue (string compare
  // is safe for YYYY-MM-DD).
  const selectedItems = household.items.filter((i) => i.studentId === selected.studentId);
  const selectedChildSummary = {
    count: selectedItems.length,
    total: selectedItems.reduce((s, i) => s + i.remaining, 0),
    nearestDue: selectedItems.reduce<string | null>(
      (acc, i) => (acc === null || i.dueDate < acc ? i.dueDate : acc),
      null,
    ),
  };

  // Children whose outstanding count > 0, excluding the selected one — used by
  // the "Lunas untuk X · N untuk anak lain" branch of the empty state.
  const otherChildrenWithOutstanding = children
    .filter((c) => c.studentId !== selected.studentId)
    .map((c) => ({
      studentId: c.studentId,
      studentName: c.studentName,
      count: household.items.filter((i) => i.studentId === c.studentId).length,
    }))
    .filter((c) => c.count > 0);

  return (
    <div>
      <ChildSelectorTabs
        items={childTabsData}
        selectedChildId={selected.studentId}
        sticky
      />
      <ContextStrip
        name={selected.studentName}
        detail={[selected.className, selected.programName].filter(Boolean).join(" · ") || "Tagihan anak terpilih"}
        className="mb-6 rounded-lg border-x border-t"
      />
      <InvoicesClient
        data={data}
        selectedChildId={selected.studentId}
        selectedStudentName={selected.studentName}
        selectedChildSummary={selectedChildSummary}
        otherChildrenWithOutstanding={otherChildrenWithOutstanding}
      />
    </div>
  );
}
