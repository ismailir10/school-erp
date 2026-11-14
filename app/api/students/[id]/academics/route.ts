import { hasPermission } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { coveragePercent, joinRaportByTerm, tallyRaport, termLabel } from "@/lib/student/overview";
import {
  loadIndicatorTotals,
  loadRaportEntries,
  loadTermPenilaian,
  loadTerms,
  pickCurrentTerm,
  pickPenilaianTerms,
  resolveStudentAgeGroup,
} from "@/lib/student/dossier-aggregates";

/**
 * GET /api/students/[id]/academics — one row per term: raport state plus the
 * term's penilaian coverage.
 *
 * Read-only and aggregates-only, like `/overview`. The Akademik section it
 * feeds owns no writes at all — authoring a raport lives on `/admin/report-cards` and
 * recording penilaian lives with the teacher, so each row deep-links out rather
 * than growing an editor here.
 *
 * Query budget, deliberately bounded:
 *   1 × terms · 1 × report cards (all terms, joined in JS) · 1 × age group
 *   · 1 × indicator denominators (all semesters in play, one groupBy)
 *   · 1 × penilaian per term **of the active academic year only**.
 * Terms outside that year return `penilaian: null` and the UI says "tidak
 * dihitung" rather than printing a 0% that means "not computed". Without the
 * cap the route would fan out one aggregate query per term ever created.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role) || !hasPermission(session, "students.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const tenantId = session.tenantId;

  const student = await prisma.student.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [terms, raportEntries, ageGroup] = await Promise.all([
    loadTerms(tenantId),
    loadRaportEntries(tenantId, id),
    resolveStudentAgeGroup(tenantId, id),
  ]);

  const penilaianTerms = pickPenilaianTerms(terms);
  const penilaianTermIds = new Set(penilaianTerms.map((t) => t.id));

  const [penilaianByTerm, indicatorTotals] = await Promise.all([
    Promise.all(
      penilaianTerms.map(async (term) => [term.id, await loadTermPenilaian(tenantId, id, term)] as const),
    ),
    loadIndicatorTotals(
      tenantId,
      [...new Set(penilaianTerms.map((t) => t.semesterId))],
      ageGroup,
    ),
  ]);
  const penilaian = new Map(penilaianByTerm);

  const rows = joinRaportByTerm(terms, raportEntries).map((row) => {
    const term = terms.find((t) => t.id === row.term.id)!;
    if (!penilaianTermIds.has(term.id)) {
      return { ...row, label: termLabel(row.term), penilaian: null };
    }
    const counts = penilaian.get(term.id) ?? { entryCount: 0, indicatorsAssessed: 0 };
    const indicatorsTotal = indicatorTotals.get(term.semesterId) ?? 0;
    return {
      ...row,
      label: termLabel(row.term),
      penilaian: {
        entryCount: counts.entryCount,
        indicatorsAssessed: counts.indicatorsAssessed,
        indicatorsTotal,
        coveragePct: coveragePercent(counts.indicatorsAssessed, indicatorsTotal),
      },
    };
  });

  const currentTerm = pickCurrentTerm(terms);

  return NextResponse.json({
    data: {
      // Null when the student holds no active enrolment — the UI states that as
      // the reason coverage is a dash instead of implying zero work was done.
      ageGroup,
      currentTermId: currentTerm?.id ?? null,
      tally: tallyRaport(rows),
      // Newest first: the term an admin is working on is the one they want.
      rows: rows.slice().reverse(),
    },
  });
}
