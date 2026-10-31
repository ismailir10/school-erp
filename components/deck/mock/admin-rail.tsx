import Image from "next/image";
import { ClipboardCheck, GraduationCap, LayoutDashboard, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const RAIL = [LayoutDashboard, GraduationCap, ClipboardCheck, Wallet, Users];

/** The admin sidebar collapsed to its icon rail, as the deck's admin mocks draw it; `active` is the lit icon's index. */
export function AdminRail({ active }: { active: number }) {
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-2 bg-sidebar py-3">
      <Image src="/logo.png" alt="" width={22} height={22} className="mb-2 rounded-md" />
      {RAIL.map((Icon, i) => (
        <span
          key={i}
          className={cn("grid size-7 place-items-center rounded-md", i === active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground")}
        >
          <Icon className="size-4" />
        </span>
      ))}
    </div>
  );
}
