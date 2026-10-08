import { normaliseEmail, normalisePhone } from "@/lib/parent/match";
import type { MatchReason, ParentTable } from "@/lib/parent/match";

// normalisePhone moved to lib/parent/match.ts once the admin "Tambah Wali"
// duplicate guard needed it too. Re-exported here — along with MatchReason and
// the narrowed ParentTable prisma surface — so existing importers and
// sibling-detect.test.ts keep resolving them from this module.
export { normalisePhone };
export type { MatchReason, ParentTable };

export type DetectSiblingInput = {
  tenantId: string;
  parentEmail?: string | null;
  parentPhone?: string | null;
  /** Compared like a phone: an applicant's WhatsApp often matches the guardian's phone and vice versa. */
  parentWhatsapp?: string | null;
};

export type DetectSiblingResult = {
  parentId: string;
  matchReason: MatchReason;
};

/**
 * Detect whether an applicant (public /daftar or admin-entered) matches an
 * existing Parent in the same tenant. Precedence: email > phone/WhatsApp.
 * Applicant phone and WhatsApp are both compared against both the Parent's
 * phone and WhatsApp (digits-normalised), since the same number is often
 * typed into either field. Tenant-scoped on every query. Returns null when no
 * match (caller treats as the no-sibling case).
 *
 * The lib does NO writes — caller decides whether to persist the match via
 * prisma.admission.update. Failures inside the lib propagate; the route
 * handler wraps the call in try/catch and swallows so admission.create stays
 * authoritative for the 201 response.
 */
export async function detectSibling(
  input: DetectSiblingInput,
  prisma: ParentTable
): Promise<DetectSiblingResult | null> {
  const { tenantId, parentEmail, parentPhone, parentWhatsapp } = input;

  if (parentEmail) {
    const normEmail = normaliseEmail(parentEmail);
    if (normEmail) {
      const emailMatch = await prisma.parent.findFirst({
        where: { tenantId, status: "ACTIVE", email: normEmail },
        select: { id: true },
      });
      if (emailMatch) {
        return { parentId: emailMatch.id, matchReason: "email" };
      }
    }
  }

  const applicantNumbers = new Set<string>();
  for (const raw of [parentPhone, parentWhatsapp]) {
    const norm = raw ? normalisePhone(raw) : "";
    if (norm) applicantNumbers.add(norm);
  }

  if (applicantNumbers.size > 0) {
    const candidates = await prisma.parent.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
        OR: [{ phone: { not: null } }, { whatsapp: { not: null } }],
      },
      select: { id: true, phone: true, whatsapp: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    for (const p of candidates) {
      for (const stored of [p.phone, p.whatsapp]) {
        if (stored && applicantNumbers.has(normalisePhone(stored))) {
          return { parentId: p.id, matchReason: "phone" };
        }
      }
    }
  }

  return null;
}
