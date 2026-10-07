import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentPeriodFromDb } from "@/lib/academic-period-db";
import { EmptyState } from "@/components/ui/empty-state";
import { ClipboardList, ChevronRight, CalendarDays, Building2 } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/portal/page-header";
import { SectionLabel } from "@/components/portal/section-label";
import { getHomeroomClassSection } from "@/lib/curriculum/homeroom";
import {
  ALL_LEARNING_CENTERS,
  formatLearningCenter,
} from "@/lib/format";

export default async function TeacherAssessmentsPage() {
  const session = await getSession();
  if (!session || session.role !== "TEACHER") redirect("/");
  if (!session.tenantId || !session.employeeId) {
    return (
      <div>
        <EmptyState
          icon={ClipboardList}
          title="Akun belum terhubung dengan staf"
          description="Hubungi admin agar akun Anda dipasangkan dengan data karyawan."
          actionLabel="Kembali ke beranda"
          actionHref="/teacher"
        />
      </div>
    );
  }

  // FIND-017: derive the periode subheader from the active AcademicYear in
  // the DB, not from a wall-clock calendar bracket. Pre-fix the calendar
  // helper hardcoded "Semester 2 2025/2026" even when the active AY was
  // 2026/2027.
  const activeAy = await prisma.academicYear.findFirst({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  // Walas detection — gates the "Penilaian Pekanan" card. Sentra card is
  // visible to every teacher (sentra rotation deferred per design §3.1).
  const homeroom = activeAy
    ? await getHomeroomClassSection(
        session.tenantId,
        session.employeeId,
        activeAy.id,
      )
    : null;
  // m3: the semester half used to track the calendar month (Jul-Dec = Sem 1),
  // which put the teacher header on "Semester 1" while /admin/report-cards and
  // /parent/perkembangan both read "Semester 2" off the DB row that actually
  // owns the Weeks this page renders. Resolve it from the same rows they do.
  const period = await getCurrentPeriodFromDb(session.tenantId);

  // Does this teacher have any active class assignment? Drives the "no class"
  // empty state. Legacy AssessmentTemplate list retired — penilaian is now the
  // new IKTP flow only: walas Pekanan + sentra Harian.
  const assignmentCount = await prisma.teachingAssignment.count({
    where: {
      employeeId: session.employeeId,
      classSection: { tenantId: session.tenantId, status: "ACTIVE" },
    },
  });

  // TCHX-5: no class assignment only hides the walas (pekanan) part. Sentra
  // tiles are open to every teacher — the center page itself does not need an
  // assignment — so the notice sits above them instead of replacing them.
  const hasNoClass = assignmentCount === 0 && !homeroom;

  return (
    <div>
      <PageHeader title="Penilaian" subtitle={`Periode: ${period}`} />

      <div className="space-y-6">
        {hasNoClass && (
          <div
            role="status"
            data-testid="hub-no-class"
            className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-card"
          >
            <ClipboardList className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Belum ditugaskan ke kelas</p>
              <p className="text-xs text-muted-foreground">
                Penilaian pekanan muncul setelah Anda ditugaskan sebagai wali kelas. Sentra tetap bisa dinilai di bawah.
              </p>
            </div>
          </div>
        )}
        {homeroom && (
          <Link
            href="/teacher/assessments/weekly"
            className="flex min-h-11 items-center gap-3 p-card bg-card border border-border rounded-xl hover:border-primary/30 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="hub-weekly-card"
          >
            <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarDays className="size-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Penilaian pekanan</p>
              {/*
                Was one truncating line — "Walas DCARE · catat per pekan terh…"
                — which cut off exactly the half that explained anything.
              */}
              <p className="text-xs text-muted-foreground">
                Walas {homeroom.name} · catat IKTP per pekan
              </p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground shrink-0" />
          </Link>
        )}
        <div data-testid="hub-center-grid">
          <SectionLabel>Sentra harian</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {ALL_LEARNING_CENTERS.map((center) => (
              <Link
                key={center}
                href={`/teacher/assessments/center/${center.toLowerCase()}`}
                data-testid={`hub-center-${center.toLowerCase()}`}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card p-3 hover:border-primary/30 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Building2 className="size-4 text-primary" />
                </div>
                {/*
                  The eyebrow above already says "Sentra", and repeating it
                  eight times in a 2-column grid at 390px truncated half the
                  tiles ("Sentra Bahan Al…"). Strip the redundant prefix.
                */}
                <span className="min-w-0 truncate text-xs font-medium">
                  {formatLearningCenter(center).replace(/^Sentra /, "")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
