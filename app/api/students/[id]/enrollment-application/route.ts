import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, isAdminRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { redactConsentSignatures } from "@/lib/enrollment/sanitize-consent";
import { toAdminDocuments } from "@/lib/enrollment/documents";

/**
 * GET /api/students/[id]/enrollment-application — the original pendaftaran form
 * this student was converted from, read-only.
 *
 * The paper form carries far more than `convert` copies onto the Student and
 * Parent rows: the father's and mother's employer blocks, the birth
 * circumstances, the family's prior attendees, and the signed consent letter.
 * All of it was reachable only if an admin already knew the application existed
 * and clicked through the provenance link in the rail — so in practice it was
 * orphaned the moment the student record was created.
 *
 * Resolved by **`EnrollmentApplication.studentId`**, the FK `convert` sets
 * inside its transaction — not by the `fromEnrollmentApplication` pointer in
 * `Student.metadata`. The metadata copy is a display convenience an admin can
 * edit; the FK is the record.
 *
 * 404 when this student did not come from a form (a hand-entered student), so
 * the dossier can simply omit the section.
 *
 * Admin-only, tenant-scoped. Closed-set `select`: `accessToken` and
 * `tokenExpiresAt` are the parent's unguessable form credentials and have no
 * business on an admin page payload. `consentData` embeds a signature
 * storage token per parent, redacted to a presence boolean before it leaves
 * this route — see lib/enrollment/sanitize-consent.ts. `documents` is the same
 * kind of thing: the raw column holds a storage token per file, so it goes out
 * as `toAdminDocuments(...)` (presence + metadata, never `fileToken`).
 * `canEditDocuments` tells the page whether to offer the staff tick.
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

  // findFirst on (studentId, tenantId) rather than findUnique on studentId
  // alone: the tenant predicate belongs in the query, not in a check after it.
  const application = await prisma.enrollmentApplication.findFirst({
    where: { studentId: id, tenantId: session.tenantId },
    select: {
      id: true,
      status: true,
      childName: true,
      parentEmail: true,
      dcareAddon: true,
      submittedAt: true,
      createdAt: true,
      studentData: true,
      ayahData: true,
      ibuData: true,
      consentData: true,
      documents: true,
      program: { select: { id: true, name: true } },
      admission: {
        select: { id: true, parentName: true, parentPhone: true, parentRelationship: true },
      },
    },
  });

  if (!application) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      ...application,
      consentData: redactConsentSignatures(application.consentData),
      documents: toAdminDocuments(application.documents),
      canEditDocuments: hasPermission(session, "admissions.edit"),
    },
  });
}
