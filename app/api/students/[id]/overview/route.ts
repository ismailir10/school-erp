import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import {
  orderInvoiceGroups,
  countAttendanceByStatus,
  coveragePercent,
  joinRaportByTerm,
  tallyRaport,
  termLabel,
} from "@/lib/student/overview";
import {
  currentJakartaMonth,
  loadIndicatorTotals,
  loadRaportEntries,
  loadTermPenilaian,
  loadTerms,
  pickCurrentTerm,
  resolveStudentAgeGroup,
} from "@/lib/student/dossier-aggregates";
import { documentProgress } from "@/lib/enrollment/documents";

/**
 * GET /api/students/[id]/overview — the student dossier's number tiles.
 *
 * **Aggregates only.** Every figure below is a `count`, a `groupBy` or a
 * presence boolean; not one row of a student's invoices, attendance or
 * penilaian crosses the wire. That is the whole point of the route: increments
 * 1 and 2 left the attendance and raport tiles out rather than ship them blank,
 * because filling them the naive way meant fetching a month of attendance rows
 * and a term of assessment rows on every student-detail view.
 *
 * Fired in parallel with the main `GET /api/students/[id]`, so it costs no
 * extra latency on the critical path.
 *
 * Admin-only, tenant-scoped — same gate as the sibling `/attendance` and
 * `/photo` routes on this student.
 *
 * NOT here: the outstanding balance. Increment 2 gave that exactly one owner
 * (`summarizeStudentInvoices`, shared with the parent portal), and a `groupBy`
 * sum cannot reproduce its per-invoice `remaining > 0` post-filter. This route
 * returns the per-status breakdown; the Tunggakan tile keeps reading the shared
 * summary. See `lib/student/overview.ts`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.tenantId || !isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const tenantId = session.tenantId;

  // Tenant check and the document-presence booleans in one closed-set select.
  // `guardians` is narrowed to two URL columns — this is a presence checklist,
  // not a place to re-ship the wali PII the main student route already gates.
  const student = await prisma.student.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      photoUrl: true,
      guardians: {
        where: { status: "ACTIVE" },
        select: { parent: { select: { ktpUrl: true, kkUrl: true } } },
      },
    },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const month = currentJakartaMonth();

  const [invoiceGroups, attendanceGroups, terms, raportEntries, ageGroup, application] =
    await Promise.all([
      prisma.invoice.groupBy({
        by: ["status"],
        where: { studentId: id, tenantId },
        _count: { _all: true },
        _sum: { totalDue: true, totalPaid: true },
      }),
      prisma.studentAttendance.groupBy({
        by: ["status"],
        // Voided rows are an admin's "this was marked wrong" — counting them
        // would put a phantom absence on the tile. The raport rollup filters
        // them the same way.
        where: { studentId: id, isVoided: false, date: { startsWith: month } },
        _count: { _all: true },
      }),
      loadTerms(tenantId),
      loadRaportEntries(tenantId, id),
      resolveStudentAgeGroup(tenantId, id),
      // Presence + provenance only (`documents` is reduced to a done/required
      // count below, never returned). The full form is its own route.
      prisma.enrollmentApplication.findFirst({
        where: { studentId: id, tenantId },
        select: { id: true, status: true, submittedAt: true, consentData: true, documents: true },
      }),
    ]);

  const currentTerm = pickCurrentTerm(terms);

  // Penilaian is scoped to the current term alone here — the rail tile answers
  // "how is this child being assessed right now". The per-term history lives on
  // /academics, which is lazy.
  const [penilaianCounts, indicatorTotals] = currentTerm
    ? await Promise.all([
        loadTermPenilaian(tenantId, id, currentTerm),
        loadIndicatorTotals(tenantId, [currentTerm.semesterId], ageGroup),
      ])
    : [null, new Map<string, number>()];

  const raportRows = joinRaportByTerm(terms, raportEntries);
  const raportTally = tallyRaport(raportRows);
  const currentRaport = currentTerm
    ? (raportRows.find((r) => r.term.id === currentTerm.id) ?? null)
    : null;

  const consent = (application?.consentData ?? {}) as { agreed?: unknown };

  return NextResponse.json({
    finance: {
      invoiceCount: invoiceGroups.reduce((n, g) => n + g._count._all, 0),
      byStatus: orderInvoiceGroups(
        invoiceGroups.map((g) => ({
          status: g.status,
          count: g._count._all,
          // Prisma hands back Decimal | null; the helper coerces.
          totalDue: g._sum.totalDue?.toString() ?? "0",
          totalPaid: g._sum.totalPaid?.toString() ?? "0",
        })),
      ),
    },
    attendance: {
      month,
      counts: countAttendanceByStatus(
        attendanceGroups.map((g) => ({ status: g.status, count: g._count._all })),
      ),
    },
    penilaian: currentTerm
      ? {
          term: { id: currentTerm.id, label: termLabel(currentTerm) },
          entryCount: penilaianCounts?.entryCount ?? 0,
          indicatorsAssessed: penilaianCounts?.indicatorsAssessed ?? 0,
          indicatorsTotal: indicatorTotals.get(currentTerm.semesterId) ?? 0,
          coveragePct: coveragePercent(
            penilaianCounts?.indicatorsAssessed ?? 0,
            indicatorTotals.get(currentTerm.semesterId) ?? 0,
          ),
        }
      : null,
    raport: {
      ...raportTally,
      current: currentRaport
        ? {
            termId: currentRaport.term.id,
            label: termLabel(currentRaport.term),
            status: currentRaport.status,
          }
        : null,
    },
    documents: {
      photo: !!student.photoUrl,
      kk: student.guardians.some((g) => !!g.parent.kkUrl),
      ktpPresent: student.guardians.filter((g) => !!g.parent.ktpUrl).length,
      ktpTotal: student.guardians.length,
      // "The parents signed the consent letter", not "a file exists".
      consent: consent.agreed === true,
      // Kelengkapan Berkas from the pendaftaran form: required items uploaded or
      // marked received. null for a student with no application.
      enrollment: application ? documentProgress(application.documents) : null,
    },
    enrollmentApplication: application
      ? {
          id: application.id,
          status: application.status,
          submittedAt: application.submittedAt ? application.submittedAt.toISOString() : null,
        }
      : null,
  });
}
