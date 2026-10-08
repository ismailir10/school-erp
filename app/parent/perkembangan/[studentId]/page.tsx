import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  CalendarOff,
  ChevronLeft,
  LineChart,
  Sparkles,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/portal/page-header";
import { SectionLabel } from "@/components/portal/section-label";
import { getParentChildById, getParentWithChildren } from "@/lib/parent-helpers";
import { loadStudentPerkembangan } from "@/lib/curriculum/perkembangan-loader";
import {
  formatDate,
  formatLearningCenter,
  formatCurriculumElement,
} from "@/lib/format";
import { ElementProgressRow } from "@/components/parent/element-progress-row";
import { LevelLegend } from "@/components/parent/level-legend";
import { LEVEL_LABEL_LONG, LEVEL_CHIP_CLASS_OFF } from "@/lib/curriculum/level-presentation";
import { ContextStrip } from "@/components/portal/context-strip";
import { parentHref } from "@/lib/parent/navigation";

export default async function ParentPerkembanganDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "GUARDIAN") redirect("/");
  if (!session.tenantId) redirect("/");

  const { studentId } = await params;
  const child = await getParentChildById(session, studentId);
  if (!child) notFound();
  const { children: linkedChildren } = await getParentWithChildren(session);

  const data = await loadStudentPerkembangan(session.tenantId, studentId);

  return (
    <div className="space-y-5">
      <Link
        href={linkedChildren.length > 1 ? "/parent/perkembangan" : parentHref("/parent", studentId)}
        className="inline-flex min-h-11 min-w-11 items-center gap-1 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" /> {linkedChildren.length > 1 ? "Pilih anak" : "Beranda"}
      </Link>

      <ContextStrip
        name={child.studentName}
        detail={[child.className, child.programName].filter(Boolean).join(" · ") || "Data perkembangan anak"}
        className="rounded-lg border-x border-t"
      />

      <PageHeader
        title="Perkembangan"
        subtitle="Catatan perkembangan dari sekolah"
      />

      {!data.semester ? (
        <EmptyState
          icon={LineChart}
          title="Semester belum aktif"
          description="Catatan akan muncul saat sekolah membuka semester berjalan."
        />
      ) : (
        <>
          <section
            className="space-y-2"
            aria-labelledby="perkembangan-elements-heading"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <SectionLabel as="h2" id="perkembangan-elements-heading" className="mb-0">
                Capaian per elemen
              </SectionLabel>
              <span className="min-w-0 break-words text-xs text-muted-foreground">
                Semester {data.semester.number} · {data.semester.academicYear.name}
              </span>
            </header>
            {/* voice.md documents the intent that "Belum"/"Perlu Penguatan"
                read as honest developmental notes rather than alarms — but
                that intent lived only in a code comment, so a parent seeing
                "Belum" next to their child's name could read it as a failing
                grade. Say it where they can actually see it. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Ini tahapan perkembangan, bukan nilai. Setiap anak berkembang di
              waktunya masing-masing.
            </p>
            <LevelLegend />
            <ul className="space-y-2" data-testid="perkembangan-elements">
              {data.elements.map((row) => (
                <ElementProgressRow
                  key={row.element}
                  element={row.element}
                  counts={row.counts}
                />
              ))}
            </ul>
          </section>

          <section
            className="space-y-2"
            aria-labelledby="perkembangan-pekan-heading"
          >
            <SectionLabel as="h2" id="perkembangan-pekan-heading" className="mb-0">
              Pekan ini
            </SectionLabel>
            {!data.hasActiveWeek ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 p-3 text-xs text-muted-foreground">
                <CalendarOff className="size-4" />
                Belum ada pekan aktif saat ini.
              </div>
            ) : data.latestThisWeek.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-input bg-muted/30 p-3 text-xs text-muted-foreground">
                <Sparkles className="size-4" />
                Belum ada catatan pekan ini.
              </div>
            ) : (
              <ul
                className="space-y-2"
                data-testid="perkembangan-latest-this-week"
              >
                {data.latestThisWeek.map((entry, idx) => (
                  <li
                    key={`${entry.date}-${entry.indicatorContent}-${idx}`}
                    className="rounded-lg border border-input bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {formatCurriculumElement(entry.element)}
                          {entry.source === "CENTER" && entry.center && (
                            <> · {formatLearningCenter(entry.center)}</>
                          )}
                        </p>
                        <p className="text-sm text-foreground mt-0.5">
                          {entry.indicatorContent}
                        </p>
                        {/* The walas types this at the sentra and it was
                            stored but never shown to anyone — it is the one
                            line that tells a parent what their child
                            actually did. */}
                        {entry.activity && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Kegiatan: {entry.activity}
                          </p>
                        )}
                      </div>
                      <span
                        className={`max-w-[45%] shrink-0 rounded-md px-2 py-0.5 text-right text-xs font-medium ${LEVEL_CHIP_CLASS_OFF[entry.level] ?? ""}`}
                      >
                        {LEVEL_LABEL_LONG[entry.level] ?? entry.level}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(entry.date, { day: "numeric", month: "long" })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
