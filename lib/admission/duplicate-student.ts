/**
 * Students that look like the child being converted from a pendaftaran.
 *
 * Same name (case-insensitive in SQL, whitespace-collapsed in memory) AND either the same date of
 * birth or a guardian who shares a phone/WhatsApp or email with one of the
 * application's parent blocks. A bare name match is NOT enough: common names
 * repeat across families, and a warning that fires on strangers trains staff to
 * dismiss it. Server-only; every query is tenant-scoped.
 *
 * The result is what the convert route returns to the browser, so it carries
 * names and the date of birth only: never NIK, phone or email.
 */

import { prisma } from "@/lib/db";
import { normaliseEmail, normaliseName, normalisePhone } from "@/lib/parent/match";

export type DuplicateStudentProbe = {
  childName: string;
  dateOfBirth: string | null;
  /** Phone numbers of the application's Ayah / Ibu blocks. */
  phones: Array<string | null | undefined>;
  /** Emails of the application's Ayah / Ibu blocks. */
  emails: Array<string | null | undefined>;
};

export type DuplicateStudentCandidate = {
  id: string;
  name: string;
  dateOfBirth: string | null;
  guardianNames: string[];
};

const MAX_CANDIDATES = 5;

export async function findDuplicateStudents(
  tenantId: string,
  probe: DuplicateStudentProbe,
): Promise<DuplicateStudentCandidate[]> {
  const wanted = normaliseName(probe.childName);
  if (!wanted) return [];

  const rows = await prisma.student.findMany({
    where: { tenantId, name: { equals: probe.childName.trim(), mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      guardians: {
        select: { parent: { select: { name: true, phone: true, whatsapp: true, email: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const phones = new Set(probe.phones.map((p) => (p ? normalisePhone(p) : "")).filter(Boolean));
  const emails = new Set(probe.emails.map((e) => (e ? normaliseEmail(e) : "")).filter(Boolean));

  return rows
    .filter((c: (typeof rows)[number]) => {
      if (normaliseName(c.name) !== wanted) return false;
      if (probe.dateOfBirth && c.dateOfBirth && probe.dateOfBirth === c.dateOfBirth) return true;
      return c.guardians.some(
        (g: (typeof c.guardians)[number]) =>
          [g.parent.phone, g.parent.whatsapp].some((n) => n && phones.has(normalisePhone(n))) ||
          (g.parent.email ? emails.has(normaliseEmail(g.parent.email)) : false),
      );
    })
    .slice(0, MAX_CANDIDATES)
    .map((c: (typeof rows)[number]) => ({
      id: c.id,
      name: c.name,
      dateOfBirth: c.dateOfBirth,
      guardianNames: c.guardians.map((g: (typeof c.guardians)[number]) => g.parent.name),
    }));
}
