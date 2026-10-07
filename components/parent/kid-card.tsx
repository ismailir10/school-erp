import type { ParentAttendanceStatus } from "@/lib/parent/attendance-summary";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { parentHref } from "@/lib/parent/navigation";
import { cn } from "@/lib/utils";

export type KidCardFoot = {
  tone: "ok" | "warn" | "info";
  text: string;
};

export type KidCardProps = {
  id: string;
  name: string;
  className: string;
  todayStatus: ParentAttendanceStatus | null;
  teacherNote: string | null;
  foot: KidCardFoot;
};

export function KidCard({ id, name, className, todayStatus, teacherNote, foot }: KidCardProps) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-3">
        <div className="min-w-0">
          <CardTitle className="text-foreground"><h3>{name}</h3></CardTitle>
          <p className="text-xs text-muted-foreground">{className}</p>
        </div>
        <StatusBadge status={todayStatus === "MIXED" ? "UNKNOWN" : todayStatus ?? "UNKNOWN"} label={todayStatus === "MIXED" ? "Catatan berbeda" : todayStatus ? undefined : "Belum dicatat"} />
      </CardHeader>

      <CardContent className="space-y-3">
        <p className={cn("text-xs", foot.tone === "warn" ? "text-status-late-text" : "text-muted-foreground")}>{foot.text}</p>
        <p className="line-clamp-2 text-sm text-foreground">
          <span className="font-semibold">Catatan guru:</span>{" "}
          {teacherNote ?? "Belum ada catatan guru terbaru."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={parentHref("/parent/student-journal", id, { view: "notes" })}
            className={cn(buttonVariants({ variant: "default", size: "lg" }), "min-h-11 text-xs")}
          >
            Baca catatan
          </Link>
          <Link
            href={parentHref("/parent/attendance", id)}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11 text-xs")}
          >
            Lihat kehadiran
          </Link>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2" aria-label={`Informasi lain ${name}`}>
          <Link className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/parent/perkembangan/${id}`}>Perkembangan</Link>
          <Link className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={parentHref("/parent/reports", id)}>Rapor</Link>
          <Link className="inline-flex min-h-11 min-w-11 items-center justify-center text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={parentHref("/parent/invoices", id)}>Tagihan</Link>
        </nav>
      </CardContent>
    </Card>
  );
}

export default KidCard;
