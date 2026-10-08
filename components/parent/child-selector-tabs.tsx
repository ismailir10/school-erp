"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PortalTabs, type PortalTab } from "@/components/portal/portal-tabs";
import { parentHref } from "@/lib/parent/navigation";
import { childShortName } from "@/lib/parent/child-name";
import { ChildParamNotice } from "@/components/parent/child-param-notice";

type ChildInfo = {
  studentId: string;
  studentName: string;
  /** Pass through so the tab reads like the rest of the portal ("Zafran", not "Ahmad"). */
  studentNickname?: string | null;
  className: string | null;
};

export function ChildSelectorTabs({
  items,
  selectedChildId,
  sticky = false,
}: {
  items: ChildInfo[];
  selectedChildId: string;
  /**
   * When true, pins the child switcher below `PortalHeader` so it stays
   * visible while inner-tab content scrolls. Use on child-detail routes
   * (invoices, attendance, reports) per design-system.html §14 Option C.
   */
  sticky?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = items.find((child) => child.studentId === selectedChildId);
  const notice = selected ? (
    <ChildParamNotice
      knownIds={items.map((child) => child.studentId)}
      selectedChildId={selectedChildId}
      selectedName={childShortName({ name: selected.studentName, nickname: selected.studentNickname })}
    />
  ) : null;

  if (items.length <= 1) return notice;

  const tabs: PortalTab[] = items.map((child) => {
    // Pill label = short name only (nickname, else first word) — same rule as
    // journal / invoice sheet / attendance banner. Frame 4/8/11 of cycle-4
    // prototype. Full name + class would overflow at 375px and the class chip
    // rendered in a contrasting tone breaks the active-pill (teal-on-teal) palette.
    return {
      id: child.studentId,
      label: childShortName({ name: child.studentName, nickname: child.studentNickname }),
    };
  });

  const handleSelect = (id: string) => {
    if (!items.some((child) => child.studentId === id)) return;
    const local = Object.fromEntries(new URLSearchParams(searchParams.toString()));
    router.push(parentHref(pathname, id, local));
  };

  return (
    <>
      {notice}
      <div className={sticky ? "mb-4" : "mb-4 -mx-1 px-1"}>
        <PortalTabs
          items={tabs}
          activeId={selectedChildId}
          onSelect={handleSelect}
          variant="pills"
          ariaLabel="Pilih anak"
          sticky={sticky}
        />
      </div>
    </>
  );
}
