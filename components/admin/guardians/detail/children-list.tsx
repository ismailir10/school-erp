import { EntityLink } from "@/components/entity-link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { REL_LABELS } from "@/lib/constants/parent-options";
import { entityHref } from "@/lib/entity-links";
import { formatRupiah } from "@/lib/format";
import type { GuardianChild } from "./types";

const GENDER_LABEL: Record<string, string> = { L: "Laki-laki", P: "Perempuan" };

/**
 * Anak Terdaftar rows. Each one answers "which class, and what do they owe"
 * without a click into the student. The owed badge uses the late (amber) tone:
 * whether a child has an overdue invoice is not knowable from here, so this
 * does not claim the red "absent" tone.
 */
export function ChildrenList({ guardians }: { guardians: GuardianChild[] }) {
  return (
    <ul className="space-y-0">
      {guardians.map((g) => {
        const gender = g.student.gender ? GENDER_LABEL[g.student.gender] : undefined;
        return (
          <li key={g.id}>
            {/* Name and class are separate links (no row-wide anchor around
                another link): student page and class page. */}
            <div className="-mx-2 flex flex-col gap-2 rounded-md border-b border-border/50 px-2 py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <EntityLink href={entityHref.student(g.student.id)} touch className="min-w-0 break-words text-sm">
                    {g.student.name}
                  </EntityLink>
                  <Badge variant="outline" className="text-xs">
                    {REL_LABELS[g.relationship] ?? g.relationship}
                  </Badge>
                  {g.isPrimary && <Badge className="bg-primary/10 text-xs text-primary-text">Utama</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {g.student.className ? (
                    <EntityLink
                      href={g.student.classSectionId ? entityHref.class(g.student.classSectionId) : null}
                      tone="muted"
                    >
                      {g.student.className}
                    </EntityLink>
                  ) : (
                    "Belum terdaftar di kelas"
                  )}
                  {gender ? ` · ${gender}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {g.outstanding > 0 && (
                  <Badge
                    variant="secondary"
                    className="border-transparent bg-status-late-subtle font-currency text-xs text-status-late-text"
                  >
                    {formatRupiah(g.outstanding)}
                  </Badge>
                )}
                <StatusBadge status={g.student.status} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
