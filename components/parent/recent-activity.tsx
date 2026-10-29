"use client";

import Link from "next/link";
import {
  CalendarCheck,
  BookHeart,
  NotebookPen,
  Receipt,
  Wallet,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ParentActivityItem,
  ParentActivityKind,
} from "@/lib/validations/parent-activity";

const ICON_BY_KIND: Record<ParentActivityKind, LucideIcon> = {
  ATTENDANCE_MARKED: CalendarCheck,
  NOTE_POSTED: BookHeart,
  JOURNAL_ENTRY: NotebookPen,
  INVOICE_ISSUED: Receipt,
  PAYMENT_RECEIVED: Wallet,
  REPORT_PUBLISHED: GraduationCap,
};

export function RecentActivity({ items }: { items: ParentActivityItem[] }) {
  return (
    <section>
      <h2 className="text-h2 mb-3">Aktivitas Terkini</h2>
      {items.length === 0 ? (
        <EmptyState
          title="Belum ada aktivitas"
          description="Catatan dan kehadiran akan muncul di sini"
        />
      ) : (
        <ul className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
          {items.map((item) => (
            <li key={item.id}>
              <ActivityRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityRow({ item }: { item: ParentActivityItem }) {
  const Icon = ICON_BY_KIND[item.kind];
  const content = (
    <div className="flex items-start gap-3 p-3">
      <Icon size={24} className="text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground line-clamp-2">
          {item.title}
        </p>
        {item.detail && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {item.detail}
          </p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
        {formatRelativeTime(item.timestamp)}
      </span>
    </div>
  );

  const rowClass = cn(
    "block transition-colors",
    item.href && "hover:bg-accent",
  );

  if (item.href) {
    return (
      <Link href={item.href} className={rowClass}>
        {content}
      </Link>
    );
  }
  return <div className={rowClass}>{content}</div>;
}
