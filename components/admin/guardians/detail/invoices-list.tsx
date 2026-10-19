import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRupiah } from "@/lib/format";
import type { GuardianChild, ParentInvoiceRow, ParentInvoiceSummary } from "./types";

/**
 * Tagihan body: the owed total first (over ALL invoices, from the server
 * summary), then at most a handful of rows. When the list is shorter than the
 * total, the footer says so and points each child at their own billing
 * section on the student page.
 */
export function InvoicesList({
  summary,
  invoices,
  guardians,
}: {
  summary: ParentInvoiceSummary;
  invoices: ParentInvoiceRow[];
  guardians: GuardianChild[];
}) {
  if (summary.invoiceCount === 0 && invoices.length === 0) {
    return <EmptyState title="Belum ada tagihan" description="Belum ada tagihan untuk wali ini." />;
  }

  const truncated = summary.invoiceCount > invoices.length;
  return (
    <div>
      <div className="mb-3 rounded-lg bg-muted/50 px-3 py-2.5">
        <p className="text-xs text-muted-foreground">Belum dibayar</p>
        <p className="font-currency text-h2 font-semibold text-foreground">{formatRupiah(summary.outstanding)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {summary.unpaidCount > 0
            ? `${summary.unpaidCount} dari ${summary.invoiceCount} tagihan belum lunas`
            : "Tidak ada tunggakan"}
        </p>
      </div>

      <ul className="space-y-0">
        {invoices.map((inv) => (
          <li key={inv.id}>
            <Link href={`/admin/invoices/${inv.id}`} className="block">
              <div className="-mx-2 flex items-center justify-between gap-3 rounded-md border-b border-border/50 px-2 py-2.5 transition-colors last:border-0 hover:bg-accent/50">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{inv.invoiceNumber}</p>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {inv.studentName} &middot; {inv.periodLabel} &middot; {formatRupiah(inv.totalDue)}
                  </p>
                </div>
                <StatusBadge status={inv.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {truncated && (
        <div className="mt-3 border-t border-border/50 pt-3">
          <p className="text-xs text-muted-foreground">
            Menampilkan {invoices.length} dari {summary.invoiceCount} tagihan
          </p>
          {guardians.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {guardians.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/admin/students/${g.student.id}#keuangan`}
                    className="inline-flex min-h-8 items-center text-small text-primary-text hover:underline"
                  >
                    Semua tagihan {g.student.name.trim().split(/\s+/)[0]} →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
