import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LineChart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { TaskList, TaskRow } from "@/components/portal/task-list";
import { getParentWithChildren } from "@/lib/parent-helpers";
import { resolveParentChildId } from "@/lib/parent/navigation";

export const metadata: Metadata = { title: "Perkembangan" };

export default async function ParentPerkembanganListPage({ searchParams }: {
  searchParams: Promise<{ child?: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN") redirect("/");

  const { children } = await getParentWithChildren(session);
  const requestedChildId = (await searchParams).child;

  if (children.length === 0) {
    return (
      <div>
        <PageHeader
          title="Perkembangan"
          subtitle="Catatan harian dan pekanan dari sekolah"
        />
        <EmptyState
          accent="warm"
          icon={LineChart}
          title="Belum ada anak terdaftar"
          description="Hubungi admin sekolah untuk menautkan akun Anda dengan data anak."
        />
      </div>
    );
  }

  // Single-kid → auto-redirect for the canonical "I just want to see my
  // kid's progress" flow per design §5.3.
  if (children.length === 1 || (requestedChildId && children.some((child) => child.studentId === requestedChildId))) {
    const childId = resolveParentChildId(children.map((child) => child.studentId), requestedChildId);
    redirect(`/parent/perkembangan/${childId}`);
  }

  return (
    <div>
      <PageHeader
        title="Perkembangan"
        subtitle="Pilih anak untuk melihat catatan"
      />
      <div data-testid="perkembangan-children-list">
        <TaskList>
          {children.map((child) => (
            <TaskRow
              key={child.studentId}
              href={`/parent/perkembangan/${child.studentId}`}
              title={child.studentName}
              description={[child.className, child.programName].filter(Boolean).join(" · ") || "Kelas belum tersedia"}
              icon={<LineChart className="size-5" />}
            />
          ))}
        </TaskList>
      </div>
    </div>
  );
}
