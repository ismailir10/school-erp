import { notFound } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/portal/page-header";
import { BackLink } from "@/components/portal/back-link";
import { formatRupiah, formatDate, maskBankAccount } from "@/lib/format";
import { formatPeriodRange, periodMonthLabel } from "../helpers";
import { getTodayInTimezone } from "@/lib/attendance/timezone";

// ── Types ─────────────────────────────────────────────────────────────────────

type SlipLine = {
  id: string;
  labelSnapshot: string;
  categorySnapshot: string;
  finalAmount: number;
};

type SlipDetail = {
  id: string;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  employee: {
    id: string;
    nama: string;
    formalName: string | null;
    kode: string;
    jabatan: string;
    bankName: string | null;
    bankAccountNo: string | null;
  };
  payrollRun: {
    id: string;
    periodStart: string;
    periodEnd: string;
    actualWorkDays: number;
    status: string;
    tenantId: string;
  };
  lines: SlipLine[];
};

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSlipDetail(id: string, tenantId: string): Promise<SlipDetail | null> {
  const raw = await prisma.payrollItem.findFirst({
    where: { id, payrollRun: { tenantId } },
    include: {
      employee: {
        select: {
          id: true,
          nama: true,
          formalName: true,
          kode: true,
          jabatan: true,
          bankName: true,
          bankAccountNo: true,
        },
      },
      payrollRun: {
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          actualWorkDays: true,
          status: true,
          tenantId: true,
        },
      },
      lines: {
        orderBy: { componentDef: { sortOrder: "asc" } },
        select: {
          id: true,
          labelSnapshot: true,
          categorySnapshot: true,
          finalAmount: true,
        },
      },
    },
  });

  if (!raw) return null;

  return {
    id: raw.id,
    grossAmount: Number(raw.grossAmount),
    deductions: Number(raw.deductions),
    netAmount: Number(raw.netAmount),
    employee: raw.employee,
    payrollRun: raw.payrollRun,
    lines: raw.lines.map((l) => ({
      id: l.id,
      labelSnapshot: l.labelSnapshot,
      categorySnapshot: l.categorySnapshot,
      finalAmount: Number(l.finalAmount),
    })),
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SlipDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session || session.role !== "TEACHER" || !session.tenantId) notFound();

  const slip = await fetchSlipDetail(id, session.tenantId);
  if (!slip) notFound();

  // Auth check: teacher can only see their own slip
  if (slip.employee.id !== session.employeeId) notFound();

  // Draft block: DRAFT slips are not available yet
  if (slip.payrollRun.status === "DRAFT") notFound();

  // Filter zero-value lines: UAT 2026-05-12 minor — Rp 0 entries (e.g. unused
  // Insentif/Tunjangan slots) added visual clutter without information value.
  // Totals (slip.grossAmount, slip.deductions) are computed server-side, so
  // hiding rows here does not affect the headline numbers.
  const incomeLines = slip.lines.filter(
    (l) => l.categorySnapshot === "INCOME" && l.finalAmount > 0,
  );
  const deductionLines = slip.lines.filter(
    (l) => l.categorySnapshot === "DEDUCTION" && l.finalAmount > 0,
  );

  const employeeName = slip.employee.formalName ?? slip.employee.nama;
  const periodHeader = periodMonthLabel(slip.payrollRun.periodEnd);
  const periodLabel = formatPeriodRange(slip.payrollRun.periodStart, slip.payrollRun.periodEnd);

  return (
    <div className="space-y-4">
      <BackLink href="/teacher/slips" label="Kembali ke slip gaji" />

      <PageHeader
        title={periodHeader}
        subtitle={periodLabel}
        actions={
          <>
            <StatusBadge status="APPROVED" label="Tersedia" />
            <Link
              href={`/api/slips/${slip.id}/pdf`}
              target="_blank"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Unduh PDF slip ${periodLabel}`}
            >
              <Download size={16} aria-hidden="true" /> PDF
            </Link>
          </>
        }
      />

      {/* Employee info card */}
      <Card className="p-card">
        <h2 className="text-small font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Informasi Karyawan
        </h2>
        {/*
          Two-column grid on >=414 px (sm breakpoint ~640 px, so use
          min-[414px]:grid-cols-2 for exact threshold); single column on 375 px.
        */}
        <dl className="grid grid-cols-1 min-[414px]:grid-cols-2 gap-y-3 gap-x-4">
          <div>
            <dt className="text-small text-muted-foreground">Nama</dt>
            <dd className="text-body font-semibold text-foreground mt-0.5">
              {employeeName}
            </dd>
          </div>
          <div>
            <dt className="text-small text-muted-foreground">Kode Karyawan</dt>
            <dd className="text-body font-semibold text-foreground mt-0.5">
              {slip.employee.kode}
            </dd>
          </div>
          <div>
            <dt className="text-small text-muted-foreground">Jabatan</dt>
            <dd className="text-body font-semibold text-foreground mt-0.5">
              {slip.employee.jabatan}
            </dd>
          </div>
          <div>
            <dt className="text-small text-muted-foreground">Hari Kerja</dt>
            <dd className="text-body font-semibold text-foreground mt-0.5">
              {slip.payrollRun.actualWorkDays} hari
            </dd>
          </div>
        </dl>
      </Card>

      {/* Pendapatan (Income) section */}
      <Card className="p-card">
        <h2 className="text-small font-semibold uppercase tracking-wide text-primary-text mb-3">
          Pendapatan
        </h2>

        <div className="space-y-2">
          {incomeLines.map((line, i) => (
            <div
              key={line.id}
              className={`flex items-start gap-3 py-1.5 ${
                i < incomeLines.length - 1
                  ? "border-b border-border"
                  : ""
              }`}
            >
              <span className="min-w-0 flex-1 break-words text-body text-foreground">{line.labelSnapshot}</span>
              <span className="shrink-0 whitespace-nowrap text-body font-medium text-foreground tabular-nums">
                {formatRupiah(line.finalAmount)}
              </span>
            </div>
          ))}
        </div>

        {/* Total Pendapatan */}
        <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border">
          <span className="min-w-0 flex-1 text-body font-semibold text-foreground">
            Total Pendapatan
          </span>
          <span className="shrink-0 whitespace-nowrap text-body font-bold text-foreground tabular-nums">
            {formatRupiah(slip.grossAmount)}
          </span>
        </div>
      </Card>

      {/* Potongan (Deductions) section — hidden if zero deductions */}
      {deductionLines.length > 0 && (
        <Card className="p-card">
          <h2 className="text-small font-semibold uppercase tracking-wide text-primary-text mb-3">
            Potongan
          </h2>

          <div className="space-y-2">
            {deductionLines.map((line, i) => (
              <div
                key={line.id}
                className={`flex items-start gap-3 py-1.5 ${
                  i < deductionLines.length - 1
                    ? "border-b border-border"
                    : ""
                }`}
              >
                <span className="min-w-0 flex-1 break-words text-body text-foreground">
                  {line.labelSnapshot}
                </span>
                <span className="shrink-0 whitespace-nowrap text-body font-medium text-foreground tabular-nums">
                  {formatRupiah(line.finalAmount)}
                </span>
              </div>
            ))}
          </div>

          {/* Total Potongan */}
          <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border">
            <span className="min-w-0 flex-1 text-body font-semibold text-foreground">
              Total Potongan
            </span>
            <span className="shrink-0 whitespace-nowrap text-body font-bold text-destructive tabular-nums">
              {formatRupiah(slip.deductions)}
            </span>
          </div>
        </Card>
      )}

      {/* Take Home Pay — prominent brand highlight (matches teal netBox in PDF) */}
      <div className="rounded-xl bg-primary p-card flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-small font-semibold uppercase tracking-wide text-primary-foreground opacity-80">
            Take Home Pay
          </p>
          <p className="text-caption text-primary-foreground opacity-60 mt-0.5">
            Diterima ke rekening
          </p>
        </div>
        <p className="shrink-0 whitespace-nowrap text-h1 font-bold text-primary-foreground tabular-nums">
          {formatRupiah(slip.netAmount)}
        </p>
      </div>

      {/* Bank transfer details */}
      {slip.employee.bankAccountNo && (
        <Card className="p-card">
          <h2 className="text-small font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Transfer ke Rekening
          </h2>
          <dl className="grid grid-cols-1 min-[414px]:grid-cols-3 gap-y-3 gap-x-4">
            <div>
              <dt className="text-small text-muted-foreground">Bank</dt>
              <dd className="text-body font-semibold text-foreground mt-0.5">
                {slip.employee.bankName ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted-foreground">Atas Nama</dt>
              <dd className="text-body font-semibold text-foreground mt-0.5">
                {employeeName}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted-foreground">No. Rekening</dt>
              <dd className="text-body font-semibold text-foreground mt-0.5 font-mono">
                {maskBankAccount(slip.employee.bankAccountNo)}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* Footer */}
      <div className="pt-2 pb-4 border-t border-border">
        <p className="text-caption text-muted-foreground">
          Tanggal cetak: {formatDate(getTodayInTimezone("Asia/Jakarta"))}
        </p>
        <p className="text-caption text-muted-foreground mt-0.5">
          Slip ini dihasilkan otomatis oleh Talib by An Nisaa&apos; Sekolahku. Dokumen resmi.
        </p>
      </div>
    </div>
  );
}
