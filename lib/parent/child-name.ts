/**
 * The short name the parent portal calls a child by: the nickname the school
 * recorded, else the first word of the legal name. Pure (no prisma) so client
 * components can import it — `lib/parent-helpers.ts` cannot be.
 *
 * Journal, invoice sheet, attendance banner and the child tabs all route
 * through this rule, so one child is never "Zafran" on one screen and
 * "Ahmad" on the next.
 */
export function childShortName(child: {
  name: string;
  nickname?: string | null;
}): string {
  const nickname = child.nickname?.trim();
  if (nickname) return nickname;
  const full = child.name.trim();
  return full.split(/\s+/)[0] || full;
}
